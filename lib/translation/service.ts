import { translationProviders } from '@/lib/translation/providers'
import { defaultTranslationSettings, getLanguageFamily, isSameLanguage, translationEngineOrder } from '@/lib/translation/shared'
import { translationStore } from '@/lib/translation/store'
import type { TranslateInput, TranslationEngineId, TranslationQueryMode, TranslationRequest, TranslationResult } from '@/lib/translation/types'

const resolveEngineId = (settings: Awaited<ReturnType<typeof translationStore.getSettings>>, preferred?: TranslationEngineId) => {
  if (preferred && settings.enabledEngines[preferred]) {
    return preferred
  }

  return translationEngineOrder.find((engineId) => settings.enabledEngines[engineId])
}

const resolveExplicitTargetLanguage = ({
  targetLanguage,
}: {
  targetLanguage?: string
}) => {
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
  settings: Awaited<ReturnType<typeof translationStore.getSettings>>
}) => {
  if (detectedSourceLanguage && isSameLanguage(detectedSourceLanguage, settings.firstLanguage)) {
    return settings.secondLanguage
  }

  return settings.firstLanguage
}

const isEnglishWord = (text: string) => {
  return /^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(text) && text.length <= 48
}

const resolveQueryMode = (input: TranslateInput, text: string) => {
  if (input.queryMode) {
    return input.queryMode
  }

  const sourceLanguage = input.sourceLanguage ?? defaultTranslationSettings.defaultSourceLanguage
  const sourceFamily = getLanguageFamily(sourceLanguage)
  if (sourceLanguage !== 'auto' && sourceFamily !== 'en') {
    return 'text'
  }

  return isEnglishWord(text) ? 'word' : 'text'
}

const resolveWordTargetLanguage = ({
  queryMode,
  targetLanguage,
  settings,
}: {
  queryMode: TranslationQueryMode
  targetLanguage: string
  settings: Awaited<ReturnType<typeof translationStore.getSettings>>
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

export class TranslationService {
  async getSettings() {
    return translationStore.getSettings()
  }

  async updateSettings(patch: Parameters<typeof translationStore.updateSettings>[0]) {
    return translationStore.updateSettings(patch)
  }

  async translate(input: TranslateInput): Promise<TranslationResult> {
    const settings = await this.getSettings()
    const text = input.text.trim()
    if (!text) {
      throw new Error('Translation text is empty')
    }

    const requestedSourceLanguage = input.sourceLanguage ?? defaultTranslationSettings.defaultSourceLanguage
    const requestedQueryMode = resolveQueryMode(input, text)

    const prefersWordProvider =
      requestedQueryMode === 'word' &&
      settings.enabledEngines.youdao &&
      translationProviders.youdao.isConfigured(settings)

    const queryMode: TranslationQueryMode = prefersWordProvider ? 'word' : 'text'
    const engineId = prefersWordProvider ? 'youdao' : resolveEngineId(settings, input.engineId)
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

    let detectedSourceLanguage =
      requestedSourceLanguage !== 'auto' ? requestedSourceLanguage : undefined

    if (!explicitTargetLanguage && requestedSourceLanguage === 'auto' && provider.detectLanguage) {
      try {
        detectedSourceLanguage = await provider.detectLanguage(text, settings)
      } catch (error) {
        console.warn('[TranslationService] detectLanguage failed, fallback to firstLanguage target', error)
      }
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

    const result = await provider.translate(request, settings)

    return {
      ...result,
      queryMode,
      sourceLanguage: requestedSourceLanguage,
      targetLanguage,
      detectedSourceLanguage: result.detectedSourceLanguage || detectedSourceLanguage,
    }
  }
}

export const translationService = new TranslationService()
