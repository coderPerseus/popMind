import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI, openai } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import type { AiProviderId, CapabilitySettings } from '@/lib/capability/types'

const DEFAULT_MODELS: Record<AiProviderId, string> = {
  openai: 'gpt-5-mini',
  anthropic: 'claude-3-5-haiku-latest',
  google: 'gemini-2.5-flash',
  kimi: 'moonshot-v1-8k',
  deepseek: 'deepseek-chat',
}

const DEFAULT_CONTEXT_LIMITS: Record<AiProviderId, number> = {
  openai: 128_000,
  anthropic: 200_000,
  google: 128_000,
  kimi: 128_000,
  deepseek: 64_000,
}

const trimOptional = (value?: string) => value?.trim() || undefined
const OPENAI_OFFICIAL_HOSTS = new Set(['api.openai.com'])

const normalizeOpenAIBaseURL = (value?: string) => {
  const trimmed = trimOptional(value)
  if (!trimmed) {
    return undefined
  }

  try {
    const url = new URL(trimmed)
    const normalizedPath = url.pathname.replace(/\/+$/, '')

    if (normalizedPath.endsWith('/chat/completions')) {
      url.pathname = normalizedPath.slice(0, -'/chat/completions'.length) || '/'
    } else if (normalizedPath.endsWith('/responses')) {
      url.pathname = normalizedPath.slice(0, -'/responses'.length) || '/'
    }

    return url.toString().replace(/\/$/, '')
  } catch {
    return trimmed.replace(/\/(chat\/completions|responses)\/?$/, '')
  }
}

const shouldUseOpenAIChatApi = (baseURL?: string) => {
  const normalized = normalizeOpenAIBaseURL(baseURL)
  if (!normalized) {
    return false
  }

  try {
    return !OPENAI_OFFICIAL_HOSTS.has(new URL(normalized).host)
  } catch {
    return true
  }
}

export const resolveAiProviderConfig = (settings: CapabilitySettings) => {
  const providerId = settings.aiService.activeProvider
  if (!providerId) {
    return null
  }

  const config = settings.aiService.providers[providerId]
  if (!config?.apiKey.trim()) {
    return null
  }

  return {
    providerId,
    config,
    modelId: trimOptional(config.model) || DEFAULT_MODELS[providerId],
    contextLimit: DEFAULT_CONTEXT_LIMITS[providerId],
  }
}

export const createLanguageModel = (settings: CapabilitySettings): {
  providerId: AiProviderId
  modelId: string
  contextLimit: number
  model: LanguageModel
} | null => {
  const resolved = resolveAiProviderConfig(settings)
  if (!resolved) {
    return null
  }

  const { providerId, config, modelId, contextLimit } = resolved

  if (providerId === 'openai') {
    const normalizedBaseURL = normalizeOpenAIBaseURL(config.baseURL)
    const provider = normalizedBaseURL
      ? createOpenAI({
          apiKey: config.apiKey,
          baseURL: normalizedBaseURL,
          name: 'openai-compatible',
        })
      : openai
    const model = shouldUseOpenAIChatApi(normalizedBaseURL) ? provider.chat(modelId) : provider(modelId)

    return {
      providerId,
      modelId,
      contextLimit,
      model,
    }
  }

  if (providerId === 'anthropic') {
    const provider = trimOptional(config.baseURL)
      ? createAnthropic({
          apiKey: config.apiKey,
          baseURL: trimOptional(config.baseURL),
        })
      : createAnthropic({
          apiKey: config.apiKey,
        })

    return {
      providerId,
      modelId,
      contextLimit,
      model: provider(modelId),
    }
  }

  if (providerId === 'google') {
    const provider = trimOptional(config.baseURL)
      ? createGoogleGenerativeAI({
          apiKey: config.apiKey,
          baseURL: trimOptional(config.baseURL),
        })
      : createGoogleGenerativeAI({
          apiKey: config.apiKey,
        })

    return {
      providerId,
      modelId,
      contextLimit,
      model: provider(modelId),
    }
  }

  if (providerId === 'kimi') {
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: trimOptional(config.baseURL) || 'https://api.moonshot.cn/v1',
    })

    return {
      providerId,
      modelId,
      contextLimit,
      model: provider(modelId),
    }
  }

  const provider = createDeepSeek({
    apiKey: config.apiKey,
    baseURL: trimOptional(config.baseURL) || 'https://api.deepseek.com',
  })

  return {
    providerId,
    modelId,
    contextLimit,
    model: provider(modelId),
  }
}

export const estimateMessageTokens = (parts: string[]) => {
  const content = parts.join('\n')
  return Math.ceil(content.length / 4)
}
