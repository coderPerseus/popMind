import { app } from 'electron'
import { join } from 'node:path'
import type { AppLanguage, CapabilitySettings, CapabilitySettingsPatch, LegacyTranslationSettings } from './types'

export const capabilitySettingsFileName = 'capability-settings.json'
export const legacyTranslationSettingsFileName = 'translation-settings.json'

const defaultAiProviderConfig = {
  apiKey: '',
  baseURL: '',
  model: '',
}

const defaultWebSearchProviderConfig = {
  apiKey: '',
}

export const defaultCapabilitySettings: CapabilitySettings = {
  appLanguage: 'zh-CN',
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
  aiService: {
    activeProvider: null,
    providers: {
      openai: { ...defaultAiProviderConfig },
      anthropic: { ...defaultAiProviderConfig },
      google: { ...defaultAiProviderConfig },
      kimi: { ...defaultAiProviderConfig, baseURL: 'https://api.moonshot.cn/v1' },
      deepseek: { ...defaultAiProviderConfig, baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' },
    },
  },
  webSearch: {
    enabled: false,
    providers: {
      tavily: { ...defaultWebSearchProviderConfig },
      serper: { ...defaultWebSearchProviderConfig },
      brave: { ...defaultWebSearchProviderConfig },
      jina: { ...defaultWebSearchProviderConfig },
    },
  },
}

export const getCapabilitySettingsFilePath = () => join(app.getPath('userData'), capabilitySettingsFileName)
export const getLegacyTranslationSettingsFilePath = () => join(app.getPath('userData'), legacyTranslationSettingsFileName)

export const mergeCapabilitySettings = (
  previous: CapabilitySettings,
  patch: Partial<CapabilitySettings> | CapabilitySettingsPatch
): CapabilitySettings => {
  return {
    ...previous,
    ...patch,
    appLanguage: (patch as CapabilitySettingsPatch).appLanguage ?? previous.appLanguage,
    enabledEngines: {
      ...previous.enabledEngines,
      ...patch.enabledEngines,
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

export const resolveInitialAppLanguage = (systemLocale?: string | null): AppLanguage => {
  if (systemLocale?.toLowerCase().startsWith('en')) {
    return 'en'
  }

  return 'zh-CN'
}

export const migrateLegacyTranslationSettings = (
  legacy: LegacyTranslationSettings | undefined,
  systemLocale?: string | null
) => {
  const base = mergeCapabilitySettings(defaultCapabilitySettings, {
    appLanguage: resolveInitialAppLanguage(systemLocale),
  })

  if (!legacy) {
    return base
  }

  return mergeCapabilitySettings(base, {
    enabledEngines: legacy.enabledEngines,
    firstLanguage: legacy.firstLanguage ?? base.firstLanguage,
    secondLanguage: legacy.secondLanguage ?? base.secondLanguage,
    defaultSourceLanguage: legacy.defaultSourceLanguage ?? base.defaultSourceLanguage,
    aiService: {
      providers: {
        deepseek: {
          apiKey: legacy.ai?.deepseekApiKey ?? '',
          baseURL: legacy.ai?.deepseekBaseUrl ?? base.aiService.providers.deepseek.baseURL,
          model: legacy.ai?.deepseekModel ?? base.aiService.providers.deepseek.model,
        },
      },
      activeProvider: legacy.ai?.deepseekApiKey ? 'deepseek' : null,
    },
  })
}
