// Filesystem layout of the clipboard data directory. Pure (no Electron) so the store worker can use it too.
import { join } from 'node:path'

export type ClipDirs = {
  root: string
  dbPath: string
  blobDir: string
  thumbDir: string
  appIconDir: string
}

/** Longest edge of generated thumbnails. */
export const CLIP_THUMB_MAX_EDGE = 480

export const getClipDirs = (userDataPath: string): ClipDirs => {
  const root = join(userDataPath, 'clipboard')
  return {
    root,
    dbPath: join(root, 'clipboard.sqlite'),
    blobDir: join(root, 'blobs'),
    thumbDir: join(root, 'thumbs'),
    appIconDir: join(root, 'app-icons'),
  }
}

export const getLegacyDatabasePath = (userDataPath: string) => join(userDataPath, 'clipboard-history.sqlite')

/** Keeps bundle ids usable as file names and blocks path traversal from protocol requests. */
export const safeFileName = (value: string) => value.replace(/[^\w.-]/g, '_')

export const appIconPathFor = (dirs: ClipDirs, bundleId: string) =>
  join(dirs.appIconDir, `${safeFileName(bundleId)}.png`)

/** Thumbnail path without extension (`.png` when it has transparency, `.jpg` otherwise). */
export const thumbBasePathFor = (dirs: ClipDirs, imageHash: string) =>
  join(dirs.thumbDir, imageHash.slice(0, 2), `${imageHash}@${CLIP_THUMB_MAX_EDGE}`)

export const THUMB_EXTENSIONS = ['jpg', 'png'] as const
