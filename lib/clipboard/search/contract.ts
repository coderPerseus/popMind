// Search contract. Implemented by the search work package (search/*.ts), executed inside the store
// worker thread (it receives the worker's DatabaseSync). Must not import Electron.
import type { DatabaseSync } from 'node:sqlite'
import type { ClipQuery, ClipSearchMatch, ClipSubKind, ParsedClipQuery } from '@/lib/clipboard/types'

export type ClipSearchContext = {
  now: number
  /** Known source apps, for `app:` tokens and app-name detection. */
  apps: Array<{ bundleId: string; name: string }>
  pinboards: Array<{ id: string; name: string }>
}

export type ClipSearchHit = {
  id: string
  score: number
  match?: ClipSearchMatch
}

export type ClipSearchPage = {
  hits: ClipSearchHit[]
  nextCursor?: string
  parsed: ParsedClipQuery
}

export type ClipSearchFn = (db: DatabaseSync, query: ClipQuery, context: ClipSearchContext) => ClipSearchPage

export type ClipQueryParseFn = (text: string, context: ClipSearchContext) => ParsedClipQuery

export type ClipLocalTagResult = {
  /** Lower-case tags, each may carry zh + en synonyms, e.g. ['phone', '电话', '手机']. */
  tags: string[]
  subKind?: ClipSubKind
}

export type ClipLocalTagFn = (text: string) => ClipLocalTagResult
