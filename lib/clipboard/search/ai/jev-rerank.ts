// Rerank (spec §7.2 step 3), modeled on TypeSafe's "semantic_find" cookbook:
//   state    = candidates as lines `C001| [kind][app][age] text`
//   choice   = which line best matches the query? options C001…Cnnn (criteria null: the state already has the text)
//   noul     = does any line match at all?
// The choice probability distribution is the ranking. More than 255 candidates or more than ~28k tokens are split
// into groups that run in parallel, followed by a final round over each group's top 5.
import { JevError, choice, jevRequest, noul, type JevRequestOptions } from '@/lib/clipboard/search/ai/jev-client'
import type { ClipAiCandidate } from '@/lib/clipboard/store/contract'

/** A choice question holds at most 255 options. */
export const MAX_OPTIONS_PER_REQUEST = 255
/** Jev accepts 32k tokens of state + longest question; stay below that. */
export const STATE_TOKEN_BUDGET = 28_000
export const LINE_TEXT_MAX_CHARS = 300
export const FINALISTS_PER_GROUP = 5

export type RankedCandidate = { id: string; probability: number }

export type RerankOutcome = {
  /** Best first. Every candidate appears exactly once. */
  ranked: RankedCandidate[]
  /** Probability that at least one candidate matches (noul). */
  existsProbability: number
  inputTokens: number
  requests: number
}

// ---------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------

const optionKey = (index: number): string => `C${String(index + 1).padStart(3, '0')}`

export const relativeAge = (now: number, timestamp: number): string => {
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000))
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 2) return 'yesterday'
  if (days < 14) return `${days}d ago`
  if (days < 60) return `${Math.round(days / 7)}w ago`
  return `${Math.round(days / 30)}mo ago`
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff

const cleanText = (text: string): string => {
  let value = text
    .replace(/\s+/g, ' ')
    .replace(/\bC\d{3}\|/g, ' ')
    .trim()
  if (value.length > LINE_TEXT_MAX_CHARS) {
    let end = LINE_TEXT_MAX_CHARS
    if (isHighSurrogate(value.charCodeAt(end - 1))) end--
    value = `${value.slice(0, end)}…`
  }
  return value
}

const kindLabel = (kind: ClipAiCandidate['kind']): string => (kind === 'image' ? 'image OCR' : kind)

export const formatCandidateLine = (key: string, candidate: ClipAiCandidate, now: number): string => {
  const app = candidate.appName?.replace(/[[\]\s]+/g, ' ').trim() || 'unknown app'
  return `${key}| [${kindLabel(candidate.kind)}][${app}][${relativeAge(now, candidate.lastCopiedAt)}] ${cleanText(candidate.text)}`
}

const CJK = /[⺀-鿿가-힯豈-﫿＀-￯]/g

/** 1 token ≈ 3 chars for CJK-heavy text, 4 for Latin text (+ a few tokens per line for id / separators). */
export const estimateTokens = (text: string): number => {
  const cjk = text.match(CJK)?.length ?? 0
  const charsPerToken = cjk / Math.max(text.length, 1) > 0.3 ? 3 : 4
  return Math.ceil(text.length / charsPerToken) + 4
}

/** Splits candidates (in order) into balanced groups that respect the option and token limits. */
export const splitCandidates = (
  candidates: ClipAiCandidate[],
  lineTokens: number[],
  maxOptions = MAX_OPTIONS_PER_REQUEST,
  tokenBudget = STATE_TOKEN_BUDGET
): ClipAiCandidate[][] => {
  const totalTokens = lineTokens.reduce((sum, value) => sum + value, 0)
  const groupCount = Math.max(1, Math.ceil(candidates.length / maxOptions), Math.ceil(totalTokens / tokenBudget))
  if (groupCount === 1) return [candidates]
  const perGroupCount = Math.min(maxOptions, Math.ceil(candidates.length / groupCount))
  const perGroupTokens = Math.min(tokenBudget, Math.ceil(totalTokens / groupCount) + Math.max(...lineTokens))
  const groups: ClipAiCandidate[][] = []
  let current: ClipAiCandidate[] = []
  let currentTokens = 0
  candidates.forEach((candidate, index) => {
    const tokens = lineTokens[index]
    if (current.length && (current.length >= perGroupCount || currentTokens + tokens > perGroupTokens)) {
      groups.push(current)
      current = []
      currentTokens = 0
    }
    current.push(candidate)
    currentTokens += tokens
  })
  if (current.length) groups.push(current)
  return groups
}

