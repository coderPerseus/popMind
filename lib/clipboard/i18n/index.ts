// Clipboard feature strings, kept out of lib/i18n/shared.ts so parallel work packages do not conflict.
// Use: clipT(language, 'clip.panel.search.placeholder', { count: 3 }). `{name}` placeholders are replaced.
import type { AppLanguage } from '@/lib/capability/types'
import { clipPanelMessages } from '@/lib/clipboard/i18n/panel'
import { clipSettingsMessages } from '@/lib/clipboard/i18n/settings'

const dictionaries: Record<AppLanguage, Record<string, string>> = {
  'zh-CN': { ...clipPanelMessages['zh-CN'], ...clipSettingsMessages['zh-CN'] },
  en: { ...clipPanelMessages.en, ...clipSettingsMessages.en },
}

export const clipT = (language: AppLanguage, key: string, params?: Record<string, string | number>) => {
  const template = dictionaries[language]?.[key] ?? dictionaries['zh-CN'][key] ?? key
  return params ? template.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? '')) : template
}
