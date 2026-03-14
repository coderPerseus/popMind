import { bingProvider } from './bing-provider'
import { deepseekProvider } from './deepseek-provider'
import { deeplProvider } from './deepl-provider'
import { googleProvider } from './google-provider'
import { youdaoProvider } from './youdao-provider'
import type { TranslationProvider } from '@/lib/translation/types'

export const translationProviders: Record<TranslationProvider['id'], TranslationProvider> = {
  google: googleProvider,
  deepl: deeplProvider,
  bing: bingProvider,
  youdao: youdaoProvider,
  deepseek: deepseekProvider,
}