// ---------------------------------------------------------------------------------------------
// One request
// ---------------------------------------------------------------------------------------------

type GroupOutcome = { ranked: RankedCandidate[]; exists: number; inputTokens: number; requests: number }

const rerankOnce = async (
  options: JevRequestOptions,
  query: string,
  candidates: ClipAiCandidate[],
  now: number
): Promise<GroupOutcome> => {
  const keys = candidates.map((_, index) => optionKey(index))
  const state = candidates.map((candidate, index) => formatCandidateLine(keys[index], candidate, now)).join('\n')
  const criteria: Record<string, null> = {}
  for (const key of keys) criteria[key] = null

  const response = await jevRequest(options, state, {
    best: choice(
      `Each line of the state is one item from the user's clipboard history, formatted as ID| [type][source app][age] content. Which item best matches what the user is looking for: "${query}"?`,
      criteria
    ),
    exists: noul(`Does any item in the state match what the user is looking for: "${query}"?`, {
      true: 'At least one item is what the user is looking for',
      false: 'No item is what the user is looking for; the items are unrelated or only loosely related',
    }),
  })

  const probabilities = response.answers.best.probabilities
  const ranked = candidates
    .map((candidate, index) => ({ id: candidate.id, probability: probabilities[keys[index]] ?? 0, index }))
    .sort((a, b) => b.probability - a.probability || a.index - b.index)
    .map(({ id, probability }) => ({ id, probability }))
  return { ranked, exists: response.answers.exists.noul, inputTokens: response.inputTokens, requests: 1 }
}

/** Runs one group; if Jev rejects it as too large (422) the group is split in half and retried. */
const rerankGroup = async (
  options: JevRequestOptions,
  query: string,
  candidates: ClipAiCandidate[],
  now: number,
  depth = 0
): Promise<GroupOutcome> => {
  try {
    return await rerankOnce(options, query, candidates, now)
  } catch (error) {
    if (!(error instanceof JevError) || error.code !== 'invalid_request' || candidates.length < 2 || depth >= 3) {
      throw error
    }
    const middle = Math.ceil(candidates.length / 2)
    const [left, right] = await Promise.all([
      rerankGroup(options, query, candidates.slice(0, middle), now, depth + 1),
      rerankGroup(options, query, candidates.slice(middle), now, depth + 1),
    ])
    return {
      ranked: [...left.ranked, ...right.ranked].sort((a, b) => b.probability - a.probability),
      exists: Math.max(left.exists, right.exists),
      inputTokens: left.inputTokens + right.inputTokens,
      requests: left.requests + right.requests + 1,
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------------------------

export const rerankCandidates = async (
  options: JevRequestOptions,
  query: string,
  candidates: ClipAiCandidate[],
  now: number
): Promise<RerankOutcome> => {
  if (candidates.length === 0) return { ranked: [], existsProbability: 0, inputTokens: 0, requests: 0 }

  const lineTokens = candidates.map((candidate, index) =>
    estimateTokens(formatCandidateLine(optionKey(index), candidate, now))
  )
  const groups = splitCandidates(candidates, lineTokens)

  const outcomes = await Promise.all(groups.map((group) => rerankGroup(options, query, group, now)))
  let inputTokens = outcomes.reduce((sum, outcome) => sum + outcome.inputTokens, 0)
  let requests = outcomes.reduce((sum, outcome) => sum + outcome.requests, 0)

  if (outcomes.length === 1) {
    return { ranked: outcomes[0].ranked, existsProbability: outcomes[0].exists, inputTokens, requests }
  }

  // Final round over each group's top 5.
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const finalistIds = new Set<string>()
  for (const outcome of outcomes) {
    for (const item of outcome.ranked.slice(0, FINALISTS_PER_GROUP)) finalistIds.add(item.id)
  }
  const finalists = [...finalistIds].map((id) => byId.get(id) as ClipAiCandidate)
  const final = await rerankGroup(options, query, finalists, now)
  inputTokens += final.inputTokens
  requests += final.requests

  const rest = outcomes
    .flatMap((outcome) => outcome.ranked)
    .filter((item) => !finalistIds.has(item.id))
    .sort((a, b) => b.probability - a.probability)
  const ranked: RankedCandidate[] = []
  let ceiling = 1
  for (const item of [...final.ranked, ...rest]) {
    // Keep scores non-increasing across the final round / group boundary.
    const probability = Math.min(item.probability, ceiling)
    ceiling = probability
    ranked.push({ id: item.id, probability })
  }
  return { ranked, existsProbability: final.exists, inputTokens, requests }
}
