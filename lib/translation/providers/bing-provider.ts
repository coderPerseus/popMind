import { trimTranslationText } from '@/lib/translation/shared'
import type { TranslationProvider, TranslationRequest, TranslationResult } from '@/lib/translation/types'

const BING_CHINA_HOST = 'cn.bing.com'
const BING_HOST_DISCOVERY_URL = `http://${BING_CHINA_HOST}`
const BING_TRANSLATOR_PATH = '/translator'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'

interface BingWebConfig {
  host: string
  ig: string
  iid: string
  key: string
  token: string
  refreshAt: number
}

interface BingDetectedLanguage {
  language?: string
}

interface BingTranslateItem {
  detectedLanguage?: BingDetectedLanguage
  translations?: Array<{
    text?: string
    to?: string
  }>
}

let cachedConfig: BingWebConfig | null = null
let pendingConfigPromise: Promise<BingWebConfig> | null = null

const extractMatch = (html: string, pattern: RegExp) => {
  const match = html.match(pattern)
  return match?.[1]?.trim()
}

const languageToBingCode = (language: string) => {
  switch (language) {
    case 'auto':
      return 'auto-detect'
    case 'zh-CN':
      return 'zh-Hans'
    case 'zh-TW':
      return 'zh-Hant'
    case 'pt':
      return 'pt-PT'
    default:
      return language
  }
}

const mapBingLanguage = (language?: string) => {
  if (!language) {
    return 'auto'
  }

  switch (language.toLowerCase()) {
    case 'auto-detect':
      return 'auto'
    case 'zh-hans':
      return 'zh-CN'
    case 'zh-hant':
      return 'zh-TW'
    case 'pt-pt':
    case 'pt':
      return 'pt'
    default:
      return language
  }
}

const isConfigValid = (config: BingWebConfig | null) => {
  return Boolean(config && config.refreshAt > Date.now())
}

const resolveBingHost = async () => {
  try {
    const response = await fetch(BING_HOST_DISCOVERY_URL, {
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
      },
    })

    return new URL(response.url).host || BING_CHINA_HOST
  } catch {
    return BING_CHINA_HOST
  }
}

const parseConfigFromHtml = (html: string, host: string): BingWebConfig => {
  const ig = extractMatch(html, /IG:\s*"([^"]+)"/)
  const iid = extractMatch(html, /data-iid\s*=\s*"([^"]+)"/)
  const abuseHelper = extractMatch(html, /params_AbusePreventionHelper\s*=\s*\[([^\]]+)\]/)

  if (!ig || !iid || !abuseHelper) {
    throw new Error('Bing translator config parse failed')
  }

  const [key = '', token = '', expirationInterval = '3600000'] = abuseHelper
    .split(',')
    .map((item) => item.replaceAll('"', '').trim())

  if (!key || !token) {
    throw new Error('Bing translator token parse failed')
  }

  const issuedAt = Number(key) || Date.now()
  const ttl = Number(expirationInterval) || 3_600_000

  return {
    host,
    ig,
    iid,
    key,
    token,
    refreshAt: issuedAt + ttl / 2,
  }
}

const fetchBingConfig = async (forceRefresh = false): Promise<BingWebConfig> => {
  if (!forceRefresh && isConfigValid(cachedConfig)) {
    return cachedConfig as BingWebConfig
  }

  if (!forceRefresh && pendingConfigPromise) {
    return pendingConfigPromise
  }

  pendingConfigPromise = (async () => {
    const host = forceRefresh || !cachedConfig?.host ? await resolveBingHost() : cachedConfig.host
    const response = await fetch(`https://${host}${BING_TRANSLATOR_PATH}`, {
      headers: {
        'User-Agent': USER_AGENT,
      },
    })

    if (!response.ok) {
      throw new Error(`Bing translator page request failed with status ${response.status}`)
    }

    const html = await response.text()
    const resolvedHost = new URL(response.url).host || host
    const config = parseConfigFromHtml(html, resolvedHost)
    cachedConfig = config
    return config
  })()

  try {
    return await pendingConfigPromise
  } finally {
    pendingConfigPromise = null
  }
}

const buildTranslateEndpoint = (config: BingWebConfig) => {
  const query = new URLSearchParams({
    isVertical: '1',
    IG: config.ig,
    IID: config.iid,
  })

  return `https://${config.host}/ttranslatev3?${query.toString()}`
}

const parseTranslatePayload = (payload: unknown) => {
  if (Array.isArray(payload)) {
    return payload as BingTranslateItem[]
  }

  const statusCode =
    payload && typeof payload === 'object' && 'statusCode' in payload ? Number((payload as { statusCode?: number }).statusCode) : null

  if (statusCode === 205) {
    const error = new Error('Bing translator token expired')
    ;(error as Error & { code?: number }).code = 205
    throw error
  }

  throw new Error('Bing translate returned an unexpected payload')
}

const requestBingTranslate = async (
  request: TranslationRequest,
  attempt = 0,
): Promise<BingTranslateItem[]> => {
  const config = await fetchBingConfig(attempt > 0)
  const response = await fetch(buildTranslateEndpoint(config), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': USER_AGENT,
      Referer: `https://${config.host}${BING_TRANSLATOR_PATH}`,
    },
    body: new URLSearchParams({
      text: request.text,
      fromLang: languageToBingCode(request.sourceLanguage),
      to: languageToBingCode(request.targetLanguage),
      token: config.token,
      key: config.key,
      tryFetchingGenderDebiasedTranslations: 'true',
    }),
  })

  if (!response.ok) {
    throw new Error(`Bing translate request failed with status ${response.status}`)
  }

  try {
    return parseTranslatePayload((await response.json()) as unknown)
  } catch (error) {
    const statusCode = error && typeof error === 'object' && 'code' in error ? Number((error as { code?: number }).code) : null
    if (attempt < 1 && (statusCode === 205 || statusCode === null)) {
      cachedConfig = null
      return requestBingTranslate(request, attempt + 1)
    }

    throw error
  }
}

export const bingProvider: TranslationProvider = {
  id: 'bing',
  isConfigured() {
    return true
  },
  async detectLanguage(text) {
    const payload = await requestBingTranslate({
      text,
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      engineId: 'bing',
    })

    return mapBingLanguage(payload[0]?.detectedLanguage?.language)
  },
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const payload = await requestBingTranslate(request)
    const firstResult = payload[0]
    const translatedText = (firstResult?.translations ?? [])
      .map((item) => item.text?.trim() ?? '')
      .filter(Boolean)
      .join('\n')

    if (!translatedText) {
      throw new Error('Bing translate returned an empty result')
    }

    return {
      engineId: 'bing',
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      sourceText: trimTranslationText(request.text),
      translatedText,
      detectedSourceLanguage: mapBingLanguage(firstResult?.detectedLanguage?.language),
    }
  },
}
