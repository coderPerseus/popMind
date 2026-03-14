import type { WebSearchProvider } from '@/lib/web-search/types'

export const jinaProvider: WebSearchProvider = {
  id: 'jina',
  isConfigured(apiKey) {
    return Boolean(apiKey.trim())
  },
  async search({ query, apiKey }) {
    const response = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, {
      headers: apiKey.trim()
        ? {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          }
        : {
            Accept: 'application/json',
          },
    })

    if (!response.ok) {
      throw new Error(`Jina request failed: ${response.status}`)
    }

    const json = (await response.json()) as {
      data?: Array<{ title?: string; url?: string; content?: string; description?: string }>
    }

    return (json.data ?? [])
      .filter((item) => item.url)
      .slice(0, 5)
      .map((item) => ({
        title: item.title?.trim() || item.url!,
        url: item.url!,
        snippet: item.description?.trim() || item.content?.trim() || '',
        provider: 'jina',
      }))
  },
}
