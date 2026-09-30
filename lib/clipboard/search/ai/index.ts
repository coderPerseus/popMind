// AI (Jev) search (spec §7.2). Runs in the main process (network); talks to the store only through `ClipAiSearchPort`.
// Flow: intent request (Jev) || candidate pool (local)  ->  narrow by intent  ->  rerank (Jev)  ->  ranked items.
import type { ClipAiSearchFn, ClipAiTestFn } from '@/lib/clipboard/search/ai/contract'
import { JevError, jevOptionsFromSettings, jevRequest, noul } from '@/lib/clipboard/search/ai/jev-client'
import { hasIntentFilters, runIntentRequest, type IntentOutcome } from '@/lib/clipboard/search/ai/jev-intent'
import { rerankCandidates } from '@/lib/clipboard/search/ai/jev-rerank'
import { intersectDateRanges } from '@/lib/clipboard/search/query-parser'
import type { ClipAiCandidate, ClipAiCandidateQuery } from '@/lib/clipboard/store/contract'
import type { ClipAiSearchResult, ClipDateRange, ClipListItem } from '@/lib/clipboard/types'

export type * from '@/lib/clipboard/search/ai/contract'
export { JevError } from '@/lib/clipboard/search/ai/jev-client'

const KEYWORD_POOL = 60
const RECENT_POOL = 150
const MAX_POOL = 200
/** Intent is optional, so it gets a shorter budget than the rerank. */
const INTENT_TIMEOUT_MS = 2000
const RERANK_TIMEOUT_MS = 3000
const TEST_TIMEOUT_MS = 5000
/** `exists` noul below this = nothing matches. */
const NO_MATCH_PROBABILITY = 0.2
const DEFAULT_RESULT_COUNT = 30
const WANTS_ALL_MIN_PROBABILITY = 0.005

const emptyResult = (
  status: ClipAiSearchResult['status'],
  startedAt: number,
  errorMessage?: string
): ClipAiSearchResult => ({
  status,
  items: [],
  scores: [],
  tookMs: Date.now() - startedAt,
  ...(errorMessage ? { errorMessage } : {}),
})

const narrowList = <T>(base: T[] | undefined, value: T | undefined): T[] | undefined => {
  if (value === undefined) return base
  if (!base?.length) return [value]
  // The user's own filter wins when the AI disagrees with it.
  return base.includes(value) ? [value] : base
}

const isEmptyRange = (range?: ClipDateRange): boolean =>
  Boolean(range && range.from !== undefined && range.to !== undefined && range.from >= range.to)

const dedupe = (candidates: ClipAiCandidate[]): ClipAiCandidate[] => {
  const seen = new Set<string>()
  const result: ClipAiCandidate[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue
    seen.add(candidate.id)
    result.push(candidate)
  }
  return result.slice(0, MAX_POOL)
}

