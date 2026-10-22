// One entry point for the Jev-style decision models used by language detection:
// Cloudflare Clef (via the `cf` CLI or a Cloudflare API token) and TypeSafe's official Jev.
// Both speak the same request shape: { model, state, questions } -> { answers }.
import { JEV_DEFAULT_MODEL, jevRequest, type JevChoiceQuestion } from '@/lib/clipboard/search/ai/jev-client'
import type { CapabilitySettings, LanguageDetectionTestResult } from '@/lib/capability/types'
import { runWorkersAiWithCfCli } from './cf-cli'

export type DecisionVia = NonNullable<LanguageDetectionTestResult['via']>

export type DecisionChoice = {
  choice: string
  confidence: number
  via: DecisionVia
}

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Finds `answers` in the raw model output or inside an envelope such as Cloudflare's `{ result: ... }`. */
const findAnswers = (value: unknown, depth = 0): Record<string, unknown> | null => {
  if (!isRecord(value) || depth > 3) return null
  if (isRecord(value.answers)) return value.answers
  for (const nested of Object.values(value)) {
    const found = findAnswers(nested, depth + 1)
    if (found) return found
  }
  return null
}

const readChoiceAnswer = (payload: unknown, questionId: string) => {
  const answer = findAnswers(payload)?.[questionId]
  if (!isRecord(answer) || typeof answer.choice !== 'string') {
    throw new Error(`Clef returned an unexpected response: ${JSON.stringify(payload).slice(0, 160)}`)
  }
  const probabilities = isRecord(answer.probabilities) ? answer.probabilities : {}
  const probability = probabilities[answer.choice]
  const confidence =
    typeof answer.confidence === 'number' ? answer.confidence : typeof probability === 'number' ? probability : 0
  return { choice: answer.choice, confidence }
}

const runClefWithToken = async (
  model: string,
  body: unknown,
  credentials: { apiToken: string; accountId: string },
  timeoutMs: number
) => {
  const url = `${CLOUDFLARE_API}/accounts/${credentials.accountId}/ai/run/@cf/cloudflare/${model}`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credentials.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Clef did not answer within ${timeoutMs} ms`)
    }
    throw new Error(`Cannot reach Cloudflare: ${error instanceof Error ? error.message : String(error)}`)
  }

  const payload = (await response.json().catch(() => null)) as {
    errors?: Array<{ message?: string }>
  } | null
  if (!response.ok) {
    const detail = payload?.errors?.[0]?.message
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Cloudflare rejected the token (${response.status})${detail ? `: ${detail}` : ''}`)
    }
    throw new Error(`Clef request failed (${response.status})${detail ? `: ${detail}` : ''}`)
  }
  return payload
}

/** Asks one Choice question and returns the picked option. Throws with a readable message on any failure. */
export const askChoice = async (
  settings: CapabilitySettings,
  state: string,
  questionId: string,
  question: JevChoiceQuestion,
  timeouts: { apiMs: number; cliMs: number }
): Promise<DecisionChoice> => {
  const detection = settings.languageDetection
  const questions = { [questionId]: question }

  if (detection.provider === 'typesafe') {
    const apiKey = detection.typesafe.apiKey.trim() || settings.clipboard.ai.apiKey.trim()
    if (!apiKey) throw new Error('TypeSafe Jev API key is missing')
    const response = await jevRequest(
      { apiKey, model: detection.typesafe.model.trim() || JEV_DEFAULT_MODEL, timeoutMs: timeouts.apiMs },
      state,
      questions
    )
    const answer = response.answers[questionId]
    return { choice: answer.choice, confidence: answer.confidence, via: 'typesafe' }
  }

  const model = detection.clef.model
  const body = { model, state, questions }
  const apiToken = detection.clef.apiToken.trim()
  const accountId = detection.clef.accountId.trim()

  if (apiToken) {
    if (!accountId) throw new Error('Cloudflare account ID is required when using an API token')
    const payload = await runClefWithToken(model, body, { apiToken, accountId }, timeouts.apiMs)
    return { ...readChoiceAnswer(payload, questionId), via: 'cf-token' }
  }

  const payload = await runWorkersAiWithCfCli(`@cf/cloudflare/${model}`, body, {
    accountId,
    timeoutMs: timeouts.cliMs,
  })
  return { ...readChoiceAnswer(payload, questionId), via: 'cf-cli' }
}
