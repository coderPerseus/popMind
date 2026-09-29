// Pure text helpers shared by capture (record building) and the store (edits, legacy import).
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { ClipKind } from '@/lib/clipboard/types'

const TITLE_MAX = 72
const PREVIEW_MAX = 500

export const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

/** Unifies line endings and trims, so the same text always yields the same fingerprint. */
export const normalizeText = (value: string) => value.replace(/\r\n?/g, '\n').trim()

export const collapseWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()

export const truncateText = (value: string, max: number) => {
  if (value.length <= max) {
    return value
  }

  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/** Card summary: keeps line breaks (cards show a few lines) but drops blank runs. */
export const buildTextPreview = (text: string) => truncateText(text.replace(/\n{2,}/g, '\n'), PREVIEW_MAX)

export const buildPreviewText = (
  kind: ClipKind,
  input: {
    plainText?: string
    url?: string
    colorValue?: string
    filePaths?: string[]
    imageWidth?: number
    imageHeight?: number
  }
) => {
  switch (kind) {
    case 'file':
      return (input.filePaths ?? [])
        .slice(0, 3)
        .map((path) => basename(path))
        .join(' · ')
    case 'image':
      return input.imageWidth && input.imageHeight ? `${input.imageWidth}×${input.imageHeight}` : 'Image'
    case 'color':
      return input.colorValue ?? input.plainText ?? ''
    case 'link':
      return truncateText(input.url ?? input.plainText ?? '', PREVIEW_MAX)
    default:
      return buildTextPreview(input.plainText ?? '')
  }
}

export const deriveTitle = (
  kind: ClipKind,
  input: {
    plainText?: string
    url?: string
    colorValue?: string
    filePaths?: string[]
    fileCount?: number
    imageWidth?: number
    imageHeight?: number
  }
) => {
  switch (kind) {
    case 'image':
      return `Image ${input.imageWidth ?? 0}×${input.imageHeight ?? 0}`
    case 'file': {
      const count = input.fileCount ?? input.filePaths?.length ?? 0
      if (count === 1 && input.filePaths?.[0]) {
        return basename(input.filePaths[0])
      }
      return count === 1 ? 'File' : `${count} files`
    }
    case 'color':
      return input.colorValue ?? input.plainText ?? 'Color'
    case 'link':
      return truncateText(input.url ?? input.plainText ?? 'Link', TITLE_MAX)
    default: {
      const firstLine = (input.plainText ?? '').split('\n').find((line) => line.trim().length > 0) ?? ''
      return truncateText(collapseWhitespace(firstLine), TITLE_MAX) || 'Clipboard Item'
    }
  }
}

// ---- semantic fingerprints (spec §5.1 item 5) ----

/** text / link / color all share one namespace so a rich or URL variant of the same value is one item. */
export const textFingerprint = (value: string) => `txt:${sha256Hex(value)}`

export const imageFingerprint = (png: Uint8Array) => `img:${sha256Hex(png)}`

export const filesFingerprint = (paths: string[]) => `file:${sha256Hex([...paths].sort().join('\n'))}`
