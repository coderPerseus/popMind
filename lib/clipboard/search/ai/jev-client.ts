// Minimal client for TypeSafe's Jev model (POST https://api.typesafe.ai/v1/systemone). Plain `fetch`, no SDK.
// Request : { model, state, questions: { [id]: { type: 'choice' | 'noul', instructions, criteria } } }
// Response: { model, answers: { [id]: choice | noul answer }, usage: { input_tokens, output_tokens } }
// Docs    : https://docs.typesafe.ai/api.md
import type { ClipboardSettings } from '@/lib/clipboard/types'

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
export const JEV_DEFAULT_MODEL = 'jev-latest'
/** Budget for one request including retries (spec §7.4: give up on AI after 3 s). */
export const JEV_DEFAULT_TIMEOUT_MS = 3000
export const JEV_MAX_RETRIES = 2
const BACKOFF_BASE_MS = 250
/** Not worth retrying when less than this is left of the budget. */
const MIN_ATTEMPT_MS = 300

export type JevErrorCode =
  | 'invalid_key'
  | 'invalid_request'
  | 'rate_limited'
  | 'overloaded'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'http'
  | 'bad_response'

export class JevError extends Error {
  readonly code: JevErrorCode
  readonly status?: number

  constructor(code: JevErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'JevError'
    this.code = code
    this.status = status
  }
}

export type JevChoiceQuestion = {
  type: 'choice'
  instructions: string
  /** Option key -> description. `null` means "the state already explains this option". Max 255 options. */
  criteria: Record<string, string | null>
}

export type JevNoulQuestion = {
  type: 'noul'
  instructions: string
  criteria?: { true: string; false: string }
}

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion

