import type { CapabilitySettings, WebSearchProviderId, WebSearchServiceTestResult } from '@/lib/capability/types'
import { webSearchService } from './service'

const TEST_TIMEOUT_MS = 12000
const TEST_QUERY = 'OpenAI'

const getErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.replace(/\s+/g, ' ').trim()

  if (!normalized) {
    return 'Unknown error'
  }

  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number) => {
  let timer: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

export const testWebSearchProvider = async (
  settings: CapabilitySettings,
  providerId: WebSearchProviderId
): Promise<WebSearchServiceTestResult> => {
  const provider = webSearchService.getProvider(providerId)
  const apiKey = settings.webSearch.providers[providerId].apiKey

  if (!provider.isConfigured(apiKey)) {
    return {
      ok: false,
      providerId,
      resultCount: 0,
      errorCode: 'missing-config',
    }
  }

  try {
    const results = await withTimeout(
      provider.search({
        query: TEST_QUERY,
        apiKey,
      }),
      TEST_TIMEOUT_MS
    )

    return {
      ok: true,
      providerId,
      resultCount: results.length,
    }
  } catch (error) {
    return {
      ok: false,
      providerId,
      resultCount: 0,
      errorCode: 'request-failed',
      errorMessage: getErrorMessage(error),
    }
  }
}
