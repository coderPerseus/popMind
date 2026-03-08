import { createDecipheriv, createHash } from 'node:crypto'
import { trimTranslationText } from '@/lib/translation/shared'
import type { TranslationProvider, TranslationRequest, TranslationResult } from '@/lib/translation/types'

const YOUDAO_TRANSLATE_BASE_URL = 'https://dict.youdao.com'
const YOUDAO_TRANSLATE_REFERER = 'https://fanyi.youdao.com'
const YOUDAO_DEFAULT_SECRET = 'asdjnjfenknafdfsdfsd'
const YOUDAO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  Referer: YOUDAO_TRANSLATE_REFERER,
  Cookie: 'OUTFOX_SEARCH_USER_ID=1796239350@10.110.96.157;',
}

interface YoudaoKeyPayload {
  code?: number
  data?: {
    secretKey?: string
    aesKey?: string
    aesIv?: string
  }
}

interface YoudaoTranslateItem {
  src: string
  tgt: string
  tgtPronounce?: string
  srcPronounce?: string
}

interface YoudaoTranslatePayload {
  code: number
  type?: string
  translateResult: YoudaoTranslateItem[][]
}

interface YoudaoCachedKey {
  secretKey: string
  aesKey: string
  aesIv: string
  expiresAt: number
}

let cachedKey: YoudaoCachedKey | null = null
let pendingKeyPromise: Promise<YoudaoCachedKey> | null = null

const YOUDAO_KEY_TTL_MS = 10 * 60 * 1000

const languageToYoudaoCode = (language: string) => {
  switch (language) {
    case 'auto':
      return 'AUTO'
    case 'zh-CN':
      return 'zh-CHS'
    case 'zh-TW':
      return 'zh-CHT'
    case 'en':
      return 'en'
    case 'ja':
      return 'ja'
    case 'ko':
      return 'ko'
    case 'fr':
      return 'fr'
    case 'de':
      return 'de'
    case 'es':
      return 'es'
    case 'ru':
      return 'ru'
    case 'it':
      return 'it'
    case 'pt':
      return 'pt'
    default:
      return language
  }
}

const mapYoudaoLanguage = (language?: string) => {
  if (!language) {
    return 'auto'
  }

  switch (language.toLowerCase()) {
    case 'auto':
      return 'auto'
    case 'zh-chs':
      return 'zh-CN'
    case 'zh-cht':
      return 'zh-TW'
    default:
      return language
  }
}

const getMysticTime = () => String(Date.now())

const md5 = (value: string) => createHash('md5').update(value).digest('hex')

const buildSign = (timestamp: string, secretKey: string) => {
  return md5(`client=fanyideskweb&mysticTime=${timestamp}&product=webfanyi&key=${secretKey}`)
}

const toMd5Buffer = (value: string) => createHash('md5').update(value, 'utf8').digest()

const decryptPayload = (encryptedText: string, aesKey: string, aesIv: string) => {
  const normalizedBase64 = encryptedText.replaceAll('-', '+').replaceAll('_', '/')
  const encryptedBuffer = Buffer.from(normalizedBase64, 'base64')
  const decipher = createDecipheriv('aes-128-cbc', toMd5Buffer(aesKey), toMd5Buffer(aesIv))
  decipher.setAutoPadding(true)

  const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()])
  return decrypted.toString('utf8')
}

const parseDetectedLanguage = (type?: string) => {
  if (!type || !type.includes('2')) {
    return 'auto'
  }

  const [sourceLanguage] = type.split('2')
  return mapYoudaoLanguage(sourceLanguage)
}

const isKeyValid = (key: YoudaoCachedKey | null) => {
  return Boolean(key && key.expiresAt > Date.now())
}

