import { translationProviders } from '@/lib/translation/providers'
import { defaultTranslationSettings, translationEngineOrder } from '@/lib/translation/shared'
import { translationStore } from '@/lib/translation/store'
import type { TranslateInput, TranslationEngineId, TranslationRequest, TranslationResult } from '@/lib/translation/types'

const resolveEngineId = (settings: Awaited<ReturnType<typeof translationStore.getSettings>>, preferred?: TranslationEngineId) => {
  if (preferred && settings.enabledEngines[preferred]) {
    return preferred
  }

  return translationEngineOrder.find((engineId) => settings.enabledEngines[engineId])
}

const resolveTargetLanguage = ({
  targetLanguage,
  firstLanguage,
}: {
  targetLanguage?: string
  firstLanguage: string
}) => {
  if (targetLanguage && targetLanguage !== 'auto') {
    return targetLanguage
  }

  return firstLanguage
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
    const engineId = resolveEngineId(settings, input.engineId)
    if (!engineId) {
      throw new Error('No translation engine is enabled')
    }

    const provider = translationProviders[engineId]

    if (!provider || !provider.isConfigured(settings)) {
      throw new Error(`Translation engine "${engineId}" is not available`)
    }

    const text = input.text.trim()
    if (!text) {
      throw new Error('Translation text is empty')
    }

    const requestedSourceLanguage = input.sourceLanguage ?? defaultTranslationSettings.defaultSourceLanguage

    const targetLanguage = resolveTargetLanguage({
      targetLanguage: input.targetLanguage,
      firstLanguage: settings.firstLanguage,
    })

    const request: TranslationRequest = {
      text,
      sourceLanguage: requestedSourceLanguage,
      targetLanguage,
      engineId,
      selectionId: input.selectionId,
      sourceAppId: input.sourceAppId,
    }

    const result = await provider.translate(request, settings)

    return {
      ...result,
      sourceLanguage: requestedSourceLanguage,
      targetLanguage,
      detectedSourceLanguage: result.detectedSourceLanguage,
    }
  }
}

export const translationService = new TranslationService()
