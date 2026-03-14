import type { WebSearchProviderId } from '@/lib/capability/types'

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  provider: WebSearchProviderId
}

export interface WebSearchProvider {
  id: WebSearchProviderId
  isConfigured(apiKey: string): boolean
  search(input: { query: string; apiKey: string }): Promise<WebSearchResult[]>
}
