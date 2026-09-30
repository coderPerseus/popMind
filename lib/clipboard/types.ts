// Shared clipboard domain types (main + renderer + worker). Keep this file free of Electron / Node imports.
// This is the contract between work packages — change it only together with every consumer.
// Spec: docs/clipboard-paste-redesign.md

export const clipKinds = ['text', 'link', 'image', 'file', 'color'] as const
export type ClipKind = (typeof clipKinds)[number]

/** Finer grained label produced by local tagging, used for card icons and filters. */
export type ClipSubKind = 'email' | 'phone' | 'path' | 'code' | 'json' | 'markdown' | 'number'

export type ClipSourceApp = {
  bundleId: string
  name: string
  /** Dominant icon color, `#rrggbb`. Card header background. */
  color?: string
  /** `popmind-clip://app-icon/<bundleId>` */
  iconUrl?: string
}

export type ClipSearchField = 'title' | 'body' | 'ocr' | 'tags' | 'app' | 'url'

export type ClipSearchMatch = {
  field: ClipSearchField
  /** Short excerpt around the hit (plain text). */
  snippet: string
  /** Highlight ranges inside `snippet`, [start, end) in UTF-16 code units. */
  ranges: Array<[number, number]>
}

export type ClipListItem = {
  id: string
  kind: ClipKind
  subKind?: ClipSubKind
  isRich: boolean
  /** customTitle when set, otherwise a derived title. */
  title: string
  customTitle?: string
  previewText: string
  url?: string
  colorValue?: string
  fileCount: number
  /** First few file names for file cards. */
  fileNames?: string[]
  imageWidth?: number
  imageHeight?: number
  byteSize: number
  charCount: number
  source?: ClipSourceApp
  /** Came from Universal Clipboard (iPhone / iPad). */
  isRemote: boolean
  createdAt: number
  lastCopiedAt: number
  lastUsedAt?: number
  copyCount: number
  useCount: number
  pinboardIds: string[]
  hasOcrText: boolean
  /** `popmind-clip://thumb/<id>` for images (and files with previews). */
  thumbnailUrl?: string
  /** Present only in search results. */
  match?: ClipSearchMatch
}

export type ClipDetail = ClipListItem & {
  plainText?: string
  /** Raw HTML as copied. Renderer must only show it inside a sandboxed iframe. */
  html?: string
  hasRtf: boolean
  filePaths: string[]
  ocrText?: string
  tags: string[]
  /** `popmind-clip://image/<id>` full-size image. */
  imageUrl?: string
}

export type Pinboard = {
  id: string
  name: string
  /** One of `pinboardColors`. */
  color: string
  sortOrder: number
  itemCount: number
}

export const pinboardColors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const

export type ClipScope = { type: 'history' } | { type: 'pinboard'; pinboardId: string }

export type ClipDateRange = {
  /** Inclusive epoch ms. */
  from?: number
  /** Exclusive epoch ms. */
  to?: number
}

export const clipDatePresets = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'last_7_days',
  'last_30_days',
] as const
export type ClipDatePreset = (typeof clipDatePresets)[number]

export type ClipQuery = {
  /** Raw search box text, may contain inline filter tokens (`type:image`, `app:微信`, `上周` …). */
  text?: string
  scope?: ClipScope
  /** Filters the UI already holds as chips (merged with tokens parsed from `text`). */
  kinds?: ClipKind[]
  appBundleIds?: string[]
  dateRange?: ClipDateRange
  /** Opaque cursor from the previous page. */
  cursor?: string
  /** Page size, default 100, max 200. */
  limit?: number
}

export type ClipQueryTokenKind = 'type' | 'app' | 'date' | 'pinboard'

export type ClipQueryToken = {
  kind: ClipQueryTokenKind
  /** Machine value: ClipKind / bundleId / ClipDatePreset / pinboardId. */
  value: string
  /** Display label for the chip. */
  label: string
  /** Position of the token in the raw text, so the UI can strip it when turning it into a chip. */
  start: number
  end: number
}

export type ParsedClipQuery = {
  /** Remaining free-text keywords after tokens are removed. */
  keywords: string[]
  kinds: ClipKind[]
  appBundleIds: string[]
  dateRange?: ClipDateRange
  datePreset?: ClipDatePreset
  pinboardId?: string
  tokens: ClipQueryToken[]
  /** Tokens the parser thinks the user may want but did not confirm (Paste-style suggestions). */
  suggestions: ClipQueryToken[]
}

export type ClipListResult = {
  items: ClipListItem[]
  nextCursor?: string
  parsed: ParsedClipQuery
  tookMs: number
}

export type ClipAiSearchStatus = 'ok' | 'disabled' | 'no_match' | 'timeout' | 'error'

export type ClipAiIntent = {
  kind?: ClipKind
  datePreset?: ClipDatePreset
  appBundleId?: string
  /** User wants every item of a category rather than one specific item. */
  wantsAll: boolean
}

export type ClipAiSearchResult = {
  status: ClipAiSearchStatus
  /** Ranked best-first. */
  items: ClipListItem[]
  /** Parallel to `items`: model probability 0..1. */
  scores: number[]
  intent?: ClipAiIntent
  inputTokens?: number
  tookMs: number
  errorMessage?: string
}

export type ClipPasteMode = 'default' | 'plainText'

export type ClipPasteResult = {
  ok: boolean
  /** `copied` means the item is on the clipboard but no ⌘V was sent. */
  action: 'pasted' | 'copied' | 'none'
  reason?: 'not_found' | 'no_permission' | 'secure_input' | 'no_target' | 'write_failed'
}

