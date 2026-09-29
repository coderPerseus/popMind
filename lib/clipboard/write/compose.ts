// Pure pasteboard payload composition (no Electron / Node-native imports so it can be unit tested).
// Spec: docs/clipboard-paste-redesign.md §5.5.
import { pathToFileURL } from 'node:url'
import type { ClipWritePayload } from '@/lib/clipboard/store/contract'
import type { ClipPasteMode } from '@/lib/clipboard/types'
import type { NativePasteboardItem, NativePasteboardRepresentation } from '@/lib/native/macos-addon'

export const PLAIN_TEXT_UTI = 'public.utf8-plain-text'
const UTF16_TEXT_UTI = 'public.utf16-plain-text'
export const FILE_URL_UTI = 'public.file-url'

/**
 * ⇧ (plainText mode) XOR the "always paste as plain text" setting, like Clipbara:
 *   mode default   + alwaysPlainText off -> rich
 *   mode plainText + alwaysPlainText off -> plain
 *   mode default   + alwaysPlainText on  -> plain
 *   mode plainText + alwaysPlainText on  -> rich (⇧ inverts the setting)
 */
export const resolvePlainTextMode = (mode: ClipPasteMode, alwaysPlainText: boolean) =>
  (mode === 'plainText') !== alwaysPlainText

export type ComposeStrategy = 'single-rich' | 'single-plain' | 'multi-files' | 'multi-first-payload' | 'multi-text'

export type ComposeOptions = {
  plain: boolean
  /** `file://` URL of a temp PNG copy for an image payload (terminals need a file path). */
  imageFileUrl?: (payload: ClipWritePayload) => string | undefined
}

export type ComposeResult = {
  items: NativePasteboardItem[]
  strategy: ComposeStrategy
}

const textRepresentation = (text: string): NativePasteboardRepresentation => ({
  type: PLAIN_TEXT_UTI,
  data: Buffer.from(text, 'utf8'),
})

const fileUrlRepresentation = (url: string): NativePasteboardRepresentation => ({
  type: FILE_URL_UTI,
  data: Buffer.from(url, 'utf8'),
})

const cloneItem = (item: NativePasteboardItem): NativePasteboardItem => ({
  representations: item.representations.map((representation) => ({ ...representation })),
})

/** Text used for plain paste / multi-select join. Files fall back to their paths. */
export const payloadPlainText = (payload: ClipWritePayload) => {
  if (payload.plainText) return payload.plainText
  return payload.filePaths.length ? payload.filePaths.join('\n') : ''
}

/** One pasteboard item per file, each holding only its file URL (multi-file paste needs one item per file). */
export const fileUrlItems = (payload: ClipWritePayload): NativePasteboardItem[] => {
  const fromItems = payload.items
    .map((item) => item.representations.filter((representation) => representation.type === FILE_URL_UTI))
    .filter((representations) => representations.length > 0)
    .map((representations) => ({ representations: representations.map((representation) => ({ ...representation })) }))

  if (fromItems.length > 0) return fromItems

  return payload.filePaths.map((path) => ({
    representations: [fileUrlRepresentation(pathToFileURL(path).toString())],
  }))
}

/** Puts `text` on the first item as the only plain-text representation. */
const withPlainText = (items: NativePasteboardItem[], text: string): NativePasteboardItem[] => {
  if (!text) return items
  if (items.length === 0) return [{ representations: [textRepresentation(text)] }]

  const [first, ...rest] = items
  const representations = first.representations.filter(
    (representation) => representation.type !== PLAIN_TEXT_UTI && representation.type !== UTF16_TEXT_UTI
  )
  return [{ representations: [...representations, textRepresentation(text)] }, ...rest]
}

/** The stored representations untouched (plus the temp image file URL for image items). */
const richItems = (payload: ClipWritePayload, imageFileUrl?: string): NativePasteboardItem[] => {
  const items = payload.items.map(cloneItem)
  if (items.length === 0) {
    const text = payloadPlainText(payload)
    return text ? [{ representations: [textRepresentation(text)] }] : []
  }

  if (payload.kind === 'image' && imageFileUrl) {
    items[0].representations.push(fileUrlRepresentation(imageFileUrl))
  }

  return items
}

/** Plain paste of one item: text only; file items keep their file URLs; an image without text stays an image. */
const plainItems = (payload: ClipWritePayload, imageFileUrl?: string): NativePasteboardItem[] => {
  const text = payloadPlainText(payload)
  const files = fileUrlItems(payload)

  if (files.length > 0) {
    return withPlainText(files, text)
  }

  if (text) {
    return [{ representations: [textRepresentation(text)] }]
  }

  return richItems(payload, imageFileUrl)
}

export const composeWriteItems = (payloads: ClipWritePayload[], options: ComposeOptions): ComposeResult => {
  const imageUrl = (payload: ClipWritePayload) => options.imageFileUrl?.(payload)

  if (payloads.length === 0) {
    return { items: [], strategy: 'single-rich' }
  }

  if (payloads.length === 1) {
    const [payload] = payloads
    return options.plain
      ? { items: plainItems(payload, imageUrl(payload)), strategy: 'single-plain' }
      : { items: richItems(payload, imageUrl(payload)), strategy: 'single-rich' }
  }

  const joined = payloads
    .map(payloadPlainText)
    .filter((text) => text.length > 0)
    .join('\n')

  // Only files: merge every file URL, one pasteboard item per file (Finder pastes them all).
  if (payloads.every((payload) => payload.kind === 'file')) {
    return { items: withPlainText(payloads.flatMap(fileUrlItems), joined), strategy: 'multi-files' }
  }

  // Images mixed in: a pasteboard cannot hold several images sensibly, so the first item wins.
  // Rich mode writes its full payload plus the joined text; plain mode falls back to text only.
  if (payloads.some((payload) => payload.kind === 'image')) {
    const [first] = payloads
    if (options.plain) {
      return joined
        ? { items: [{ representations: [textRepresentation(joined)] }], strategy: 'multi-text' }
        : { items: plainItems(first, imageUrl(first)), strategy: 'multi-first-payload' }
    }
    return {
      items: withPlainText(richItems(first, imageUrl(first)), joined),
      strategy: 'multi-first-payload',
    }
  }

  if (joined) {
    return { items: [{ representations: [textRepresentation(joined)] }], strategy: 'multi-text' }
  }

  const [first] = payloads
  return { items: richItems(first, imageUrl(first)), strategy: 'multi-first-payload' }
}
