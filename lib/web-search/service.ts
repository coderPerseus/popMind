import type { CapabilitySettings, WebSearchProviderId } from '@/lib/capability/types'
import { braveProvider } from './providers/brave'
import { jinaProvider } from './providers/jina'
import { serperProvider } from './providers/serper'
import { tavilyProvider } from './providers/tavily'
import type { WebSearchProvider, WebSearchResult } from './types'

const providers: Record<WebSearchProviderId, WebSearchProvider> = {
  tavily: tavilyProvider,
  serper: serperProvider,
  brave: braveProvider,
  jina: jinaProvider,
}

const providerOrder: WebSearchProviderId[] = ['tavily', 'serper', 'brave', 'jina']

export class WebSearchService {
  resolveProvider(settings: CapabilitySettings) {
    if (!settings.webSearch.enabled) {
      return null
    }

    for (const providerId of providerOrder) {
      const apiKey = settings.webSearch.providers[providerId].apiKey
      if (providers[providerId].isConfigured(apiKey)) {
        return {
          providerId,
          apiKey,
        }
      }
    }

    return null
  }

  async search(settings: CapabilitySettings, query: string): Promise<{
    providerId?: WebSearchProviderId
    results: WebSearchResult[]
  }> {
    const resolved = this.resolveProvider(settings)
    if (!resolved) {
      return { results: [] }
    }

    const results = await providers[resolved.providerId].search({
      query,
      apiKey: resolved.apiKey,
    })

    return {
      providerId: resolved.providerId,
      results,
    }
  }
}

export const webSearchService = new WebSearchService()
