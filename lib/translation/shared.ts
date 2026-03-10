import type { TranslateInput, TranslationEngineId, TranslationLanguageOption, TranslationQueryMode, TranslationSettings } from './types'

export const translationEngineOrder: TranslationEngineId[] = ['google', 'deepl', 'bing', 'youdao', 'deepseek']

export const translationEngineLabels: Record<TranslationEngineId, string> = {
  google: 'Google',
  deepl: 'DeepL',
  bing: 'Bing',
  youdao: '有道',
  deepseek: 'DeepSeek',
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
  enabledEngines: {
    google: true,
    deepl: false,
    bing: false,
    youdao: false,
    deepseek: false,
  },
  firstLanguage: 'en',
  secondLanguage: 'zh-CN',
  defaultSourceLanguage: 'auto',
  ai: {
    deepseekApiKey: '',
    deepseekBaseUrl: '',
    deepseekModel: '',
  },
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
  Close: 'translationWindow:close',
  DismissTopmost: 'translationWindow:dismissTopmost',
} as const

export const getLanguageLabel = (code: string) => {
  return translationLanguages.find((item) => item.code === code)?.label ?? code
}

export const getLanguageFamily = (code: string) => {
  return code.toLowerCase().split('-')[0]
}

export const isSameLanguage = (left: string, right: string) => {
  return left.toLowerCase() === right.toLowerCase() || getLanguageFamily(left) === getLanguageFamily(right)
}

export const trimTranslationText = (text: string) => {
  return text.replace(/\s+/g, ' ').trim()
}

export const isEnglishWord = (text: string) => {
  return /^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(text) && text.length <= 48
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

export const mergeSettings = (
  previous: TranslationSettings,
  patch: Partial<TranslationSettings>
): TranslationSettings => {
  return {
    ...previous,
    ...patch,
    enabledEngines: {
      ...previous.enabledEngines,
      ...patch.enabledEngines,
    },
    ai: {
      ...previous.ai,
      ...patch.ai,
    },
  }
}
