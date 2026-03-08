import type { TranslationProvider } from '@/lib/translation/types'
import { googleProvider } from './google-provider'

const unsupportedProvider = (id: TranslationProvider['id']): TranslationProvider => ({
  id,
  isConfigured() {
    return false
  },
  async translate() {
    throw new Error(`${id} provider is not implemented yet`)
  },
})

export const translationProviders: Record<TranslationProvider['id'], TranslationProvider> = {
  google: googleProvider,
  deepl: unsupportedProvider('deepl'),
  bing: unsupportedProvider('bing'),
  youdao: unsupportedProvider('youdao'),
  deepseek: unsupportedProvider('deepseek'),
}
