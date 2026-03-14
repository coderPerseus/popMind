import type { WebSearchProvider } from '@/lib/web-search/types'

export const tavilyProvider: WebSearchProvider = {
  id: 'tavily',
  isConfigured(apiKey) {
    return Boolean(apiKey.trim())
  },
  async search({ query, apiKey }) {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
      }),
    })

    if (!response.ok) {
      throw new Error(`Tavily request failed: ${response.status}`)
    }

    const json = (await response.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>
    }

    return (json.results ?? [])
      .filter((item) => item.url)
      .map((item) => ({
        title: item.title?.trim() || item.url!,
        url: item.url!,
        snippet: item.content?.trim() || '',
        provider: 'tavily',
      }))
  },
}
