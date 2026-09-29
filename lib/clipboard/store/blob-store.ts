// Content-addressed file store for images and large representations:
// blobs/<sha256[0..2]>/<sha256>.<ext>. Writes are idempotent (same bytes -> same file) and atomic.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256Hex } from '@/lib/clipboard/store/text-utils'

/** Representations bigger than this go to files instead of the database. */
export const BLOB_THRESHOLD_BYTES = 256 * 1024

const UTI_EXTENSIONS: Record<string, string> = {
  'public.png': 'png',
  'public.tiff': 'tiff',
  'public.jpeg': 'jpg',
  'public.heic': 'heic',
  'public.html': 'html',
  'public.rtf': 'rtf',
  'com.apple.flat-rtfd': 'rtfd',
  'public.utf8-plain-text': 'txt',
  'public.utf16-plain-text': 'txt',
}

export const extensionForUti = (uti: string) => UTI_EXTENSIONS[uti] ?? 'bin'

export const IMAGE_UTIS = new Set(['public.png', 'public.tiff', 'public.jpeg', 'public.heic'])

export class BlobStore {
  constructor(readonly root: string) {}

  private dirFor(hash: string) {
    return join(this.root, hash.slice(0, 2))
  }

  pathFor(hash: string, extension: string) {
    return join(this.dirFor(hash), `${hash}.${extension}`)
  }

  /** Writes the bytes (no-op when already present) and returns their hash. */
  write(data: Uint8Array, extension: string): string {
    const hash = sha256Hex(data)
    const target = this.pathFor(hash, extension)
    if (existsSync(target)) {
      return hash
    }

    mkdirSync(this.dirFor(hash), { recursive: true })
    const temp = `${target}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(temp, data)
    renameSync(temp, target)
    return hash
  }

  /** Locates the file for a hash regardless of extension. */
  find(hash: string): string | null {
    try {
      const prefix = `${hash}.`
      const name = readdirSync(this.dirFor(hash)).find((entry) => entry.startsWith(prefix) && !entry.endsWith('.tmp'))
      return name ? join(this.dirFor(hash), name) : null
    } catch {
      return null
    }
  }

  read(hash: string): Buffer | null {
    const file = this.find(hash)
    if (!file) {
      return null
    }

    try {
      return readFileSync(file)
    } catch {
      return null
    }
  }

  remove(hash: string): boolean {
    const file = this.find(hash)
    if (!file) {
      return false
    }

    rmSync(file, { force: true })
    return true
  }

  /** Deletes every blob whose hash is not in `referenced`; returns removed count and bytes. */
  sweep(referenced: Set<string>): { removed: number; bytes: number } {
    return sweepHashedDirectory(this.root, referenced)
  }

  totalBytes() {
    return directoryBytes(this.root)
  }
}

/** Walks `<root>/<xx>/<hash>[@size].<ext>` and removes files whose hash is not referenced. */
export const sweepHashedDirectory = (root: string, referenced: Set<string>) => {
  let removed = 0
  let bytes = 0

  let buckets: string[]
  try {
    buckets = readdirSync(root)
  } catch {
    return { removed, bytes }
  }

  for (const bucket of buckets) {
    const bucketPath = join(root, bucket)
    let names: string[]
    try {
      names = readdirSync(bucketPath)
    } catch {
      continue
    }

    for (const name of names) {
      const hash = name.split(/[.@]/, 1)[0] ?? ''
      if (referenced.has(hash) && !name.endsWith('.tmp')) {
        continue
      }

      const file = join(bucketPath, name)
      try {
        bytes += statSync(file).size
        rmSync(file, { force: true })
        removed += 1
      } catch {
        // Another writer may have removed it already.
      }
    }

    try {
      if (readdirSync(bucketPath).length === 0) {
        rmSync(bucketPath, { recursive: true, force: true })
      }
    } catch {
      // Keep the bucket when it cannot be inspected.
    }
  }

  return { removed, bytes }
}

export const directoryBytes = (root: string): number => {
  let total = 0
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return 0
  }

  for (const entry of entries) {
    const path = join(root, entry)
    try {
      const stat = statSync(path)
      total += stat.isDirectory() ? directoryBytes(path) : stat.size
    } catch {
      // Ignore files that disappear while walking.
    }
  }

  return total
}
