// Public entry of the search package. Runs in the store worker thread and in tests — no Electron imports.
export type * from '@/lib/clipboard/search/contract'

export { parseClipQuery, computeDateRange, intersectDateRanges } from '@/lib/clipboard/search/query-parser'
export type { ClipDateValue } from '@/lib/clipboard/search/query-parser'
export { searchClips } from '@/lib/clipboard/search/keyword-search'
export { computeLocalTags } from '@/lib/clipboard/search/local-tags'
