import type { TranslationEngineId } from '@/lib/translation/types'

export type AppLanguage = 'zh-CN' | 'en'
export type AiProviderId = 'openai' | 'anthropic' | 'google' | 'kimi' | 'deepseek'
export type WebSearchProviderId = 'tavily' | 'serper' | 'brave' | 'jina'
export type AiServiceTestErrorCode = 'missing-config' | 'request-failed'

export interface AiProviderConfig {
  apiKey: string
  baseURL?: string
  model?: string
}

export interface WebSearchProviderConfig {
  apiKey: string
}

export interface CapabilitySettings {
  appLanguage: AppLanguage
  enabledEngines: Record<TranslationEngineId, boolean>
  firstLanguage: string
  secondLanguage: string
  defaultSourceLanguage: 'auto' | string
  aiService: {
    activeProvider: AiProviderId | null
    providers: Record<AiProviderId, AiProviderConfig>
  }
  webSearch: {
    enabled: boolean
    providers: Record<WebSearchProviderId, WebSearchProviderConfig>
  }
}

export interface CapabilitySettingsPatch {
  appLanguage?: AppLanguage
  enabledEngines?: Partial<Record<TranslationEngineId, boolean>>
  firstLanguage?: string
  secondLanguage?: string
  defaultSourceLanguage?: 'auto' | string
  aiService?: {
    activeProvider?: AiProviderId | null
    providers?: Partial<Record<AiProviderId, Partial<AiProviderConfig>>>
  }
  webSearch?: {
    enabled?: boolean
    providers?: Partial<Record<WebSearchProviderId, Partial<WebSearchProviderConfig>>>
  }
}

export interface AiServiceTestResult {
  ok: boolean
  providerId: AiProviderId | null
  modelId: string | null
  errorCode?: AiServiceTestErrorCode
  errorMessage?: string
}

export type LegacyTranslationSettings = {
  enabledEngines?: Partial<Record<TranslationEngineId, boolean>>
  firstLanguage?: string
  secondLanguage?: string
  defaultSourceLanguage?: string
  ai?: {
    deepseekApiKey?: string
    deepseekBaseUrl?: string
    deepseekModel?: string
  }
}
