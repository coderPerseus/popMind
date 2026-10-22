import { translationProviders } from '@/lib/translation/providers'
import {
  defaultTranslationSettings,
  getEnabledTranslationEngineIds,
  getLanguageFamily,
  isSameLanguage,
  resolvePreferredTranslationEngine,
  resolveTranslationQueryMode,
} from '@/lib/translation/shared'
import { capabilityService } from '@/lib/capability/service'
import { detectSourceLanguage, type DetectSource } from '@/lib/translation/language-detection'
import { normalizeTextForTranslation } from '@/lib/translation/text-normalizer'
import type {
  TranslateInput,
  TranslationEngineId,
  TranslationQueryMode,
  TranslationRequest,
  TranslationResult,
} from '@/lib/translation/types'

const resolveEngineId = (
  settings: Awaited<ReturnType<typeof capabilityService.getSettings>>,
  preferred?: TranslationEngineId
) => {
  return resolvePreferredTranslationEngine(settings, preferred)
}

const resolveExplicitTargetLanguage = ({ targetLanguage }: { targetLanguage?: string }) => {
  if (targetLanguage && targetLanguage !== 'auto') {
    return targetLanguage
  }

  return null
}

const resolveAutoTargetLanguage = ({
  detectedSourceLanguage,
  settings,
}: {
  detectedSourceLanguage?: string
  settings: Awaited<ReturnType<typeof capabilityService.getSettings>>
}) => {
  if (detectedSourceLanguage && isSameLanguage(detectedSourceLanguage, settings.firstLanguage)) {
    return settings.secondLanguage
  }

  return settings.firstLanguage
}

const resolveWordTargetLanguage = ({
  queryMode,
  targetLanguage,
  settings,
}: {
  queryMode: TranslationQueryMode
  targetLanguage: string
  settings: Awaited<ReturnType<typeof capabilityService.getSettings>>
}) => {
  if (queryMode !== 'word') {
    return targetLanguage
  }

  if (getLanguageFamily(targetLanguage) === 'zh') {
    return targetLanguage
  }

  if (getLanguageFamily(settings.secondLanguage) === 'zh') {
    return settings.secondLanguage
  }

  return targetLanguage
}

/** Free web engines that need no setup; used as a last resort even when the user has not enabled them. */
const BUILT_IN_FALLBACK_ENGINES: TranslationEngineId[] = ['bing', 'google', 'deepl']
/** Per attempt. Web engines answer in about a second; LLM engines need much longer for long text. */
const WEB_ENGINE_TIMEOUT_MS = 8000
const LLM_ENGINE_TIMEOUT_MS = 45_000

type Settings = Awaited<ReturnType<typeof capabilityService.getSettings>>

const getEngineTimeoutMs = (engineId: TranslationEngineId) =>
  engineId === 'ai' || engineId === 'gemma' ? LLM_ENGINE_TIMEOUT_MS : WEB_ENGINE_TIMEOUT_MS

