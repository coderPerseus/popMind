import type { MainSearchPlugin } from '@/app/plugins/main-search/types'
import type { AppLanguage } from '@/lib/capability/types'
import { translateMessage, type I18nKey } from '@/lib/i18n/shared'

type AskPluginConfig = {
  id: string
  titleKey: I18nKey
  handle: string
  slashAliases: string[]
  order: number
  descriptionKey: I18nKey
  keywords: string[]
  homepageUrl: string
  buildLaunchUrl?: (query: string) => string
  logo: {
    src: string
    alt: string
    background?: string
  }
}

const normalizeQuery = (query: string) => query.trim()

export const createAskPlugin = (language: AppLanguage, config: AskPluginConfig): MainSearchPlugin => {
  const manifest = {
    id: config.id,
    title: translateMessage(language, config.titleKey),
    handle: config.handle,
    slashAliases: config.slashAliases,
    order: config.order,
    typeLabel: translateMessage(language, 'plugin.type.aiExtension'),
    mode: 'link' as const,
    keywords: config.keywords,
    logo: config.logo,
    description: translateMessage(language, config.descriptionKey),
  }

  return {
    manifest,
    shouldDisplay(query) {
      return Boolean(normalizeQuery(query))
    },
    toResult() {
      return manifest
    },
    async run({ query, openUrl, copyText }) {
      const normalizedQuery = normalizeQuery(query)
      if (!normalizedQuery) {
        return
      }

      await copyText(normalizedQuery).catch(() => false)
      const launchUrl = config.buildLaunchUrl?.(normalizedQuery) ?? config.homepageUrl

      await openUrl(launchUrl)
    },
  }
}
