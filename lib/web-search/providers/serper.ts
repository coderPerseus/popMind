import type { WebSearchProvider } from '@/lib/web-search/types'

export const serperProvider: WebSearchProvider = {
  id: 'serper',
  isConfigured(apiKey) {
    return Boolean(apiKey.trim())
  },
  async search({ query, apiKey }) {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        q: query,
        num: 5,
      }),
    })

    if (!response.ok) {
      throw new Error(`Serper request failed: ${response.status}`)
    }

    const json = (await response.json()) as {
      organic?: Array<{ title?: string; link?: string; snippet?: string }>
    }

    return (json.organic ?? [])
      .filter((item) => item.link)
      .map((item) => ({
        title: item.title?.trim() || item.link!,
        url: item.link!,
        snippet: item.snippet?.trim() || '',
        provider: 'serper',
      }))
  },
}