export const runAiSearch: ClipAiSearchFn = async (input) => {
  const startedAt = Date.now()
  const { settings, port, filters } = input
  if (!settings.enabled || !settings.apiKey?.trim()) return emptyResult('disabled', startedAt)
  const query = input.text.trim()
  if (!query) return emptyResult('no_match', startedAt)

  // Own controller so dangling requests are cancelled once we are done or failed.
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  if (input.signal?.aborted) return emptyResult('error', startedAt, 'AI search was cancelled')
  input.signal?.addEventListener('abort', onCallerAbort, { once: true })

  const options = jevOptionsFromSettings(settings, { signal: controller.signal, timeoutMs: RERANK_TIMEOUT_MS })
  const candidateQuery = (recent: Partial<ClipAiCandidateQuery['recent']> = {}): ClipAiCandidateQuery => ({
    keywordQuery: {
      text: query,
      scope: filters.scope,
      kinds: filters.kinds,
      appBundleIds: filters.appBundleIds,
      dateRange: filters.dateRange,
      limit: KEYWORD_POOL,
    },
    keywordLimit: KEYWORD_POOL,
    recent: {
      kinds: filters.kinds,
      appBundleIds: filters.appBundleIds,
      from: filters.dateRange?.from,
      to: filters.dateRange?.to,
      limit: RECENT_POOL,
      ...recent,
    },
    maxTotal: MAX_POOL,
  })

  let inputTokens = 0
  try {
    // 1. intent (optional, failures other than a bad key / cancel are ignored) in parallel with the local pool
    const intentPromise: Promise<IntentOutcome | undefined> = (async () => {
      const apps = await port.listApps()
      return runIntentRequest({ ...options, timeoutMs: INTENT_TIMEOUT_MS }, query, apps, input.now)
    })().catch((error: unknown) => {
      if (error instanceof JevError && (error.code === 'invalid_key' || error.code === 'aborted')) throw error
      return undefined
    })
    const poolPromise = port.getAiCandidates(candidateQuery())
    // Avoid an unhandled rejection if the pool fails first and Promise.all bails out.
    intentPromise.catch(() => undefined)
    const [intentOutcome, firstPool] = await Promise.all([intentPromise, poolPromise])
    inputTokens += intentOutcome?.inputTokens ?? 0
    const intent = intentOutcome?.intent

    // 2. narrow the candidate pool by the intent (keyword hits are always kept by the store)
    let pool = firstPool
    if (intentOutcome && intent && hasIntentFilters(intent)) {
      const dateRange = intersectDateRanges(filters.dateRange, intentOutcome.dateRange)
      const safeRange = isEmptyRange(dateRange) ? filters.dateRange : dateRange
      try {
        const narrowed = await port.getAiCandidates(
          candidateQuery({
            kinds: narrowList(filters.kinds, intent.kind),
            appBundleIds: narrowList(filters.appBundleIds, intent.appBundleId),
            from: safeRange?.from,
            to: safeRange?.to,
          })
        )
        if (narrowed.length) pool = narrowed
      } catch {
        // keep the un-narrowed pool
      }
    }
    pool = dedupe(pool)
    if (pool.length === 0) return { ...emptyResult('no_match', startedAt), intent, inputTokens }

    // 3. rerank
    const rerank = await rerankCandidates(options, query, pool, input.now)
    inputTokens += rerank.inputTokens
    if (rerank.existsProbability < NO_MATCH_PROBABILITY) {
      return { ...emptyResult('no_match', startedAt), intent, inputTokens }
    }

    const rankedAll = rerank.ranked
    let selected = intent?.wantsAll
      ? rankedAll.filter((item) => item.probability >= WANTS_ALL_MIN_PROBABILITY)
      : rankedAll.slice(0, DEFAULT_RESULT_COUNT)
    if (selected.length < DEFAULT_RESULT_COUNT) selected = rankedAll.slice(0, DEFAULT_RESULT_COUNT)

    const fetched = await port.getItemsByIds(selected.map((item) => item.id))
    const byId = new Map<string, ClipListItem>(fetched.map((item) => [item.id, item]))
    const items: ClipListItem[] = []
    const scores: number[] = []
    for (const item of selected) {
      const listItem = byId.get(item.id)
      if (!listItem) continue
      items.push(listItem)
      scores.push(item.probability)
    }
    if (items.length === 0) return { ...emptyResult('no_match', startedAt), intent, inputTokens }
    return { status: 'ok', items, scores, intent, inputTokens, tookMs: Date.now() - startedAt }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const result = emptyResult(
      error instanceof JevError && error.code === 'timeout' ? 'timeout' : 'error',
      startedAt,
      message
    )
    return inputTokens ? { ...result, inputTokens } : result
  } finally {
    input.signal?.removeEventListener('abort', onCallerAbort)
    controller.abort()
  }
}

export const testJevConnection: ClipAiTestFn = async (settings) => {
  if (!settings.apiKey?.trim()) return { ok: false, errorMessage: 'Jev API key is empty' }
  try {
    const response = await jevRequest(jevOptionsFromSettings(settings, { timeoutMs: TEST_TIMEOUT_MS }), 'hello', {
      greeting: noul('Is this text a greeting?'),
    })
    return { ok: true, model: response.model }
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) }
  }
}
