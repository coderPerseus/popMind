import { trimTranslationText } from '@/lib/translation/shared'
import type { TranslationProvider, TranslationRequest, TranslationResult } from '@/lib/translation/types'

interface GoogleTranslateSentence {
  trans?: string
}

interface GoogleTranslateResponse {
  src?: string
  sentences?: GoogleTranslateSentence[]
}

const GOOGLE_TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single'

const parseGoogleTranslatedText = (payload: GoogleTranslateResponse) => {
  return (payload.sentences ?? [])
    .map((sentence) => sentence.trans ?? '')
    .join('')
    .trim()
}

const fetchGooglePayload = async (text: string, sourceLanguage: string, targetLanguage: string) => {
  const query = new URLSearchParams({
    client: 'gtx',
    sl: sourceLanguage,
    tl: targetLanguage,
    dt: 't',
    dj: '1',
    ie: 'UTF-8',
    q: text,
  })

  const response = await fetch(`${GOOGLE_TRANSLATE_ENDPOINT}?${query.toString()}`, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    },
  })

  if (!response.ok) {
    throw new Error(`Google translate request failed with status ${response.status}`)
  }

  return (await response.json()) as GoogleTranslateResponse
}

export const googleProvider: TranslationProvider = {
  id: 'google',
  isConfigured() {
    return true
  },
  async detectLanguage(text) {
    const payload = await fetchGooglePayload(text, 'auto', 'en')
    return payload.src || 'auto'
  },
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const payload = await fetchGooglePayload(request.text, request.sourceLanguage, request.targetLanguage)
    const translatedText = parseGoogleTranslatedText(payload)

    if (!translatedText) {
      throw new Error('Google translate returned an empty result')
    }

    return {
      engineId: 'google',
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      sourceText: trimTranslationText(request.text),
      translatedText,
      detectedSourceLanguage: payload.src || request.sourceLanguage,
    }
  },
}