export type ClipWriteResult = {
  ok: boolean
  reason?: 'not_found' | 'write_failed'
}

export type ClipDeleteResult = {
  ok: boolean
  deletedIds: string[]
  /** Pass to `clip-undo-delete` within the undo window (5 s). */
  undoToken?: string
}

export type ClipStats = {
  itemCount: number
  pinnedItemCount: number
  databaseBytes: number
  blobBytes: number
  ocrPending: number
}

export type ClipItemsChangedEvent = {
  reason: 'added' | 'bumped' | 'updated' | 'deleted' | 'cleared' | 'pinboards'
  ids: string[]
}

export type ClipPanelShowEvent = {
  openedAt: number
  /** Name of the app that will receive the paste, for the footer hint. */
  targetAppName?: string
  /** Direct paste is possible (accessibility granted, not secure input). */
  canDirectPaste: boolean
  /** Optional initial search text (e.g. from `/clip foo` in the launcher). */
  initialQuery?: string
}

export type ClipPasteStackState = {
  active: boolean
  /** Items waiting to be pasted, first = next. */
  items: ClipListItem[]
}

export type ClipAiTestResult = {
  ok: boolean
  model?: string
  errorMessage?: string
}

// ---- settings (persisted inside CapabilitySettings.clipboard) ----

export const clipRetentionOptions = ['1d', '1w', '1m', '1y', 'forever'] as const
export type ClipRetention = (typeof clipRetentionOptions)[number]

export type ClipAiTrigger = 'manual' | 'auto'

/** Theme of the clipboard panel only; `app` follows the app theme (Settings → General). */
export const clipAppearances = ['dark', 'light', 'app'] as const
export type ClipAppearance = (typeof clipAppearances)[number]

export type ClipboardSettings = {
  /** Master switch for capturing. */
  enabled: boolean
  appearance: ClipAppearance
  retention: ClipRetention
  /** Storage cap in MB, oldest unpinned items are removed first. 0 = unlimited. */
  maxStorageMb: number
  /** Items bigger than this are not captured. */
  maxItemMb: number
  /** Enter pastes into the frontmost app; false = only copy. */
  directPaste: boolean
  alwaysPlainText: boolean
  fetchLinkPreviews: boolean
  /** Epoch ms until which capture is paused. 0 = not paused, -1 = until resumed. */
  pausedUntil: number
  privacy: {
    ignoredBundleIds: string[]
    ignoreConfidential: boolean
    ignoreTransient: boolean
    detectSecrets: boolean
    /** User regular expressions; matching text is not captured. */
    ignoreRegexps: string[]
  }
  ocr: {
    enabled: boolean
  }
  ai: {
    enabled: boolean
    provider: 'jev'
    apiKey: string
    model: string
    trigger: ClipAiTrigger
    /** Monthly usage counter, reset when month changes. */
    usage: { month: string; inputTokens: number }
  }
}

export const defaultClipboardSettings: ClipboardSettings = {
  enabled: true,
  appearance: 'dark',
  retention: '1m',
  maxStorageMb: 2048,
  maxItemMb: 20,
  directPaste: true,
  alwaysPlainText: false,
  fetchLinkPreviews: true,
  pausedUntil: 0,
  privacy: {
    ignoredBundleIds: [
      'com.apple.keychainaccess',
      'com.apple.Passwords',
      'com.1password.1password',
      'com.agilebits.onepassword7',
      'com.bitwarden.desktop',
    ],
    ignoreConfidential: true,
    ignoreTransient: true,
    detectSecrets: true,
    ignoreRegexps: [],
  },
  ocr: {
    enabled: true,
  },
  ai: {
    enabled: false,
    provider: 'jev',
    apiKey: '',
    model: 'jev-latest',
    trigger: 'manual',
    usage: { month: '', inputTokens: 0 },
  },
}

export type ClipboardSettingsPatch = {
  enabled?: boolean
  appearance?: ClipAppearance
  retention?: ClipRetention
  maxStorageMb?: number
  maxItemMb?: number
  directPaste?: boolean
  alwaysPlainText?: boolean
  fetchLinkPreviews?: boolean
  pausedUntil?: number
  privacy?: Partial<ClipboardSettings['privacy']>
  ocr?: Partial<ClipboardSettings['ocr']>
  ai?: Partial<Omit<ClipboardSettings['ai'], 'usage'>> & { usage?: ClipboardSettings['ai']['usage'] }
}

export const mergeClipboardSettings = (
  previous: ClipboardSettings | undefined,
  patch: ClipboardSettingsPatch | undefined
): ClipboardSettings => {
  const base = previous ?? defaultClipboardSettings
  return {
    ...defaultClipboardSettings,
    ...base,
    ...patch,
    privacy: { ...defaultClipboardSettings.privacy, ...base.privacy, ...patch?.privacy },
    ocr: { ...defaultClipboardSettings.ocr, ...base.ocr, ...patch?.ocr },
    ai: {
      ...defaultClipboardSettings.ai,
      ...base.ai,
      ...patch?.ai,
      usage: patch?.ai?.usage ?? base.ai?.usage ?? defaultClipboardSettings.ai.usage,
    },
  }
}

// ---- constants shared by native + main ----

/** Pasteboard type popMind adds to everything it writes; value = item id or a reason string. */
export const POPMIND_PASTEBOARD_MARKER = 'app.popmind.clipboard.writeback'

/** Custom protocol serving thumbnails / images / app icons to the renderer. */
export const CLIP_PROTOCOL = 'popmind-clip'
