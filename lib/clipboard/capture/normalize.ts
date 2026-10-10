// Turns a raw pasteboard snapshot into an ingest record: merges pasteboard items (keeping their boundaries),
// drops volatile types, classifies (spec §5.2, file before image) and computes the semantic fingerprint.
// Pure apart from the injected image decoder, so it is testable without Electron.
import { fileURLToPath } from 'node:url'
import {
  IMAGE_UTI_PRIORITY,
  UTI_FILE_URL,
  UTI_HTML,
  UTI_PNG,
  UTI_RTF,
  UTI_RTFD,
  UTI_TEXT_UTF16,
  UTI_TEXT_UTF8,
  UTI_URL,
  isImageType,
  isStorableType,
} from '@/lib/clipboard/capture/pasteboard-types'
import { classifyText } from '@/lib/clipboard/capture/classify'
import type { ClipIngestRecord, ClipIngestRepresentation } from '@/lib/clipboard/store/contract'
import {
  buildPreviewText,
  deriveTitle,
  filesFingerprint,
  imageFingerprint,
  normalizeText,
} from '@/lib/clipboard/store/text-utils'
import type { NativePasteboardItem } from '@/lib/native/macos-addon'

export type PasteCandidate = {
  /** Plain text of each pasteboard item that has one, in item order. */
  texts: string[]
  html?: string
  hasRtf: boolean
  rtfData?: Buffer
  url?: string
  filePaths: string[]
  imageReps: Array<{ itemIndex: number; type: string; data: Buffer }>
  /** Storable representations with their pasteboard item index. */
  reps: ClipIngestRepresentation[]
}

export type DecodedImage = { png: Buffer; width: number; height: number; itemIndex: number }

export type BuildContext = {
  copiedAt: number
  source?: { bundleId: string; name: string }
  isRemote: boolean
  maxBytes: number
  decodeImage: (reps: PasteCandidate['imageReps']) => Promise<DecodedImage | null>
  /** Reads a file up to `maxBytes` (null when missing / larger / unreadable). Enables app-private image files. */
  readFile?: (path: string, maxBytes: number) => Promise<Buffer | null>
}

export type BuildResult = { ok: true; record: ClipIngestRecord } | { ok: false; reason: string }

/** Raw image files are re-encoded to PNG, and the PNG is checked against maxBytes, so allow big files in. */
const MAX_IMAGE_FILE_BYTES = 256 * 1024 * 1024

const toBuffer = (data: Uint8Array) => (Buffer.isBuffer(data) ? data : Buffer.from(data))

const decodeText = (type: string, data: Uint8Array) => {
  const buffer = toBuffer(data)
  const text = type === UTI_TEXT_UTF16 ? buffer.toString('utf16le') : buffer.toString('utf8')
  return text.replace(/\u0000/g, '').replace(/^﻿/, '')
}

const parseFileUrls = (data: Uint8Array): string[] => {
  const paths: string[] = []
  for (const line of decodeText(UTI_TEXT_UTF8, data).split(/\r?\n/)) {
    const candidate = line.trim()
    if (!candidate.startsWith('file://') || candidate.startsWith('file:///.file/id=')) {
      continue
    }

    try {
      paths.push(fileURLToPath(candidate))
    } catch {
      // Skip malformed URLs.
    }
  }
  return paths
}

export const htmlToText = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')

