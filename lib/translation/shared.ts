import { isLocalGemmaConfigured } from '@/lib/capability/gemma'
import type {
  TranslateInput,
  TranslationEngineId,
  TranslationLanguageOption,
  TranslationQueryMode,
  TranslationSettings,
  TranslationWindowSpeakPayload,
} from './types'

export const translationEngineOrder: TranslationEngineId[] = ['google', 'deepl', 'bing', 'youdao', 'ai', 'gemma']

export const translationEngineLabels: Record<TranslationEngineId, string> = {
  google: 'Google',
  deepl: 'DeepL',
  bing: 'Bing',
  youdao: '有道',
  ai: 'AI',
  gemma: 'Gemma',
}

export const translationLanguages: TranslationLanguageOption[] = [
  { code: 'auto', label: '自动检测' },
  { code: 'en', label: '英语' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁体中文' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'ru', label: '俄语' },
  { code: 'it', label: '意大利语' },
  { code: 'pt', label: '葡萄牙语' },
]

export const defaultTranslationSettings: TranslationSettings = {
  appLanguage: 'zh-CN',
  enabledEngines: {
    google: true,
    deepl: false,
    bing: false,
    youdao: false,
    ai: false,
    gemma: false,
  },
  firstLanguage: 'en',
  secondLanguage: 'zh-CN',
  defaultSourceLanguage: 'auto',
  aiService: {
    activeProvider: null,
    providers: {
      openai: {
        apiKey: '',
        baseURL: '',
        model: '',
      },
      anthropic: {
        apiKey: '',
        baseURL: '',
        model: '',
      },
      google: {
        apiKey: '',
        baseURL: '',
        model: '',
      },
      kimi: {
        apiKey: '',
        baseURL: 'https://api.moonshot.cn/v1',
        model: '',
      },
      deepseek: {
        apiKey: '',
        baseURL: 'https://api.deepseek.com',
        model: 'deepseek-chat',
      },
      gemma: {
        apiKey: 'local',
        baseURL: 'http://127.0.0.1:1234/v1',
        model: 'gemma-4-e4b-it',
      },
    },
  },
  localModels: {
    gemma: {
      enabled: false,
      apiKey: 'local',
      baseURL: 'http://127.0.0.1:1234/v1',
      model: '',
    },
  },
  webSearch: {
    enabled: false,
    providers: {
      tavily: { apiKey: '' },
      serper: { apiKey: '' },
      brave: { apiKey: '' },
      jina: { apiKey: '' },
    },
  },
}

export const getVisibleTranslationEngineIds = (settings: TranslationSettings): TranslationEngineId[] => {
  return translationEngineOrder.filter((engineId) => engineId !== 'gemma' || isLocalGemmaConfigured(settings))
}

export const DEFAULT_TRANSLATION_TEXT_WINDOW_MIN_HEIGHT = 300
export const DEFAULT_TRANSLATION_WORD_WINDOW_MIN_HEIGHT = 600

export const TranslationWindowChannel = {
  State: 'translationWindow:state',
  GetState: 'translationWindow:getState',
  Retranslate: 'translationWindow:retranslate',
  SetPinned: 'translationWindow:setPinned',
  SetDragging: 'translationWindow:setDragging',
  NotifyInteraction: 'translationWindow:notifyInteraction',
  Move: 'translationWindow:move',
  Resize: 'translationWindow:resize',
  Copy: 'translationWindow:copy',
  Speak: 'translationWindow:speak',
  StopSpeaking: 'translationWindow:stopSpeaking',
  Close: 'translationWindow:close',
  DismissTopmost: 'translationWindow:dismissTopmost',
} as const

export const getLanguageLabel = (code: string) => {
  return translationLanguages.find((item) => item.code === code)?.label ?? code
}

export const getLanguageFamily = (code: string) => {
  return code.toLowerCase().split('-')[0]
}

export const isEnglishLanguage = (code?: string) => {
  if (!code) {
    return false
  }

  return getLanguageFamily(code) === 'en'
}

export const isSameLanguage = (left: string, right: string) => {
  return left.toLowerCase() === right.toLowerCase() || getLanguageFamily(left) === getLanguageFamily(right)
}

export const trimTranslationText = (text: string) => {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trimEnd())
    .join('\n')
    .trim()
}

export const looksLikeEnglishText = (text: string) => {
  const normalized = trimTranslationText(text)

  if (!normalized) {
    return false
  }

  if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/i.test(normalized)) {
    return false
  }

  const latinLetterCount = normalized.match(/[A-Za-z]/g)?.length ?? 0
  return latinLetterCount >= Math.min(4, normalized.length)
}

export const isEnglishWord = (text: string) => {
  return /^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(text) && text.length <= 48
}

const normalizeSpeechLocale = (code?: string) => {
  if (!code || !isEnglishLanguage(code)) {
    return 'en-US'
  }

  return code.toLowerCase() === 'en-gb' ? 'en-GB' : 'en-US'
}

export const resolveEnglishSpeechPayload = ({
  queryMode,
  sourceText,
  translatedText,
  sourceLanguage,
  targetLanguage,
  detectedSourceLanguage,
  headword,
}: {
  queryMode: TranslationQueryMode
  sourceText: string
  translatedText: string
  sourceLanguage: string
  targetLanguage: string
  detectedSourceLanguage?: string
  headword?: string
}): TranslationWindowSpeakPayload | null => {
  if (queryMode === 'word') {
    const normalizedHeadword = headword?.trim() ?? ''
    if (!isEnglishWord(normalizedHeadword)) {
      return null
    }

    return {
      text: normalizedHeadword,
      lang: 'en-US',
      role: 'headword',
    }
  }

  const normalizedSourceText = trimTranslationText(sourceText)
  const normalizedTranslatedText = trimTranslationText(translatedText)
  const resolvedSourceLanguage = detectedSourceLanguage || sourceLanguage

  if (normalizedSourceText && (isEnglishLanguage(resolvedSourceLanguage) || looksLikeEnglishText(normalizedSourceText))) {
    return {
      text: normalizedSourceText,
      lang: normalizeSpeechLocale(resolvedSourceLanguage),
      role: 'source',
    }
  }

  if (normalizedTranslatedText && (isEnglishLanguage(targetLanguage) || looksLikeEnglishText(normalizedTranslatedText))) {
    return {
      text: normalizedTranslatedText,
      lang: normalizeSpeechLocale(targetLanguage),
      role: 'translated',
    }
  }

  return null
}

