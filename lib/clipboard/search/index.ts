// Public entry of the search package. The bodies below are FOUNDATION STUBS so the tree compiles;
// the search work package replaces them with query-parser.ts / keyword-search.ts / ranker.ts / local-tags.ts.
import type { ClipLocalTagFn, ClipQueryParseFn, ClipSearchFn } from '@/lib/clipboard/search/contract'

export type * from '@/lib/clipboard/search/contract'

export const parseClipQuery: ClipQueryParseFn = (text) => ({
  keywords: text.split(/\s+/).filter(Boolean),
  kinds: [],
  appBundleIds: [],
  tokens: [],
  suggestions: [],
})

export const searchClips: ClipSearchFn = (db, query, context) => {
  const parsed = parseClipQuery(query.text ?? '', context)
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 200)
  const rows = db
    .prepare('SELECT id FROM clip_items WHERE deleted_at IS NULL ORDER BY last_copied_at DESC LIMIT ?')
    .all(limit) as Array<{ id: string }>
  return { hits: rows.map((row) => ({ id: row.id, score: 0 })), parsed }
}

export const computeLocalTags: ClipLocalTagFn = () => ({ tags: [] })