/** Very rough RTF stripping; only used when a copy carries RTF but no plain text. */
export const rtfToText = (rtf: string) =>
  rtf
    .replace(/\\'([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\(?:par|line)\b ?/g, '\n')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '')

export const extractCandidate = (items: NativePasteboardItem[]): PasteCandidate => {
  const candidate: PasteCandidate = { texts: [], hasRtf: false, filePaths: [], imageReps: [], reps: [] }

  items.forEach((item, itemIndex) => {
    const hasUtf8 = item.representations.some((rep) => rep.type === UTI_TEXT_UTF8 && rep.data.length > 0)
    let itemText: string | undefined

    for (const rep of item.representations) {
      if (rep.data.length === 0 || !isStorableType(rep.type)) {
        continue
      }

      const data = toBuffer(rep.data)
      if (rep.type === UTI_TEXT_UTF16 && hasUtf8) {
        continue
      }

      candidate.reps.push({ itemIndex, uti: rep.type, data })

      if (rep.type === UTI_TEXT_UTF8 || rep.type === UTI_TEXT_UTF16) {
        const text = decodeText(rep.type, data)
        if (text.trim() && itemText === undefined) {
          itemText = text
        }
      } else if (rep.type === UTI_HTML) {
        candidate.html ??= decodeText(UTI_TEXT_UTF8, data)
      } else if (rep.type === UTI_RTF || rep.type === UTI_RTFD) {
        candidate.hasRtf = true
        if (rep.type === UTI_RTF) {
          candidate.rtfData ??= data
        }
      } else if (rep.type === UTI_URL) {
        candidate.url ??= decodeText(UTI_TEXT_UTF8, data).split(/\r?\n/)[0]?.trim() || undefined
      } else if (rep.type === UTI_FILE_URL) {
        candidate.filePaths.push(...parseFileUrls(data))
      } else if (isImageType(rep.type)) {
        candidate.imageReps.push({ itemIndex, type: rep.type, data })
      }
    }

    if (itemText !== undefined) {
      candidate.texts.push(itemText)
    }
  })

  candidate.imageReps.sort(
    (left, right) =>
      (IMAGE_UTI_PRIORITY as readonly string[]).indexOf(left.type) -
      (IMAGE_UTI_PRIORITY as readonly string[]).indexOf(right.type)
  )
  candidate.filePaths = [...new Set(candidate.filePaths)]
  return candidate
}

const IMAGE_FILE_TYPES: Record<string, string> = {
  png: UTI_PNG,
  jpg: 'public.jpeg',
  jpeg: 'public.jpeg',
  heic: 'public.heic',
  heif: 'public.heic',
  tif: 'public.tiff',
  tiff: 'public.tiff',
  gif: 'com.compuserve.gif',
  webp: 'org.webmproject.webp',
  bmp: 'com.microsoft.bmp',
}

/** Sandboxed / cache / temp locations: files there are an app's private copy, not something the user manages. */
const APP_PRIVATE_PATH =
  /\/Library\/(?:Containers|Group Containers|Caches|Application Support)\/|^\/(?:private\/)?(?:var\/folders|tmp)\//

/**
 * Chat apps (WeChat, QQ, ...) copy an image as a single `public.file-url` to a temp file in their container, with
 * no image data. That is an image copy, not a file the user picked in Finder.
 */
export const appPrivateImageFileType = (filePaths: string[]) => {
  if (filePaths.length !== 1 || !APP_PRIVATE_PATH.test(filePaths[0])) {
    return undefined
  }
  const extension = filePaths[0].split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_FILE_TYPES[extension]
}

const sumBytes = (reps: ClipIngestRepresentation[]) => reps.reduce((total, rep) => total + rep.data.length, 0)

/** Text a privacy filter should inspect (plain text of every item plus the URL). */
export const candidateTexts = (candidate: PasteCandidate) => [
  ...candidate.texts,
  ...(candidate.url ? [candidate.url] : []),
]

type RecordBase = Pick<ClipIngestRecord, 'source' | 'isRemote' | 'copiedAt' | 'tags'>

const buildImageRecord = (
  base: RecordBase,
  decoded: DecodedImage,
  otherReps: ClipIngestRepresentation[],
  html: string | undefined
): ClipIngestRecord => {
  const reps = [...otherReps, { itemIndex: decoded.itemIndex, uti: UTI_PNG, data: decoded.png }]
  return {
    ...base,
    kind: 'image',
    isRich: false,
    fingerprint: imageFingerprint(decoded.png),
    title: deriveTitle('image', { imageWidth: decoded.width, imageHeight: decoded.height }),
    previewText: buildPreviewText('image', { imageWidth: decoded.width, imageHeight: decoded.height }),
    html,
    filePaths: [],
    imagePng: decoded.png,
    imageWidth: decoded.width,
    imageHeight: decoded.height,
    representations: reps,
    byteSize: sumBytes(reps),
    charCount: 0,
  }
}

export const buildIngestRecord = async (candidate: PasteCandidate, context: BuildContext): Promise<BuildResult> => {
  const base = {
    source: context.source,
    isRemote: context.isRemote,
    copiedAt: context.copiedAt,
    tags: [] as string[],
  }

  // 1a. An app-private image file is captured as the image itself (the file is usually a short-lived temp copy).
  const imageFileType = appPrivateImageFileType(candidate.filePaths)
  if (imageFileType && context.readFile) {
    const data = await context.readFile(candidate.filePaths[0], MAX_IMAGE_FILE_BYTES)
    const decoded = data ? await context.decodeImage([{ itemIndex: 0, type: imageFileType, data }]) : null
    if (decoded) {
      if (decoded.png.length > context.maxBytes) {
        return { ok: false, reason: 'too-large' }
      }
      return { ok: true, record: buildImageRecord(base, decoded, [], undefined) }
    }
  }

  // 1b. Files come before images: Finder adds a file-icon TIFF to every file copy.
  if (candidate.filePaths.length > 0) {
    const reps = candidate.reps.filter((rep) => rep.uti === UTI_FILE_URL || rep.uti === UTI_TEXT_UTF8)
    const byteSize = sumBytes(reps)
    return {
      ok: true,
      record: {
        ...base,
        kind: 'file',
        isRich: false,
        fingerprint: filesFingerprint(candidate.filePaths),
        title: deriveTitle('file', { filePaths: candidate.filePaths }),
        previewText: buildPreviewText('file', { filePaths: candidate.filePaths }),
        filePaths: candidate.filePaths,
        representations: reps,
        byteSize,
        charCount: 0,
      },
    }
  }

  let plainText = normalizeText(candidate.texts.join('\n'))
  if (!plainText && candidate.html) {
    plainText = normalizeText(htmlToText(candidate.html))
  }
  if (!plainText && candidate.rtfData) {
    plainText = normalizeText(rtfToText(candidate.rtfData.toString('latin1')))
  }

  // 2. Images.
  if (candidate.imageReps.length > 0) {
    const decoded = await context.decodeImage(candidate.imageReps)
    if (decoded) {
      if (decoded.png.length > context.maxBytes) {
        return { ok: false, reason: 'too-large' }
      }

      const reps = candidate.reps.filter((rep) => !isImageType(rep.uti))
      return { ok: true, record: buildImageRecord(base, decoded, reps, candidate.html) }
    }

    if (!plainText && !candidate.url) {
      return { ok: false, reason: 'image-decode-failed' }
    }
  }

  // 3-5. Color / link / text.
  if (!plainText && !candidate.url) {
    return { ok: false, reason: 'empty' }
  }

  const classification = classifyText(plainText, candidate.url)
  const storedText = classification.kind === 'link' && !plainText ? (classification.url ?? '') : plainText
  const reps = candidate.reps.filter((rep) => !isImageType(rep.uti) && rep.uti !== UTI_FILE_URL)
  const isRich = classification.kind === 'text' && Boolean(candidate.html || candidate.hasRtf)
  const fields = { plainText: storedText, url: classification.url, colorValue: classification.colorValue }

  return {
    ok: true,
    record: {
      ...base,
      kind: classification.kind,
      subKind: classification.subKind,
      isRich,
      fingerprint: classification.fingerprint,
      title: deriveTitle(classification.kind, fields),
      previewText: buildPreviewText(classification.kind, fields),
      plainText: storedText,
      html: isRich ? candidate.html : undefined,
      url: classification.url,
      colorValue: classification.colorValue,
      filePaths: [],
      representations: reps,
      byteSize: sumBytes(reps),
      charCount: storedText.length,
      tags: classification.tags,
    },
  }
}
