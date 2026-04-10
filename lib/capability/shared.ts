import { app } from 'electron'
import { join } from 'node:path'
import type {
  AppLanguage,
  CapabilitySettings,
  CapabilitySettingsPatch,
  LegacyTranslationSettings,
  LocalGemmaConfig,
} from './types'

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

const defaultLocalGemmaConfig: LocalGemmaConfig = {
  enabled: false,
  apiKey: 'local',
  baseURL: 'http://127.0.0.1:1234/v1',
  model: '',
}

const mergeLocalGemmaConfig = (
  previous: LocalGemmaConfig,
  patch?: Partial<LocalGemmaConfig>,
  fallbackProviderPatch?: Partial<{ apiKey?: string; baseURL?: string; model?: string }>
) => {
  const next = {
    ...previous,
    ...patch,
  }

  if (!patch && fallbackProviderPatch) {
    next.apiKey = fallbackProviderPatch.apiKey ?? next.apiKey
    next.baseURL = fallbackProviderPatch.baseURL ?? next.baseURL
    next.model = fallbackProviderPatch.model ?? next.model

    if (fallbackProviderPatch.apiKey || fallbackProviderPatch.baseURL || fallbackProviderPatch.model) {
      next.enabled = Boolean(next.apiKey.trim() && next.baseURL.trim() && next.model.trim())
    }
  }

  return next
}

export const defaultCapabilitySettings: CapabilitySettings = {
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
      openai: { ...defaultAiProviderConfig },
      anthropic: { ...defaultAiProviderConfig },
      google: { ...defaultAiProviderConfig },
      kimi: { ...defaultAiProviderConfig, baseURL: 'https://api.moonshot.cn/v1' },
      deepseek: { ...defaultAiProviderConfig, baseURL: 'https://api.deepseek.com', model: 'deepseek-chat' },
      gemma: { ...defaultAiProviderConfig, apiKey: 'local', baseURL: 'http://127.0.0.1:1234/v1', model: 'gemma-4-e4b-it' },
    },
  },
  localModels: {
    gemma: { ...defaultLocalGemmaConfig },
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

const normalizeEnabledEngines = (options: {
  previous?: CapabilitySettings['enabledEngines']
  patch?: Partial<CapabilitySettings['enabledEngines']> & {
    deepseek?: boolean
  }
}): CapabilitySettings['enabledEngines'] | undefined => {
  const { previous, patch } = options

  if (!previous && !patch) {
    return undefined
  }

  const aiEnabled = patch?.ai ?? patch?.deepseek ?? previous?.ai ?? false

  return {
    google: patch?.google ?? previous?.google ?? false,
    deepl: patch?.deepl ?? previous?.deepl ?? false,
    bing: patch?.bing ?? previous?.bing ?? false,
    youdao: patch?.youdao ?? previous?.youdao ?? false,
    ai: aiEnabled,
    gemma: patch?.gemma ?? previous?.gemma ?? false,
  }
}

const legacyEnabledEngines = (
  enabledEngines?: Partial<CapabilitySettings['enabledEngines']> & {
    deepseek?: boolean
  }
) => {
  if (!enabledEngines) {
    return undefined
  }
  return normalizeEnabledEngines({ patch: enabledEngines })
}

export const getCapabilitySettingsFilePath = () => join(app.getPath('userData'), capabilitySettingsFileName)
export const getLegacyTranslationSettingsFilePath = () => join(app.getPath('userData'), legacyTranslationSettingsFileName)

export const mergeCapabilitySettings = (
  previous: CapabilitySettings,
  patch: Partial<CapabilitySettings> | CapabilitySettingsPatch
): CapabilitySettings => {
  const nextLocalGemma = mergeLocalGemmaConfig(
    previous.localModels.gemma,
    patch.localModels?.gemma,
    patch.aiService?.providers?.gemma
  )

  return {
    ...previous,
    ...patch,
    appLanguage: (patch as CapabilitySettingsPatch).appLanguage ?? previous.appLanguage,
    enabledEngines:
      normalizeEnabledEngines({
        previous: previous.enabledEngines,
        patch: patch.enabledEngines as Partial<CapabilitySettings['enabledEngines']> & { deepseek?: boolean },
      }) ?? previous.enabledEngines,
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
          apiKey: nextLocalGemma.apiKey,
          baseURL: nextLocalGemma.baseURL,
          model: nextLocalGemma.model,
        },
      },
    },
    localModels: {
      ...previous.localModels,
      ...patch.localModels,
      gemma: nextLocalGemma,
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
    enabledEngines: legacyEnabledEngines(legacy.enabledEngines),
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
