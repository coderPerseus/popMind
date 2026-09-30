// AI (Jev) search contract. Implemented in search/ai/*.ts, runs in the main process (network),
// talks to the store only through this port.
import type { ClipAiCandidate, ClipAiCandidateQuery } from '@/lib/clipboard/store/contract'
import type {
  ClipAiSearchResult,
  ClipAiTestResult,
  ClipListItem,
  ClipQuery,
  ClipSourceApp,
  ClipboardSettings,
} from '@/lib/clipboard/types'

export type ClipAiSearchPort = {
  listApps(): Promise<ClipSourceApp[]>
  getAiCandidates(query: ClipAiCandidateQuery): Promise<ClipAiCandidate[]>
  getItemsByIds(ids: string[]): Promise<ClipListItem[]>
}

export type ClipAiSearchInput = {
  /** Raw search text. */
  text: string
  /** Filters already active in the UI; the AI intent can only narrow them further. */
  filters: Pick<ClipQuery, 'kinds' | 'appBundleIds' | 'dateRange' | 'scope'>
  settings: ClipboardSettings['ai']
  port: ClipAiSearchPort
  now: number
  signal?: AbortSignal
}

export type ClipAiSearchFn = (input: ClipAiSearchInput) => Promise<ClipAiSearchResult>

export type ClipAiTestFn = (settings: ClipboardSettings['ai']) => Promise<ClipAiTestResult>
