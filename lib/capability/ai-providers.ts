import { isLocalGemmaConfigured } from '@/lib/capability/gemma'
import type { AiProviderId, CapabilitySettings } from '@/lib/capability/types'

export const aiProviderOrder: AiProviderId[] = ['openai', 'anthropic', 'google', 'kimi', 'deepseek', 'gemma']

export const aiProviderLabels: Record<AiProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude',
  google: 'Gemini',
  kimi: 'Kimi',
  deepseek: 'DeepSeek',
  gemma: 'Gemma',
}

export const listConfiguredAiProviders = (settings: CapabilitySettings): AiProviderId[] => {
  return aiProviderOrder.filter((providerId) => {
    if (providerId === 'gemma') {
      return isLocalGemmaConfigured(settings)
    }

    return Boolean(settings.aiService.providers[providerId]?.apiKey.trim())
  })
}
