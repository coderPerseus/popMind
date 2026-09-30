// Thumbnail generation (longest edge 480 px). Runs from the enrichment queue and lazily from the
// popmind-clip:// protocol, never on the capture path.
import { copyFileSync, existsSync, mkdirSync, openSync, readSync, closeSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { nativeImage, type NativeImage } from 'electron'
import { CLIP_THUMB_MAX_EDGE, THUMB_EXTENSIONS, thumbBasePathFor } from '@/lib/clipboard/store/paths'
import { parsePngSize } from '@/lib/clipboard/store/png'
import { getClipStoreDirs } from '@/lib/clipboard/store'
import { mainLogger } from '@/lib/main/logger'

const inFlight = new Map<string, Promise<string>>()

/** Reads only the PNG header of a file. */
export const readPngFileSize = (path: string) => {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const header = Buffer.alloc(32)
    const bytes = readSync(fd, header, 0, 32, 0)
    return parsePngSize(header.subarray(0, bytes))
  } catch {
    return null
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

const hasTransparency = (image: NativeImage) => {
  const bitmap = image.toBitmap()
  for (let index = 3; index < bitmap.length; index += 4) {
    if (bitmap[index] !== 255) {
      return true
    }
  }
  return false
}

const loadScaled = (imagePath: string): NativeImage => {
  // createThumbnailFromPath (QuickLook) returns Retina-scaled bitmaps with unreliable sizes, so decode and resize
  // explicitly to get an exact longest edge.
  let image = nativeImage.createFromPath(imagePath)
  if (image.isEmpty()) {
    throw new Error('cannot decode image')
  }

  const { width, height } = image.getSize()
  if (Math.max(width, height) > CLIP_THUMB_MAX_EDGE) {
    image = image.resize(width >= height ? { width: CLIP_THUMB_MAX_EDGE } : { height: CLIP_THUMB_MAX_EDGE })
  }
  return image
}

const findExisting = (basePath: string) => {
  for (const extension of THUMB_EXTENSIONS) {
    const candidate = `${basePath}.${extension}`
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

const writeAtomic = (target: string, data: Buffer) => {
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  writeFileSync(temp, data)
  renameSync(temp, target)
}

/** Creates the thumbnail for a stored image file (`blobs/xx/<hash>.png`) and returns its path. */
export const ensureThumbnail = (imagePath: string): Promise<string> => {
  const hash = basename(imagePath).split('.')[0] ?? ''
  const basePath = thumbBasePathFor(getClipStoreDirs(), hash)

  const existing = findExisting(basePath)
  if (existing) {
    return Promise.resolve(existing)
  }

  const running = inFlight.get(hash)
  if (running) {
    return running
  }

  const job = (async () => {
    const started = performance.now()
    const size = readPngFileSize(imagePath)

    if (size && Math.max(size.width, size.height) <= CLIP_THUMB_MAX_EDGE) {
      // Already small: reuse the stored PNG bytes, no decode needed.
      const target = `${basePath}.png`
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(imagePath, target)
      mainLogger.info('[clip-enrich] thumbnail copied', {
        hash: hash.slice(0, 8),
        ms: Math.round(performance.now() - started),
      })
      return target
    }

    const image = loadScaled(imagePath)
    const transparent = hasTransparency(image)
    const target = `${basePath}.${transparent ? 'png' : 'jpg'}`
    writeAtomic(target, transparent ? image.toPNG() : image.toJPEG(82))
    mainLogger.info('[clip-enrich] thumbnail generated', {
      hash: hash.slice(0, 8),
      source: size ? `${size.width}x${size.height}` : 'unknown',
      format: transparent ? 'png' : 'jpg',
      ms: Math.round(performance.now() - started),
    })
    return target
  })().finally(() => inFlight.delete(hash))

  inFlight.set(hash, job)
  return job
}
