// Keyword search over clipboard.sqlite (spec §6.4). Runs inside the store worker with its DatabaseSync.
//   - browse mode (no keywords): filters + keyset paging by last_copied_at (or manual order in a pinboard)
//   - keyword mode: FTS5 trigram MATCH for keywords with >= 3 characters, LIKE for shorter ones,
//     fuzzy fallback over the 2000 most recent titles/previews when nothing matched
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { ClipSearchContext, ClipSearchFn, ClipSearchHit, ClipSearchPage } from '@/lib/clipboard/search/contract'
import { intersectDateRanges, parseClipQuery } from '@/lib/clipboard/search/query-parser'
import {
  BM25_ARGS,
  FIELD_WEIGHTS,
  FTS_COLUMNS,
  buildMatch,
  likeTextScore,
  plainSnippet,
  rankScore,
} from '@/lib/clipboard/search/ranker'
import type { ClipDateRange, ClipKind, ClipQuery, ClipSearchMatch } from '@/lib/clipboard/types'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200
/** Max rows pulled from SQL before JS re-ranking (also the deepest reachable offset). */
const CANDIDATE_CAP = 1000
const FUZZY_SCAN_LIMIT = 2000
const FTS_MIN_CHARS = 3

type Filters = {
  kinds: ClipKind[]
  appBundleIds: string[]
  dateRange?: ClipDateRange
  pinboardId?: string
}

type SqlParts = { join: string; joinParams: SQLInputValue[]; where: string[]; whereParams: SQLInputValue[] }

const buildFilterSql = (filters: Filters): SqlParts => {
  const parts: SqlParts = { join: '', joinParams: [], where: ['i.deleted_at IS NULL'], whereParams: [] }
  if (filters.pinboardId) {
    parts.join = 'JOIN pinboard_items pi ON pi.item_id = i.id AND pi.pinboard_id = ?'
    parts.joinParams.push(filters.pinboardId)
  }
  if (filters.kinds.length) {
    parts.where.push(`i.kind IN (${filters.kinds.map(() => '?').join(',')})`)
    parts.whereParams.push(...filters.kinds)
  }
  if (filters.appBundleIds.length) {
    parts.where.push(`i.source_bundle_id IN (${filters.appBundleIds.map(() => '?').join(',')})`)
    parts.whereParams.push(...filters.appBundleIds)
  }
  if (filters.dateRange?.from !== undefined) {
    parts.where.push('i.last_copied_at >= ?')
    parts.whereParams.push(filters.dateRange.from)
  }
  if (filters.dateRange?.to !== undefined) {
    parts.where.push('i.last_copied_at < ?')
    parts.whereParams.push(filters.dateRange.to)
  }
  return parts
}

// ---------------------------------------------------------------------------------------------
// Cursors (opaque base64url JSON)
// ---------------------------------------------------------------------------------------------

type Cursor =
  | { m: 'b'; t: number; id: string } // browse, history scope
  | { m: 'p'; s: number; id: string } // browse, pinboard scope
  | { m: 'k' | 'f'; o: number } // keyword / fuzzy offset

const encodeCursor = (cursor: Cursor): string => Buffer.from(JSON.stringify(cursor)).toString('base64url')

