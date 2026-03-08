import { trimTranslationText } from '@/lib/translation/shared'
import type { TranslationProvider, TranslationRequest, TranslationResult } from '@/lib/translation/types'

const DEEPL_WEB_ENDPOINT = 'https://www2.deepl.com/jsonrpc'

interface DeepLWebTranslateText {
  text?: string
}

interface DeepLWebTranslateResult {
  lang?: string
  texts?: DeepLWebTranslateText[]
}

interface DeepLWebTranslateResponse {
  result?: DeepLWebTranslateResult
}

const languageToDeepLCode = (language: string) => {
  switch (language) {
    case 'auto':
      return 'auto'
    case 'zh-CN':
      return 'zh-Hans'
    case 'zh-TW':
      return 'zh-Hant'
    case 'en':
    case 'ja':
    case 'ko':
    case 'fr':
    case 'de':
    case 'es':
    case 'ru':
    case 'it':
      return language
    case 'pt':
      return 'pt-PT'
    default:
      return language
  }
}

const normalizeDeepLSourceCode = (language: string) => {
  return languageToDeepLCode(language).split('-')[0].toLowerCase()
}

const normalizeDeepLTargetCode = (language: string) => {
  const code = languageToDeepLCode(language)
  return code.split('-')[0].toLowerCase()
}

const mapDeepLDetectedLanguage = (language?: string) => {
  if (!language) {
    return 'auto'
  }

  switch (language.toLowerCase()) {
    case 'en':
      return 'en'
    case 'zh':
      return 'zh-CN'
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
      return language.toLowerCase()
  }
}

const getRequestId = () => {
  return Math.floor(Math.random() * (189998 - 100000 + 1) + 100000) * 1000
}

const getICount = (text: string) => {
  return text.split('i').length - 1
}

const getTimestamp = (iCount: number) => {
  const now = Date.now()
  if (iCount === 0) {
    return now
  }

  const count = iCount + 1
  return now - (now % count) + count
}

const buildPayload = (text: string, sourceLanguage: string, targetLanguage: string) => {
  const requestId = getRequestId()
  const iCount = getICount(text)
  const timestamp = getTimestamp(iCount)
  const regionalVariant = languageToDeepLCode(targetLanguage)
  const targetLanguageCode = normalizeDeepLTargetCode(targetLanguage)

  const params: Record<string, unknown> = {
    texts: [{ text, requestAlternatives: 3 }],
    splitting: 'newlines',
    lang: {
      source_lang_user_selected: normalizeDeepLSourceCode(sourceLanguage),
      target_lang: targetLanguageCode,
    },
    timestamp,
  }

  if (regionalVariant.toLowerCase() !== targetLanguageCode) {
    params.commonJobParams = {
      regionalVariant,
      mode: 'translate',
      browserType: 1,
      textType: 'plaintext',
    }
  }

  const payload = {
    jsonrpc: '2.0',
    method: 'LMT_handle_texts',
    id: requestId,
    params,
  }

  let body = JSON.stringify(payload)

  if ((requestId + 5) % 29 === 0 || (requestId + 3) % 13 === 0) {
    body = body.replace('"method":"', '"method" : "')
  } else {
    body = body.replace('"method":"', '"method": "')
  }

  return body
}

const fetchDeepLPayload = async (text: string, sourceLanguage: string, targetLanguage: string) => {
  const body = buildPayload(text, sourceLanguage, targetLanguage)
  const response = await fetch(DEEPL_WEB_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`DeepL translate request failed with status ${response.status}`)
  }

  return (await response.json()) as DeepLWebTranslateResponse
}

export const deeplProvider: TranslationProvider = {
  id: 'deepl',
  isConfigured() {
    return true
  },
  async detectLanguage(text) {
    const payload = await fetchDeepLPayload(text, 'auto', 'en')
    return mapDeepLDetectedLanguage(payload.result?.lang)
  },
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const payload = await fetchDeepLPayload(request.text, request.sourceLanguage, request.targetLanguage)
    const translatedText = payload.result?.texts?.[0]?.text?.trim()

    if (!translatedText) {
      throw new Error('DeepL translate returned an empty result')
    }

    return {
      engineId: 'deepl',
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      sourceText: trimTranslationText(request.text),
      translatedText,
      detectedSourceLanguage: mapDeepLDetectedLanguage(payload.result?.lang),
    }
  },
}
