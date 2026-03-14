import { aiProvider } from './ai-provider'
import { bingProvider } from './bing-provider'
import { deeplProvider } from './deepl-provider'
import { googleProvider } from './google-provider'
import { youdaoProvider } from './youdao-provider'
import type { TranslationProvider } from '@/lib/translation/types'

export const translationProviders: Record<TranslationProvider['id'], TranslationProvider> = {
  ai: aiProvider,
  google: googleProvider,
  deepl: deeplProvider,
  bing: bingProvider,
  youdao: youdaoProvider,
}
