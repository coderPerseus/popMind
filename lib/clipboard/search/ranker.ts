// Ranking + match (snippet / highlight) building for keyword search (spec §6.4).
import type { ClipSearchField, ClipSearchMatch } from '@/lib/clipboard/types'

const DAY_MS = 24 * 60 * 60 * 1000

/** Column order of the `clip_search` FTS5 table — bm25() weights must follow it. */
export const FTS_COLUMNS: ClipSearchField[] = ['title', 'body', 'ocr', 'tags', 'app', 'url']

/** Field weights: title 5, body 3, ocr 1.5, tags 2, app 1, url 1. */
export const FIELD_WEIGHTS: Record<ClipSearchField, number> = {
  title: 5,
  body: 3,
  ocr: 1.5,
  tags: 2,
  app: 1,
  url: 1,
}

export const BM25_ARGS = FTS_COLUMNS.map((field) => FIELD_WEIGHTS[field]).join(', ')

export const RECENCY_HALF_LIFE_DAYS = 14

export type RankInput = {
  /** Text relevance, normalized to 0..1. */
  textScore: number
  lastCopiedAt: number
  useCount: number
  copyCount: number
  pinned: boolean
}

export const recencyScore = (lastCopiedAt: number, now: number): number => {
  const ageDays = Math.max(0, now - lastCopiedAt) / DAY_MS
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS)
}

/** log(use_count + copy_count) boost, 0 for a never reused item, saturating at ~20 uses. */
export const usageScore = (useCount: number, copyCount: number): number => {
  const total = Math.max(1, useCount + copyCount)
  return Math.min(1, Math.log(total) / Math.log(20))
}

/** Final score = text relevance + recency decay (half-life 14 days) + usage boost + small pinboard boost. */
export const rankScore = (input: RankInput, now: number): number =>
  0.62 * input.textScore +
  0.25 * recencyScore(input.lastCopiedAt, now) +
  0.08 * usageScore(input.useCount, input.copyCount) +
  (input.pinned ? 0.05 : 0)

/** Text score for LIKE hits from the weighted field hits (`ls` = sum over keywords and fields of field weight). */
export const likeTextScore = (weightedHits: number, keywordCount: number): number =>
  keywordCount <= 0 ? 0 : 1 - Math.exp(-weightedHits / (keywordCount * 4))

// ---------------------------------------------------------------------------------------------
// Match building
// ---------------------------------------------------------------------------------------------

export const SNIPPET_LENGTH = 120

export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const buildKeywordRegex = (keywords: string[]): RegExp | undefined => {
  const parts = keywords
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  return parts.length ? new RegExp(parts.join('|'), 'gi') : undefined
}

const collapse = (value: string): string => value.replace(/\s+/g, ' ')

const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff
const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff

const ranges = (snippet: string, pattern: RegExp, offset: number): Array<[number, number]> => {
  const result: Array<[number, number]> = []
  pattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(snippet))) {
    if (!match[0]) {
      pattern.lastIndex++
      continue
    }
    result.push([offset + match.index, offset + match.index + match[0].length])
  }
  return result
}

/** ~120 char snippet centered on the first hit, whitespace collapsed, with `…` on truncated sides. */
export const snippetAround = (
  text: string,
  pattern: RegExp
): { snippet: string; ranges: Array<[number, number]> } | undefined => {
  pattern.lastIndex = 0
  const first = pattern.exec(text)
  if (!first || !first[0]) return undefined
  const hitIndex = first.index
  const hitLength = first[0].length

  const rawStart = Math.max(0, hitIndex - SNIPPET_LENGTH * 2)
  const rawEnd = Math.min(text.length, hitIndex + hitLength + SNIPPET_LENGTH * 2)
  const before = collapse(text.slice(rawStart, hitIndex))
  const after = collapse(text.slice(hitIndex + hitLength, rawEnd))
  const normalized = before + first[0] + after
  const hitStart = before.length

  let start = Math.max(0, hitStart - Math.max(0, Math.floor((SNIPPET_LENGTH - hitLength) / 2)))
  let end = Math.min(normalized.length, start + SNIPPET_LENGTH)
  start = Math.max(0, Math.min(start, end - SNIPPET_LENGTH))
  while (start < hitStart && normalized[start] === ' ') start++
  if (start > 0 && start < normalized.length && isLowSurrogate(normalized.charCodeAt(start))) start++
  if (end < normalized.length && end > start && isHighSurrogate(normalized.charCodeAt(end - 1))) end--

  const body = normalized.slice(start, end)
  const leading = rawStart > 0 || start > 0 ? '…' : ''
  const trailing = rawEnd < text.length || end < normalized.length ? '…' : ''
  return { snippet: leading + body + trailing, ranges: ranges(body, pattern, leading.length) }
}

/** Beginning of a text as a plain snippet (used when nothing can be highlighted). */
export const plainSnippet = (text: string): string => {
  const collapsed = collapse(text.slice(0, SNIPPET_LENGTH * 3)).trim()
  if (collapsed.length <= SNIPPET_LENGTH) return collapsed
  let end = SNIPPET_LENGTH
  if (isHighSurrogate(collapsed.charCodeAt(end - 1))) end--
  return `${collapsed.slice(0, end)}…`
}

export type MatchFields = Partial<Record<ClipSearchField, string | null | undefined>>

/**
 * Picks the best field (the one containing the most distinct keywords, ties broken by field weight) and builds
 * the snippet + highlight ranges from the stored text. Returns undefined when no keyword is found anywhere.
 */
export const buildMatch = (fields: MatchFields, keywords: string[]): ClipSearchMatch | undefined => {
  const pattern = buildKeywordRegex(keywords)
  if (!pattern) return undefined
  const lowered = keywords.map((keyword) => keyword.toLowerCase())

  const candidates: Array<{ field: ClipSearchField; count: number }> = []
  for (const field of FTS_COLUMNS) {
    const text = fields[field]
    if (!text) continue
    const lowerText = text.toLowerCase()
    const count = lowered.reduce((sum, keyword) => sum + (lowerText.includes(keyword) ? 1 : 0), 0)
    if (count > 0) candidates.push({ field, count })
  }
  candidates.sort((a, b) => b.count - a.count || FIELD_WEIGHTS[b.field] - FIELD_WEIGHTS[a.field])

  for (const candidate of candidates) {
    const built = snippetAround(fields[candidate.field] as string, pattern)
    if (built) return { field: candidate.field, snippet: built.snippet, ranges: built.ranges }
  }
  return undefined
}