export type JevChoiceAnswer = {
  type: 'choice'
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

export type JevNoulAnswer = { type: 'noul'; noul: number }

export type JevAnswers<Q extends Record<string, JevQuestion>> = {
  [K in keyof Q]: Q[K] extends JevChoiceQuestion ? JevChoiceAnswer : JevNoulAnswer
}

export type JevRequestOptions = {
  apiKey: string
  model?: string
  /** Total budget for the request including retries. */
  timeoutMs?: number
  /** Caller cancellation. */
  signal?: AbortSignal
  maxRetries?: number
}

export type JevResponse<Q extends Record<string, JevQuestion>> = {
  model: string
  answers: JevAnswers<Q>
  inputTokens: number
  outputTokens: number
}

export const choice = (instructions: string, criteria: Record<string, string | null>): JevChoiceQuestion => ({
  type: 'choice',
  instructions,
  criteria,
})

export const noul = (instructions: string, criteria?: { true: string; false: string }): JevNoulQuestion =>
  criteria ? { type: 'noul', instructions, criteria } : { type: 'noul', instructions }

export const jevOptionsFromSettings = (
  settings: Pick<ClipboardSettings['ai'], 'apiKey' | 'model'>,
  extra: Omit<JevRequestOptions, 'apiKey' | 'model'> = {}
): JevRequestOptions => ({
  apiKey: settings.apiKey,
  model: settings.model?.trim() || JEV_DEFAULT_MODEL,
  ...extra,
})

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

const combineSignals = (signals: AbortSignal[]): AbortSignal =>
  signals.length === 1 ? signals[0] : AbortSignal.any(signals)

const retryAfterMs = (response: Response): number | undefined => {
  const header = response.headers.get('retry-after')
  if (!header) return undefined
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined
}

const errorDetail = async (response: Response): Promise<string> => {
  try {
    const text = (await response.text()).trim()
    if (!text) return ''
    try {
      const body = JSON.parse(text) as { error?: { message?: string } | string; detail?: unknown; message?: string }
      const message =
        (typeof body.error === 'string' ? body.error : body.error?.message) ??
        body.message ??
        (typeof body.detail === 'string' ? body.detail : undefined)
      if (message) return message.slice(0, 200)
    } catch {
      // not JSON
    }
    return text.slice(0, 200)
  } catch {
    return ''
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseResponse = <Q extends Record<string, JevQuestion>>(
  body: unknown,
  questions: Q,
  requestedModel: string
): JevResponse<Q> => {
  if (!isRecord(body) || !isRecord(body.answers)) throw new JevError('bad_response', 'Unexpected Jev response format')
  const answers: Record<string, JevChoiceAnswer | JevNoulAnswer> = {}
  for (const [key, question] of Object.entries(questions)) {
    const raw = body.answers[key]
    if (!isRecord(raw) || raw.type !== question.type) {
      throw new JevError('bad_response', `Jev response is missing the answer for "${key}"`)
    }
    if (question.type === 'choice') {
      if (typeof raw.choice !== 'string' || !isRecord(raw.probabilities)) {
        throw new JevError('bad_response', `Jev choice answer "${key}" is malformed`)
      }
      const probabilities: Record<string, number> = {}
      for (const [option, value] of Object.entries(raw.probabilities)) {
        if (typeof value === 'number' && Number.isFinite(value)) probabilities[option] = value
      }
      answers[key] = {
        type: 'choice',
        choice: raw.choice,
        confidence: typeof raw.confidence === 'number' ? raw.confidence : (probabilities[raw.choice] ?? 0),
        probabilities,
      }
    } else {
      if (typeof raw.noul !== 'number') throw new JevError('bad_response', `Jev noul answer "${key}" is malformed`)
      answers[key] = { type: 'noul', noul: raw.noul }
    }
  }
  const usage = isRecord(body.usage) ? body.usage : {}
  return {
    model: typeof body.model === 'string' ? body.model : requestedModel,
    answers: answers as JevAnswers<Q>,
    inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
    outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
  }
}

/**
 * Sends one request. Retries 429 / 529 with exponential backoff (max 2 retries) as long as the time budget allows.
 * Throws `JevError` with a clear message (401 -> invalid key, budget exhausted -> timeout, caller signal -> aborted).
 */
export const jevRequest = async <Q extends Record<string, JevQuestion>>(
  options: JevRequestOptions,
  state: unknown,
  questions: Q
): Promise<JevResponse<Q>> => {
  const apiKey = options.apiKey?.trim()
  if (!apiKey) throw new JevError('invalid_key', 'Jev API key is missing')
  const model = options.model?.trim() || JEV_DEFAULT_MODEL
  const timeoutMs = options.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS
  const maxRetries = options.maxRetries ?? JEV_MAX_RETRIES
  const startedAt = Date.now()

  // Not AbortSignal.timeout(): its timer is unref'd and would not keep a bare Node process (tests) alive.
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), timeoutMs)
  const signal = combineSignals(options.signal ? [deadline.signal, options.signal] : [deadline.signal])
  const interrupted = (): JevError =>
    options.signal?.aborted
      ? new JevError('aborted', 'Jev request was cancelled')
      : new JevError('timeout', `Jev request timed out after ${timeoutMs} ms`)

  const body = JSON.stringify({ model, state, questions })

  try {
    return await sendWithRetries()
  } finally {
    clearTimeout(timer)
  }

  async function sendWithRetries(): Promise<JevResponse<Q>> {
    for (let attempt = 0; ; attempt++) {
      let response: Response
      try {
        response = await fetch(JEV_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal,
        })
      } catch (error) {
        if (signal.aborted) throw interrupted()
        throw new JevError('network', `Cannot reach Jev: ${error instanceof Error ? error.message : String(error)}`)
      }

      if (response.ok) {
        try {
          return parseResponse(await response.json(), questions, model)
        } catch (error) {
          if (error instanceof JevError) throw error
          if (signal.aborted) throw interrupted()
          throw new JevError('bad_response', 'Jev returned a response that is not valid JSON')
        }
      }

      const status = response.status
      if ((status === 429 || status === 529) && attempt < maxRetries) {
        const delay = retryAfterMs(response) ?? BACKOFF_BASE_MS * 2 ** attempt + Math.floor(Math.random() * 100)
        const remaining = timeoutMs - (Date.now() - startedAt)
        if (delay + MIN_ATTEMPT_MS < remaining) {
          await response.body?.cancel().catch(() => undefined)
          try {
            await sleep(delay, signal)
          } catch {
            throw interrupted()
          }
          continue
        }
      }

      const detail = await errorDetail(response)
      const suffix = detail ? `: ${detail}` : ''
      if (status === 401 || status === 403) throw new JevError('invalid_key', `Invalid Jev API key (${status})`, status)
      if (status === 422) throw new JevError('invalid_request', `Jev rejected the request (422)${suffix}`, status)
      if (status === 429) throw new JevError('rate_limited', 'Jev rate limit exceeded (429), try again later', status)
      if (status === 529) throw new JevError('overloaded', 'Jev is overloaded (529), try again later', status)
      throw new JevError('http', `Jev request failed (${status})${suffix}`, status)
    }
  }
}
