import type { TranslationEngineId, TranslationLanguageOption, TranslationSettings } from './types'

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
