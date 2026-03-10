import type { MainSearchPlugin } from '@/app/plugins/main-search/types'

type AskPluginConfig = {
  id: string
  title: string
  handle: string
  description: string
  keywords: string[]
  homepageUrl: string
  buildLaunchUrl?: (query: string) => string
  logo: {
    monogram: string
    background: string
    color: string
  }
}

const normalizeQuery = (query: string) => query.trim()

export const createAskPlugin = (config: AskPluginConfig): MainSearchPlugin => {
  const manifest = {
    id: config.id,
    title: config.title,
    handle: config.handle,
    typeLabel: 'AI Extension',
    mode: 'link' as const,
    keywords: config.keywords,
    logo: config.logo,
    description: config.description,
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