/** The engine the user picked first, then the other enabled engines, then the built-in free ones. */
const resolveTextEngineChain = (settings: Settings, primary: TranslationEngineId) => {
  const chain = [primary, ...getEnabledTranslationEngineIds(settings), ...BUILT_IN_FALLBACK_ENGINES]
  return [...new Set(chain)].filter((engineId) => translationProviders[engineId]?.isConfigured(settings))
}

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, engineId: TranslationEngineId) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Translation engine "${engineId}" timed out after ${timeoutMs} ms`)),
      timeoutMs
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

const errorMessageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const translateWithEngine = async (request: TranslationRequest, settings: Settings) => {
  const engineId = request.engineId as TranslationEngineId
  // Debug hook: POPMIND_DEBUG_FAIL_ENGINES=google,bing makes those engines fail to exercise the fallback chain.
  if (process.env.POPMIND_DEBUG_FAIL_ENGINES?.split(',').includes(engineId)) {
    throw new Error(`Translation engine "${engineId}" disabled by POPMIND_DEBUG_FAIL_ENGINES`)
  }
  const result = await withTimeout(
    translationProviders[engineId].translate(request, settings),
    getEngineTimeoutMs(engineId),
    engineId
  )
  if (!result.translatedText.trim() && !result.wordEntry) {
    throw new Error(`Translation engine "${engineId}" returned an empty result`)
  }
  return result
}

/**
 * Tries each engine in turn until one succeeds. Throws the first engine's error when all of them fail,
 * since that is the one the user picked.
 */
const translateWithFallback = async (
  request: TranslationRequest,
  settings: Settings,
  engineIds: TranslationEngineId[]
) => {
  const failures: Array<{ engineId: TranslationEngineId; message: string }> = []
  let firstError: unknown

  for (const engineId of engineIds) {
    const attemptRequest: TranslationRequest = {
      ...request,
      engineId,
      queryMode: engineId === 'youdao' ? request.queryMode : 'text',
    }
    const startedAt = Date.now()
    try {
      const result = await translateWithEngine(attemptRequest, settings)
      if (failures.length) {
        console.warn('[TranslationService] fallback engine succeeded', {
          engineId,
          failedEngines: failures,
          elapsedMs: Date.now() - startedAt,
        })
      }
      return result
    } catch (error) {
      firstError ??= error
      failures.push({ engineId, message: errorMessageOf(error) })
      console.warn('[TranslationService] engine failed, trying next', {
        engineId,
        message: errorMessageOf(error),
        elapsedMs: Date.now() - startedAt,
        remaining: engineIds.slice(engineIds.indexOf(engineId) + 1),
      })
    }
  }

  throw firstError ?? new Error('No translation engine is available')
}

const isWordProviderAvailable = (settings: Awaited<ReturnType<typeof capabilityService.getSettings>>) => {
  return translationProviders.youdao.isConfigured(settings)
}

export class TranslationService {
  async getSettings() {
    return capabilityService.getSettings()
  }

  async updateSettings(patch: Parameters<typeof capabilityService.updateSettings>[0]) {
    return capabilityService.updateSettings(patch)
  }

  async translate(input: TranslateInput): Promise<TranslationResult> {
    const settings = await this.getSettings()
    const rawText = input.text.trim()
    const text = normalizeTextForTranslation(rawText)
    if (!text) {
      throw new Error('Translation text is empty')
    }

    const requestedSourceLanguage = input.sourceLanguage ?? defaultTranslationSettings.defaultSourceLanguage
    const requestedQueryMode = resolveTranslationQueryMode({
      ...input,
      text,
    })
    const preferredEngineId = resolveEngineId(settings, input.engineId)
    const shouldUseWordProvider = requestedQueryMode === 'word' && isWordProviderAvailable(settings)
    const queryMode: TranslationQueryMode = shouldUseWordProvider ? 'word' : 'text'
    const engineId = shouldUseWordProvider ? 'youdao' : preferredEngineId
    if (!engineId) {
      throw new Error('No translation engine is enabled')
    }

    const provider = translationProviders[engineId]

    if (!provider || !provider.isConfigured(settings)) {
      throw new Error(`Translation engine "${engineId}" is not available`)
    }

    const explicitTargetLanguage = resolveExplicitTargetLanguage({
      targetLanguage: input.targetLanguage,
    })

    let detectedSourceLanguage = requestedSourceLanguage !== 'auto' ? requestedSourceLanguage : undefined
    let detectSource: DetectSource = requestedSourceLanguage !== 'auto' ? 'explicit' : 'none'

    if (!explicitTargetLanguage && requestedSourceLanguage === 'auto') {
      const detection = await detectSourceLanguage(text, settings, provider)
      detectedSourceLanguage = detection.language
      detectSource = detection.source
    }

    const resolvedTargetLanguage =
      explicitTargetLanguage ??
      resolveAutoTargetLanguage({
        detectedSourceLanguage,
        settings,
      })

    const targetLanguage = resolveWordTargetLanguage({
      queryMode,
      targetLanguage: resolvedTargetLanguage,
      settings,
    })

    const request: TranslationRequest = {
      text,
      sourceLanguage: requestedSourceLanguage,
      targetLanguage,
      queryMode,
      engineId,
      selectionId: input.selectionId,
      sourceAppId: input.sourceAppId,
    }

    // Word lookups use the dictionary first, then fall back to plain text translation with the preferred engine.
    const textPrimaryEngineId = shouldUseWordProvider ? preferredEngineId : engineId
    const engineChain = [
      ...(shouldUseWordProvider ? (['youdao'] as TranslationEngineId[]) : []),
      ...(textPrimaryEngineId ? resolveTextEngineChain(settings, textPrimaryEngineId) : []),
    ]

    const startedAt = Date.now()
    const result = await translateWithFallback(request, settings, [...new Set(engineChain)])
    // In Jev mode the user chose the decision model as the authority on the source language.
    const finalDetectedSourceLanguage =
      detectSource === 'jev' ? detectedSourceLanguage : result.detectedSourceLanguage || detectedSourceLanguage

    console.warn('[TranslationService] translate finished', {
      engineId: result.engineId,
      requestedEngineId: engineId,
      detectSource,
      detectedSourceLanguage: finalDetectedSourceLanguage,
      targetLanguage,
      elapsedMs: Date.now() - startedAt,
      sourceLength: text.length,
    })

    return {
      ...result,
      sourceLanguage: requestedSourceLanguage,
      targetLanguage,
      detectedSourceLanguage: finalDetectedSourceLanguage,
    }
  }
}

export const translationService = new TranslationService()
