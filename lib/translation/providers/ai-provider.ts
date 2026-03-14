import { createLanguageModel, resolveAiProviderConfig } from '@/lib/ai-service/provider-factory'
import { trimTranslationText } from '@/lib/translation/shared'
import type { TranslationProvider, TranslationRequest, TranslationResult, TranslationSettings } from '@/lib/translation/types'
import { translateWithAi } from './ai/translate-with-ai'

const getActiveModel = (settings: TranslationSettings) => {
  const resolved = createLanguageModel(settings)

  if (!resolved) {
    throw new Error('AI translation is not configured')
  }

  return resolved
}

export const aiProvider: TranslationProvider = {
  id: 'ai',
  isConfigured(settings) {
    return Boolean(resolveAiProviderConfig(settings))
  },
  async detectLanguage(text, settings) {
    const resolved = getActiveModel(settings)
    const result = await translateWithAi({
      model: resolved.model,
      text,
      sourceLanguage: 'auto',
      targetLanguage: 'en',
    })

    return result.detectedSourceLanguage || 'auto'
  },
  async translate(request: TranslationRequest, settings: TranslationSettings): Promise<TranslationResult> {
    const resolved = getActiveModel(settings)
    const result = await translateWithAi({
      model: resolved.model,
      text: request.text,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
    })

    if (!result.translatedText) {
      throw new Error('AI translate returned an empty result')
    }

    return {
      engineId: 'ai',
      queryMode: 'text',
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      sourceText: trimTranslationText(request.text),
      translatedText: result.translatedText,
      detectedSourceLanguage: result.detectedSourceLanguage || request.sourceLanguage,
    }
  },
}
