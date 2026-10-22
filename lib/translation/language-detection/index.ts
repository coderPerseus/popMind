// Source language detection for "auto" translations.
// `program` mode: the engine's own detector, then local character rules.
// `jev` mode: a decision model (Clef / Jev) picks the language; any failure falls back to `program` mode.
import { choice } from '@/lib/clipboard/search/ai/jev-client'
import type { CapabilitySettings, LanguageDetectionTestResult } from '@/lib/capability/types'
import { guessSourceLanguage } from '@/lib/translation/shared'
import type { TranslationProvider } from '@/lib/translation/types'
import { askChoice } from './decision-model'

const QUESTION_ID = 'language'
const MAX_STATE_CHARS = 600
/** Below this the model is guessing; local rules are more reliable. */
const MIN_CONFIDENCE = 0.4
const CACHE_LIMIT = 100
const TRANSLATE_TIMEOUTS = { apiMs: 3000, cliMs: 8000 }
const TEST_TIMEOUTS = { apiMs: 10_000, cliMs: 30_000 }
const OTHER = 'other'
/** The engine detector is a nice-to-have; a blocked engine must not stall the translation. */
const ENGINE_DETECT_TIMEOUT_MS = 3000

const languageCriteria: Record<string, string> = {
  en: 'English',
  'zh-CN': 'Chinese written in simplified characters',
  'zh-TW': 'Chinese written in traditional characters',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ru: 'Russian',
  it: 'Italian',
  pt: 'Portuguese',
  [OTHER]: 'Any other language, or no natural-language text (only code, numbers or symbols)',
}

const languageQuestion = choice(
  'Which language is the text in `state` mainly written in? Ignore code, URLs and names.',
  languageCriteria
)

export type DetectSource = 'explicit' | 'remote' | 'local' | 'jev' | 'none'

const cache = new Map<string, string>()

const remember = (key: string, language: string) => {
  cache.delete(key)
  cache.set(key, language)
  if (cache.size > CACHE_LIMIT) {
    cache.delete(cache.keys().next().value as string)
  }
}

const cacheKey = (settings: CapabilitySettings, text: string) => {
  const detection = settings.languageDetection
  const model = detection.provider === 'clef' ? detection.clef.model : detection.typesafe.model
  return `${detection.provider}:${model}:${text}`
}

const detectWithProgram = async (
  text: string,
  settings: CapabilitySettings,
  provider: TranslationProvider
): Promise<{ language: string; source: DetectSource }> => {
  if (provider.detectLanguage) {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${ENGINE_DETECT_TIMEOUT_MS} ms`)),
          ENGINE_DETECT_TIMEOUT_MS
        )
      })
      try {
        const language = await Promise.race([provider.detectLanguage(text, settings), timeout])
        return { language, source: 'remote' }
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      console.warn('[LanguageDetection] engine detector failed, using local rules', {
        engineId: provider.id,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { language: guessSourceLanguage(text), source: 'local' }
}

export const detectSourceLanguage = async (
  text: string,
  settings: CapabilitySettings,
  provider: TranslationProvider
): Promise<{ language: string; source: DetectSource }> => {
  if (settings.languageDetection.mode !== 'jev') {
    return detectWithProgram(text, settings, provider)
  }

  const state = text.slice(0, MAX_STATE_CHARS)
  const key = cacheKey(settings, state)
  const cached = cache.get(key)
  if (cached) {
    return { language: cached, source: 'jev' }
  }

  const startedAt = Date.now()
  try {
    const answer = await askChoice(settings, state, QUESTION_ID, languageQuestion, TRANSLATE_TIMEOUTS)
    console.warn('[LanguageDetection] jev answered', {
      provider: settings.languageDetection.provider,
      via: answer.via,
      choice: answer.choice,
      confidence: Number(answer.confidence.toFixed(3)),
      elapsedMs: Date.now() - startedAt,
    })
    if (answer.choice !== OTHER && answer.choice in languageCriteria && answer.confidence >= MIN_CONFIDENCE) {
      remember(key, answer.choice)
      return { language: answer.choice, source: 'jev' }
    }
  } catch (error) {
    console.warn('[LanguageDetection] jev failed, falling back to program detection', {
      provider: settings.languageDetection.provider,
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  return detectWithProgram(text, settings, provider)
}

const TEST_SAMPLE = 'Bonjour, est-ce que tu peux m’aider à traduire ce paragraphe ?'

/** Settings page check: runs one real detection with the given (possibly unsaved) settings. */
export const testLanguageDetection = async (settings: CapabilitySettings): Promise<LanguageDetectionTestResult> => {
  const startedAt = Date.now()
  try {
    const answer = await askChoice(settings, TEST_SAMPLE, QUESTION_ID, languageQuestion, TEST_TIMEOUTS)
    return {
      ok: answer.choice === 'fr',
      via: answer.via,
      language: answer.choice,
      confidence: answer.confidence,
      elapsedMs: Date.now() - startedAt,
      errorMessage: answer.choice === 'fr' ? undefined : `Expected French, got "${answer.choice}"`,
    }
  } catch (error) {
    return {
      ok: false,
      via: null,
      language: null,
      confidence: null,
      elapsedMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    }
  }
}