const fetchYoudaoKey = async (forceRefresh = false): Promise<YoudaoCachedKey> => {
  if (!forceRefresh && isKeyValid(cachedKey)) {
    return cachedKey as YoudaoCachedKey
  }

  if (!forceRefresh && pendingKeyPromise) {
    return pendingKeyPromise
  }

  pendingKeyPromise = (async () => {
    const timestamp = getMysticTime()
    const sign = buildSign(timestamp, YOUDAO_DEFAULT_SECRET)
    const query = new URLSearchParams({
      client: 'fanyideskweb',
      product: 'webfanyi',
      appVersion: '1.0.0',
      vendor: 'web',
      pointParam: 'client,mysticTime,product',
      keyfrom: 'fanyi.web',
      keyid: 'webfanyi-key-getter',
      sign,
      mysticTime: timestamp,
    })

    const response = await fetch(`${YOUDAO_TRANSLATE_BASE_URL}/webtranslate/key?${query.toString()}`, {
      headers: YOUDAO_HEADERS,
    })

    if (!response.ok) {
      throw new Error(`Youdao key request failed with status ${response.status}`)
    }

    const payload = (await response.json()) as YoudaoKeyPayload
    const secretKey = payload.data?.secretKey
    const aesKey = payload.data?.aesKey
    const aesIv = payload.data?.aesIv

    if (payload.code !== 0 || !secretKey || !aesKey || !aesIv) {
      throw new Error('Youdao key response is invalid')
    }

    const nextKey = {
      secretKey,
      aesKey,
      aesIv,
      expiresAt: Date.now() + YOUDAO_KEY_TTL_MS,
    }

    cachedKey = nextKey
    return nextKey
  })()

  try {
    return await pendingKeyPromise
  } finally {
    pendingKeyPromise = null
  }
}

const fetchYoudaoPayload = async (request: TranslationRequest, attempt = 0): Promise<YoudaoTranslatePayload> => {
  const key = await fetchYoudaoKey(attempt > 0)
  const timestamp = getMysticTime()
  const sign = buildSign(timestamp, key.secretKey)
  const body = new URLSearchParams({
    client: 'fanyideskweb',
    product: 'webfanyi',
    appVersion: '1.0.0',
    vendor: 'web',
    pointParam: 'client,mysticTime,product',
    keyfrom: 'fanyi.web',
    keyid: 'webfanyi',
    sign,
    mysticTime: timestamp,
    i: request.text,
    from: languageToYoudaoCode(request.sourceLanguage),
    to: languageToYoudaoCode(request.targetLanguage),
    dictResult: 'false',
  })

  const response = await fetch(`${YOUDAO_TRANSLATE_BASE_URL}/webtranslate`, {
    method: 'POST',
    headers: {
      ...YOUDAO_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`Youdao translate request failed with status ${response.status}`)
  }

  const encryptedText = await response.text()

  try {
    const decryptedText = decryptPayload(encryptedText, key.aesKey, key.aesIv)
    return JSON.parse(decryptedText) as YoudaoTranslatePayload
  } catch (error) {
    if (attempt < 1) {
      cachedKey = null
      return fetchYoudaoPayload(request, attempt + 1)
    }

    throw new Error(error instanceof Error ? error.message : 'Youdao translate response parse failed')
  }
}

export const youdaoProvider: TranslationProvider = {
  id: 'youdao',
  isConfigured() {
    return true
  },
  async detectLanguage(text) {
    const payload = await fetchYoudaoPayload({
      text,
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      engineId: 'youdao',
    })

    return parseDetectedLanguage(payload.type)
  },
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const payload = await fetchYoudaoPayload(request)

    if (payload.code !== 0) {
      throw new Error(`Youdao translate failed with code ${payload.code}`)
    }

    const translatedText = payload.translateResult
      .map((group) => group.map((item) => item.tgt ?? '').join(''))
      .join('\n')
      .trim()

    if (!translatedText) {
      throw new Error('Youdao translate returned an empty result')
    }

    return {
      engineId: 'youdao',
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      sourceText: trimTranslationText(request.text),
      translatedText,
      detectedSourceLanguage: parseDetectedLanguage(payload.type),
    }
  },
}
