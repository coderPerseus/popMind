import { createDeepSeek } from '@ai-sdk/deepseek'
import { trimTranslationText } from '@/lib/translation/shared'
import type { TranslationProvider, TranslationRequest, TranslationResult, TranslationSettings } from '@/lib/translation/types'
import { translateWithAi } from './ai/translate-with-ai'

const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat'

const getDeepSeekClient = (settings: TranslationSettings) => {
  return createDeepSeek({
    apiKey: settings.ai.deepseekApiKey,
    baseURL: settings.ai.deepseekBaseUrl?.trim() || DEFAULT_DEEPSEEK_BASE_URL,
  })
}

const getDeepSeekModelId = (settings: TranslationSettings) => {
  return settings.ai.deepseekModel?.trim() || DEFAULT_DEEPSEEK_MODEL
}

export const deepseekProvider: TranslationProvider = {
  id: 'deepseek',
  isConfigured(settings) {
    return Boolean(settings.ai.deepseekApiKey.trim())
  },
  async detectLanguage(text, settings) {
    const client = getDeepSeekClient(settings)
    const result = await translateWithAi({
      model: client(getDeepSeekModelId(settings)),
      text,
      sourceLanguage: 'auto',
      targetLanguage: 'en',
    })

    return result.detectedSourceLanguage || 'auto'
  },
  async translate(request: TranslationRequest, settings: TranslationSettings): Promise<TranslationResult> {
    const client = getDeepSeekClient(settings)
    const result = await translateWithAi({
      model: client(getDeepSeekModelId(settings)),
      text: request.text,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
    })

    if (!result.translatedText) {
      throw new Error('DeepSeek translate returned an empty result')
    }

    return {
      engineId: 'deepseek',
      queryMode: 'text',
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      sourceText: trimTranslationText(request.text),
      translatedText: result.translatedText,
      detectedSourceLanguage: result.detectedSourceLanguage || request.sourceLanguage,
    }
  },
}
