import type { CapabilitySettings, SpeechServiceTestResult } from '@/lib/capability/types'
import { normalizeElevenLabsVoiceId } from '@/lib/speech-service/shared'

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io'
const TEST_TIMEOUT_MS = 12000

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

const getErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.replace(/\s+/g, ' ').trim()
  return normalized || 'Unknown error'
}

export const testSpeechService = async (settings: CapabilitySettings): Promise<SpeechServiceTestResult> => {
  const providerId = settings.speechService.activeProvider

  if (providerId === 'system') {
    return {
      ok: true,
      providerId,
      voiceId: null,
      modelId: null,
    }
  }

  if (providerId === 'openai') {
    const config = settings.speechService.providers.openai
    const apiKey = config.apiKey.trim()
    const voice = config.voice.trim() || 'alloy'
    const model = config.model.trim() || 'gpt-4o-mini-tts'

    if (!apiKey) {
      return {
        ok: false,
        providerId,
        voiceId: voice,
        modelId: model,
        errorCode: 'missing-config',
      }
    }

    try {
      const response = await withTimeout(
        fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            voice,
            input: 'Ping.',
            response_format: 'mp3',
          }),
        }),
        TEST_TIMEOUT_MS
      )

      if (!response.ok) {
        const body = await response.text()
        throw new Error(body || `HTTP ${response.status}`)
      }

      await response.arrayBuffer()

      return {
        ok: true,
        providerId,
        voiceId: voice,
        modelId: model,
      }
    } catch (error) {
      return {
        ok: false,
        providerId,
        voiceId: voice,
        modelId: model,
        errorCode: 'request-failed',
        errorMessage: getErrorMessage(error),
      }
    }
  }

  const config = settings.speechService.providers.elevenlabs
  const apiKey = config.apiKey.trim()
  const voiceId = normalizeElevenLabsVoiceId(config.voiceId)
  const modelId = config.modelId.trim() || 'eleven_multilingual_v2'

  if (!apiKey || !voiceId) {
    return {
      ok: false,
      providerId,
      voiceId: voiceId || null,
      modelId,
      errorCode: 'missing-config',
    }
  }

  try {
    const response = await withTimeout(
      fetch(`${ELEVENLABS_BASE_URL}/v1/voices/${encodeURIComponent(voiceId)}`, {
        headers: {
          'xi-api-key': apiKey,
        },
      }),
      TEST_TIMEOUT_MS
    )

    if (!response.ok) {
      const body = await response.text()
      throw new Error(body || `HTTP ${response.status}`)
    }

    return {
      ok: true,
      providerId,
      voiceId,
      modelId,
    }
  } catch (error) {
    return {
      ok: false,
      providerId,
      voiceId,
      modelId,
      errorCode: 'request-failed',
      errorMessage: getErrorMessage(error),
    }
  }
}
