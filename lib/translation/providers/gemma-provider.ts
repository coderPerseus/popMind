import { createLanguageModel, resolveAiProviderConfig } from '@/lib/ai-service/provider-factory'
import { trimTranslationText } from '@/lib/translation/shared'
import type { TranslationProvider, TranslationRequest, TranslationResult, TranslationSettings } from '@/lib/translation/types'
import { translateWithAi } from './ai/translate-with-ai'

const getGemmaModel = (settings: TranslationSettings) => {
  const resolved = createLanguageModel(settings, 'gemma')

  if (!resolved) {
    throw new Error('Gemma translation is not configured')
  }

  return resolved
}

export const gemmaProvider: TranslationProvider = {
  id: 'gemma',
  isConfigured(settings) {
    return Boolean(resolveAiProviderConfig(settings, 'gemma'))
  },
  async detectLanguage(text, settings) {
    const resolved = getGemmaModel(settings)
    const result = await translateWithAi({
      model: resolved.model,
      text,
      sourceLanguage: 'auto',
      targetLanguage: 'en',
    })

    return result.detectedSourceLanguage || 'auto'
  },
  async translate(request: TranslationRequest, settings: TranslationSettings): Promise<TranslationResult> {
    const resolved = getGemmaModel(settings)
    const result = await translateWithAi({
      model: resolved.model,
      text: request.text,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
    })

    if (!result.translatedText) {
      throw new Error('Gemma translate returned an empty result')
    }

    return {
      engineId: 'gemma',
      queryMode: 'text',
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      sourceText: trimTranslationText(request.text),
      translatedText: result.translatedText,
      detectedSourceLanguage: result.detectedSourceLanguage || request.sourceLanguage,
    }
  },
}