export const resolveTranslationQueryMode = (
  input: Pick<TranslateInput, 'queryMode' | 'sourceLanguage' | 'text'>
): TranslationQueryMode => {
  if (input.queryMode) {
    return input.queryMode
  }

  const text = trimTranslationText(input.text)
  const sourceLanguage = input.sourceLanguage ?? defaultTranslationSettings.defaultSourceLanguage
  const sourceFamily = getLanguageFamily(sourceLanguage)

  if (sourceLanguage !== 'auto' && sourceFamily !== 'en') {
    return 'text'
  }

  return isEnglishWord(text) ? 'word' : 'text'
}

export const getTranslationWindowMinHeight = (queryMode: TranslationQueryMode) => {
  return queryMode === 'word' ? DEFAULT_TRANSLATION_WORD_WINDOW_MIN_HEIGHT : DEFAULT_TRANSLATION_TEXT_WINDOW_MIN_HEIGHT
}

export const ensureSelectableLanguage = (code: string) => {
  if (translationLanguages.some((item) => item.code === code)) {
    return code
  }

  return 'en'
}

const hasConfiguredAiTranslation = (settings: TranslationSettings) => {
  if (!settings.enabledEngines.ai) {
    return false
  }

  const activeProvider = settings.aiService.activeProvider
  if (!activeProvider) {
    return false
  }

  return Boolean(settings.aiService.providers[activeProvider]?.apiKey.trim())
}

const hasConfiguredGemmaTranslation = (settings: TranslationSettings) => {
  return Boolean(settings.enabledEngines.gemma && isLocalGemmaConfigured(settings))
}

export const getEnabledTranslationEngineIds = (settings: TranslationSettings): TranslationEngineId[] => {
  const enabledEngineIds = getVisibleTranslationEngineIds(settings).filter((engineId) => settings.enabledEngines[engineId])

  if (!hasConfiguredAiTranslation(settings) || !enabledEngineIds.includes('ai')) {
    if (hasConfiguredGemmaTranslation(settings) && enabledEngineIds.includes('gemma')) {
      return ['gemma', ...enabledEngineIds.filter((engineId) => engineId !== 'gemma')]
    }

    return enabledEngineIds
  }

  return ['ai', ...enabledEngineIds.filter((engineId) => engineId !== 'ai')]
}

export const resolvePreferredTranslationEngine = (
  settings: TranslationSettings,
  preferred?: TranslationEngineId
): TranslationEngineId | undefined => {
  const enabledEngineIds = getEnabledTranslationEngineIds(settings)

  if (preferred && enabledEngineIds.includes(preferred)) {
    return preferred
  }

  return enabledEngineIds[0]
}

export const mergeSettings = (
  previous: TranslationSettings,
  patch: Partial<TranslationSettings>
): TranslationSettings => {
  const patchEnabledEngines = patch.enabledEngines as Partial<TranslationSettings['enabledEngines']> & {
    deepseek?: boolean
  }

  return {
    ...previous,
    ...patch,
    enabledEngines: {
      ...previous.enabledEngines,
      ...patch.enabledEngines,
      ai: patchEnabledEngines?.ai ?? patchEnabledEngines?.deepseek ?? previous.enabledEngines.ai,
      gemma: patchEnabledEngines?.gemma ?? previous.enabledEngines.gemma,
    },
    aiService: {
      ...previous.aiService,
      ...patch.aiService,
      providers: {
        ...previous.aiService.providers,
        ...patch.aiService?.providers,
        openai: {
          ...previous.aiService.providers.openai,
          ...patch.aiService?.providers?.openai,
        },
        anthropic: {
          ...previous.aiService.providers.anthropic,
          ...patch.aiService?.providers?.anthropic,
        },
        google: {
          ...previous.aiService.providers.google,
          ...patch.aiService?.providers?.google,
        },
        kimi: {
          ...previous.aiService.providers.kimi,
          ...patch.aiService?.providers?.kimi,
        },
        deepseek: {
          ...previous.aiService.providers.deepseek,
          ...patch.aiService?.providers?.deepseek,
        },
        gemma: {
          ...previous.aiService.providers.gemma,
          ...patch.aiService?.providers?.gemma,
        },
      },
    },
    localModels: {
      ...previous.localModels,
      ...patch.localModels,
      gemma: {
        ...previous.localModels.gemma,
        ...patch.localModels?.gemma,
      },
    },
    webSearch: {
      ...previous.webSearch,
      ...patch.webSearch,
      providers: {
        ...previous.webSearch.providers,
        ...patch.webSearch?.providers,
        tavily: {
          ...previous.webSearch.providers.tavily,
          ...patch.webSearch?.providers?.tavily,
        },
        serper: {
          ...previous.webSearch.providers.serper,
          ...patch.webSearch?.providers?.serper,
        },
        brave: {
          ...previous.webSearch.providers.brave,
          ...patch.webSearch?.providers?.brave,
        },
        jina: {
          ...previous.webSearch.providers.jina,
          ...patch.webSearch?.providers?.jina,
        },
      },
    },
  }
}
