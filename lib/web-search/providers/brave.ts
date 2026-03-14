import type { WebSearchProvider } from '@/lib/web-search/types'

export const braveProvider: WebSearchProvider = {
  id: 'brave',
  isConfigured(apiKey) {
    return Boolean(apiKey.trim())
  },
  async search({ query, apiKey }) {
    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', '5')

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': apiKey,
      },
    })

    if (!response.ok) {
      throw new Error(`Brave request failed: ${response.status}`)
    }

    const json = (await response.json()) as {
      web?: {
        results?: Array<{ title?: string; url?: string; description?: string }>
      }
    }

    return (json.web?.results ?? [])
      .filter((item) => item.url)
      .map((item) => ({
        title: item.title?.trim() || item.url!,
        url: item.url!,
        snippet: item.description?.trim() || '',
        provider: 'brave',
      }))
  },
}