const decodeCursor = (raw?: string): Cursor | undefined => {
  if (!raw) return undefined
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor
    if (value.m === 'b' && typeof value.t === 'number' && typeof value.id === 'string') return value
    if (value.m === 'p' && typeof value.s === 'number' && typeof value.id === 'string') return value
    if ((value.m === 'k' || value.m === 'f') && Number.isInteger(value.o) && value.o >= 0) return value
  } catch {
    // malformed cursor: start from the first page
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const codePointLength = (value: string): number => {
  let length = 0
  for (const _ of value) length++
  return length
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&')

const ftsExpression = (keywords: string[]): string =>
  keywords.map((keyword) => `"${keyword.replace(/"/g, '""')}"*`).join(' ')

type BaseRow = { id: string; t: number; u: number; c: number; pinned: number }
type KeywordRow = BaseRow & { b?: number; ls?: number }

const PINNED_EXPR = 'EXISTS (SELECT 1 FROM pinboard_items x WHERE x.item_id = i.id)'

// ---------------------------------------------------------------------------------------------
// Browse mode
// ---------------------------------------------------------------------------------------------

const browse = (db: DatabaseSync, filters: Filters, cursor: Cursor | undefined, limit: number) => {
  const parts = buildFilterSql(filters)
  const where = [...parts.where]
  const params: SQLInputValue[] = [...parts.joinParams, ...parts.whereParams]
  const pinboardScope = Boolean(filters.pinboardId)

  if (pinboardScope) {
    if (cursor?.m === 'p') {
      where.push('(pi.sort_order > ? OR (pi.sort_order = ? AND i.id > ?))')
      params.push(cursor.s, cursor.s, cursor.id)
    }
  } else if (cursor?.m === 'b') {
    where.push('(i.last_copied_at < ? OR (i.last_copied_at = ? AND i.id > ?))')
    params.push(cursor.t, cursor.t, cursor.id)
  }

  const sql = `SELECT i.id AS id, i.last_copied_at AS t${pinboardScope ? ', pi.sort_order AS s' : ''}
    FROM clip_items i ${parts.join}
    WHERE ${where.join(' AND ')}
    ORDER BY ${pinboardScope ? 'pi.sort_order ASC, i.id ASC' : 'i.last_copied_at DESC, i.id ASC'}
    LIMIT ?`
  const rows = db.prepare(sql).all(...params, limit + 1) as unknown as Array<{ id: string; t: number; s?: number }>
  const page = rows.slice(0, limit)
  const hits: ClipSearchHit[] = page.map((row) => ({ id: row.id, score: 0 }))
  let nextCursor: string | undefined
  if (rows.length > limit && page.length) {
    const last = page[page.length - 1]
    nextCursor = pinboardScope
      ? encodeCursor({ m: 'p', s: last.s ?? 0, id: last.id })
      : encodeCursor({ m: 'b', t: last.t, id: last.id })
  }
  return { hits, nextCursor }
}

// ---------------------------------------------------------------------------------------------
// Keyword mode
// ---------------------------------------------------------------------------------------------

const keywordCandidates = (db: DatabaseSync, filters: Filters, keywords: string[]): KeywordRow[] => {
  const long = keywords.filter((keyword) => codePointLength(keyword) >= FTS_MIN_CHARS)
  const short = keywords.filter((keyword) => codePointLength(keyword) < FTS_MIN_CHARS)

  const run = (useFts: boolean): KeywordRow[] => {
    const ftsKeywords = useFts ? long : []
    const likeKeywords = useFts ? short : keywords

    const parts = buildFilterSql(filters)
    const selectParams: SQLInputValue[] = []
    const selects = [
      'i.id AS id',
      'i.last_copied_at AS t',
      'i.use_count AS u',
      'i.copy_count AS c',
      `${filters.pinboardId ? '0' : PINNED_EXPR} AS pinned`,
    ]
    if (ftsKeywords.length) selects.push(`bm25(clip_search, ${BM25_ARGS}) AS b`)
    if (likeKeywords.length) {
      const terms: string[] = []
      for (const keyword of likeKeywords) {
        for (const field of FTS_COLUMNS) {
          terms.push(`(CASE WHEN clip_search.${field} LIKE ? ESCAPE '\\' THEN ${FIELD_WEIGHTS[field]} ELSE 0 END)`)
          selectParams.push(`%${escapeLike(keyword)}%`)
        }
      }
      selects.push(`(${terms.join(' + ')}) AS ls`)
    }

    const where: string[] = []
    const whereParams: SQLInputValue[] = []
    if (ftsKeywords.length) {
      where.push('clip_search MATCH ?')
      whereParams.push(ftsExpression(ftsKeywords))
    }
    where.push(...parts.where)
    whereParams.push(...parts.whereParams)
    for (const keyword of likeKeywords) {
      where.push(`(${FTS_COLUMNS.map((field) => `clip_search.${field} LIKE ? ESCAPE '\\'`).join(' OR ')})`)
      for (let index = 0; index < FTS_COLUMNS.length; index++) whereParams.push(`%${escapeLike(keyword)}%`)
    }

    const sql = `SELECT ${selects.join(', ')}
      FROM clip_search JOIN clip_items i ON i.rowid = clip_search.rowid ${parts.join}
      WHERE ${where.join(' AND ')}
      ORDER BY ${ftsKeywords.length ? 'b ASC' : 'i.last_copied_at DESC'}
      LIMIT ${CANDIDATE_CAP}`
    return db.prepare(sql).all(...selectParams, ...parts.joinParams, ...whereParams) as unknown as KeywordRow[]
  }

  if (long.length) {
    try {
      return run(true)
    } catch {
      // Unexpected FTS syntax problem: LIKE handles every keyword.
    }
  }
  return run(false)
}

const rankKeywordRows = (rows: KeywordRow[], keywords: string[], now: number, filters: Filters): ClipSearchHit[] => {
  const shortCount = keywords.filter((keyword) => codePointLength(keyword) < FTS_MIN_CHARS).length
  const hasFts = rows.some((row) => row.b !== undefined && row.b !== null)
  const longCount = hasFts ? keywords.length - shortCount : 0
  const likeCount = hasFts ? shortCount : keywords.length

  let maxBm25 = 0
  if (hasFts) for (const row of rows) maxBm25 = Math.max(maxBm25, -(row.b ?? 0))

  const scored = rows.map((row) => {
    let weighted = 0
    let parts = 0
    if (hasFts && longCount) {
      const raw = Math.max(0, -(row.b ?? 0))
      weighted += longCount * (maxBm25 > 0 ? raw / maxBm25 : 1)
      parts += longCount
    }
    if (likeCount && row.ls !== undefined && row.ls !== null) {
      weighted += likeCount * likeTextScore(row.ls, likeCount)
      parts += likeCount
    }
    const textScore = parts ? weighted / parts : 0
    const score = rankScore(
      {
        textScore,
        lastCopiedAt: row.t,
        useCount: row.u,
        copyCount: row.c,
        pinned: filters.pinboardId ? false : Boolean(row.pinned),
      },
      now
    )
    return { id: row.id, score, t: row.t }
  })
  scored.sort((a, b) => b.score - a.score || b.t - a.t || (a.id < b.id ? -1 : 1))
  return scored.map(({ id, score }) => ({ id, score }))
}

// ---------------------------------------------------------------------------------------------
// Fuzzy fallback
// ---------------------------------------------------------------------------------------------

const maxEditDistance = (length: number): number => (length <= 2 ? 0 : length <= 4 ? 1 : length <= 8 ? 2 : 3)

/** 0 = no match, 1 = exact substring. Approximate substring (edit distance) first, then loose subsequence. */
export const fuzzyKeywordScore = (keyword: string, text: string): number => {
  const pattern = keyword.toLowerCase()
  const haystack = text.toLowerCase().slice(0, 400)
  const n = pattern.length
  const size = haystack.length
  if (!n || !size) return 0
  if (haystack.includes(pattern)) return 1

  // Sellers algorithm (optimal-string-alignment flavour, so a swapped pair like "roadmpa" costs 1):
  // minimum edit distance between the pattern and any substring of the text. Works on UTF-16 code units.
  let previous = new Int32Array(n + 1)
  let beforePrevious = new Int32Array(n + 1)
  let current = new Int32Array(n + 1)
  for (let j = 0; j <= n; j++) previous[j] = j
  const patternCodes = new Uint16Array(n)
  for (let j = 0; j < n; j++) patternCodes[j] = pattern.charCodeAt(j)
  let previousChar = -1
  let best = n
  for (let i = 0; i < size; i++) {
    const char = haystack.charCodeAt(i)
    current[0] = 0
    for (let j = 1; j <= n; j++) {
      let value = previous[j - 1] + (patternCodes[j - 1] === char ? 0 : 1)
      const deletion = previous[j] + 1
      if (deletion < value) value = deletion
      const insertion = current[j - 1] + 1
      if (insertion < value) value = insertion
      if (i > 0 && j > 1 && patternCodes[j - 1] === previousChar && patternCodes[j - 2] === char) {
        const swap = beforePrevious[j - 2] + 1
        if (swap < value) value = swap
      }
      current[j] = value
    }
    if (current[n] < best) best = current[n]
    const recycled = beforePrevious
    beforePrevious = previous
    previous = current
    current = recycled
    previousChar = char
  }
  if (best === 0) return 1
  if (best <= maxEditDistance(n)) return Math.max(0.5, 1 - best / (n + 1))

  // Loose subsequence (characters in order within a small window) — covers dropped / inserted characters.
  if (n >= 2) {
    let minSpan = Infinity
    const first = patternCodes[0]
    for (let start = 0; start < size; start++) {
      if (haystack.charCodeAt(start) !== first) continue
      let position = 0
      let cursor = start
      while (cursor < size && position < n) {
        if (haystack.charCodeAt(cursor) === patternCodes[position]) position++
        cursor++
      }
      if (position === n) minSpan = Math.min(minSpan, cursor - start)
    }
    if (minSpan <= n * 2 + 2) return 0.4
  }
  return 0
}

type FuzzyRow = BaseRow & { title: string | null; preview: string | null }

const fuzzySearch = (
  db: DatabaseSync,
  filters: Filters,
  keywords: string[],
  now: number
): { hits: ClipSearchHit[]; rows: Map<string, FuzzyRow> } => {
  const parts = buildFilterSql(filters)
  const sql = `SELECT i.id AS id, i.last_copied_at AS t, i.use_count AS u, i.copy_count AS c,
      ${filters.pinboardId ? '0' : PINNED_EXPR} AS pinned, clip_search.title AS title, i.preview_text AS preview
    FROM clip_items i JOIN clip_search ON clip_search.rowid = i.rowid ${parts.join}
    WHERE ${parts.where.join(' AND ')}
    ORDER BY i.last_copied_at DESC
    LIMIT ${FUZZY_SCAN_LIMIT}`
  const rows = db.prepare(sql).all(...parts.joinParams, ...parts.whereParams) as unknown as FuzzyRow[]
  const byId = new Map<string, FuzzyRow>()
  const scored: Array<ClipSearchHit & { t: number }> = []
  for (const row of rows) {
    const haystack = `${row.title ?? ''} ${row.preview ?? ''}`
    let total = 0
    let matchedAll = true
    for (const keyword of keywords) {
      const score = fuzzyKeywordScore(keyword, haystack)
      if (score <= 0) {
        matchedAll = false
        break
      }
      total += score
    }
    if (!matchedAll) continue
    byId.set(row.id, row)
    const textScore = total / keywords.length
    scored.push({
      id: row.id,
      t: row.t,
      score: rankScore(
        {
          textScore,
          lastCopiedAt: row.t,
          useCount: row.u,
          copyCount: row.c,
          pinned: filters.pinboardId ? false : Boolean(row.pinned),
        },
        now
      ),
    })
  }
  scored.sort((a, b) => b.score - a.score || b.t - a.t || (a.id < b.id ? -1 : 1))
  return { hits: scored.map(({ id, score }) => ({ id, score })), rows: byId }
}

// ---------------------------------------------------------------------------------------------
// Match attachment
// ---------------------------------------------------------------------------------------------

const attachMatches = (
  db: DatabaseSync,
  hits: ClipSearchHit[],
  keywords: string[],
  fuzzyRows?: Map<string, FuzzyRow>
): void => {
  if (!hits.length) return
  const placeholders = hits.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT i.id AS id, clip_search.title AS title, clip_search.body AS body, clip_search.ocr AS ocr,
        clip_search.tags AS tags, clip_search.app AS app, clip_search.url AS url
       FROM clip_items i JOIN clip_search ON clip_search.rowid = i.rowid
       WHERE i.id IN (${placeholders})`
    )
    .all(...hits.map((hit) => hit.id)) as unknown as Array<{
    id: string
    title: string | null
    body: string | null
    ocr: string | null
    tags: string | null
    app: string | null
    url: string | null
  }>
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const hit of hits) {
    const row = byId.get(hit.id)
    if (!row) continue
    let match: ClipSearchMatch | undefined = buildMatch(row, keywords)
    if (!match) {
      // Fuzzy hit: nothing to highlight, show the beginning of the title / preview.
      const text = row.title || fuzzyRows?.get(hit.id)?.preview || row.body || ''
      if (text) match = { field: row.title ? 'title' : 'body', snippet: plainSnippet(text), ranges: [] }
    }
    if (match) hit.match = match
  }
}

// ---------------------------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------------------------

export const searchClips: ClipSearchFn = (
  db: DatabaseSync,
  query: ClipQuery,
  context: ClipSearchContext
): ClipSearchPage => {
  const parsed = parseClipQuery(query.text ?? '', context)
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const cursor = decodeCursor(query.cursor)

  // UI chips + tokens parsed from the text: same dimension = union (OR), different dimensions = AND.
  const filters: Filters = {
    kinds: [...new Set([...(query.kinds ?? []), ...parsed.kinds])],
    appBundleIds: [...new Set([...(query.appBundleIds ?? []), ...parsed.appBundleIds])],
    dateRange: intersectDateRanges(query.dateRange, parsed.dateRange),
    pinboardId: query.scope?.type === 'pinboard' ? query.scope.pinboardId : parsed.pinboardId,
  }

  if (parsed.keywords.length === 0) {
    const { hits, nextCursor } = browse(db, filters, cursor, limit)
    return { hits, nextCursor, parsed }
  }

  const offset = cursor?.m === 'k' || cursor?.m === 'f' ? cursor.o : 0
  const keywords = parsed.keywords

  let ranked: ClipSearchHit[] = []
  let mode: 'k' | 'f' = 'k'
  let fuzzyRows: Map<string, FuzzyRow> | undefined

  if (cursor?.m !== 'f') {
    ranked = rankKeywordRows(keywordCandidates(db, filters, keywords), keywords, context.now, filters)
  }
  if (ranked.length === 0 && (cursor?.m === 'f' || offset === 0)) {
    const fuzzy = fuzzySearch(db, filters, keywords, context.now)
    ranked = fuzzy.hits
    fuzzyRows = fuzzy.rows
    mode = 'f'
  }

  const hits = ranked.slice(offset, offset + limit)
  attachMatches(db, hits, keywords, fuzzyRows)
  const nextCursor = offset + limit < ranked.length ? encodeCursor({ m: mode, o: offset + limit }) : undefined
  return { hits, nextCursor, parsed }
}
