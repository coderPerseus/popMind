// Vision OCR for image items (spec §6.1): skips tiny images, downsizes very large ones through a temp file.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeImage } from 'electron'
import { readPngFileSize } from '@/lib/clipboard/enrich/thumbnail'
import { clipboardNative } from '@/lib/clipboard/native-bridge'
import { mainLogger } from '@/lib/main/logger'

const MIN_EDGE = 32
const MAX_PIXELS = 20_000_000
const OCR_TIMEOUT_MS = 60_000
const OCR_TEXT_MAX_CHARS = 50_000

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ocr timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

/** Returns the recognized text (possibly empty), or undefined when the image was skipped. */
export const recognizeImageText = async (itemId: string, imagePath: string): Promise<string | undefined> => {
  const started = performance.now()
  const size = readPngFileSize(imagePath)

  if (size && (size.width < MIN_EDGE || size.height < MIN_EDGE)) {
    mainLogger.info('[clip-ocr] skipped tiny image', { itemId, width: size.width, height: size.height })
    return undefined
  }

  let target = imagePath
  let tempPath: string | null = null

  try {
    if (size && size.width * size.height > MAX_PIXELS) {
      const scale = Math.sqrt(MAX_PIXELS / (size.width * size.height))
      const resized = nativeImage.createFromPath(imagePath).resize({ width: Math.floor(size.width * scale) })
      const directory = join(tmpdir(), 'popmind-clip-ocr')
      mkdirSync(directory, { recursive: true })
      tempPath = join(directory, `${itemId}.png`)
      writeFileSync(tempPath, resized.toPNG())
      target = tempPath
      mainLogger.info('[clip-ocr] downscaled large image', { itemId, width: size.width, height: size.height })
    }

    const raw = await withTimeout(clipboardNative.recognizeText(target), OCR_TIMEOUT_MS)
    const text = raw.trim().slice(0, OCR_TEXT_MAX_CHARS)
    mainLogger.info('[clip-ocr] recognized', {
      itemId,
      chars: text.length,
      ms: Math.round(performance.now() - started),
    })
    return text
  } catch (error) {
    if (error instanceof Error && error.message === 'unsupported') {
      mainLogger.info('[clip-ocr] not supported on this system, skipping', { itemId })
      return undefined
    }
    throw error
  } finally {
    if (tempPath) {
      rmSync(tempPath, { force: true })
    }
  }
}
