import type { CapabilitySettings, LocalGemmaConfig } from './types'

export const isLocalGemmaConfigured = (
  settings: Pick<CapabilitySettings, 'localModels'> | { localModels?: { gemma?: Partial<LocalGemmaConfig> } }
) => {
  const gemma = settings.localModels?.gemma
  return Boolean(gemma?.enabled && gemma.apiKey?.trim() && gemma.baseURL?.trim() && gemma.model?.trim())
}
