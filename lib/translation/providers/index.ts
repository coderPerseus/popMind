import type { TranslationProvider } from '@/lib/translation/types'
import { bingProvider } from './bing-provider'
import { deepseekProvider } from './deepseek-provider'
import { deeplProvider } from './deepl-provider'
import { googleProvider } from './google-provider'
import { youdaoProvider } from './youdao-provider'

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
  deepl: deeplProvider,
  bing: bingProvider,
  youdao: youdaoProvider,
  deepseek: deepseekProvider,
}
