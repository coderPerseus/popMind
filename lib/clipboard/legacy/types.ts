export const clipboardHistoryKinds = ['text', 'image', 'file', 'link', 'color'] as const

export type ClipboardHistoryKind = (typeof clipboardHistoryKinds)[number]
export type ClipboardHistoryFilter = 'all' | ClipboardHistoryKind

export type ClipboardHistoryQueryInput = {
  query?: string
  filter?: ClipboardHistoryFilter
  limit?: number
}

export type ClipboardHistorySourceApp = {
  name?: string
  bundleId?: string
  pid?: number
}

export type ClipboardHistoryImageSummary = {
  width: number
  height: number
  thumbnailDataUrl?: string
}

export type ClipboardHistoryListItem = {
  id: string
  kind: ClipboardHistoryKind
  title: string
  previewText: string
  primaryValue?: string
  sourceApp?: ClipboardHistorySourceApp
  copiedAt: number
  createdAt: number
  updatedAt: number
  lastPastedAt?: number
  copyCount: number
  isPinned: boolean
  characterCount: number
  wordCount: number
  bytes: number
  fileCount: number
  image?: ClipboardHistoryImageSummary
}

export type ClipboardHistoryEntry = ClipboardHistoryListItem & {
  textContent?: string
  htmlContent?: string
  imageDataUrl?: string
  filePaths: string[]
}

export type ClipboardHistoryListResult = {
  items: ClipboardHistoryListItem[]
}

export type ClipboardHistoryWriteResult = {
  ok: boolean
  reason?: 'not_found' | 'write_failed' | 'unsupported'
}

export type ClipboardHistoryPasteResult = {
  ok: boolean
  reason?: 'not_found' | 'no_target' | 'write_failed' | 'paste_failed' | 'unsupported'
}

export type ClipboardHistoryDeleteResult = {
  ok: boolean
  deletedCount: number
}

export type ClipboardHistoryClearResult = {
  ok: boolean
  deletedCount: number
}

export type ClipboardHistoryPinResult = {
  ok: boolean
  isPinned: boolean
}
