import { generateText } from 'ai'
import { createLanguageModel } from './provider-factory'
import type { AiServiceTestResult, CapabilitySettings } from '@/lib/capability/types'

const TEST_TIMEOUT_MS = 12000

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

export const testAiService = async (settings: CapabilitySettings): Promise<AiServiceTestResult> => {
  const model = createLanguageModel(settings)

  if (!model) {
    return {
      ok: false,
      providerId: settings.aiService.activeProvider,
      modelId: null,
      errorCode: 'missing-config',
    }
  }

  try {
    await withTimeout(
      generateText({
        model: model.model,
        temperature: 0,
        prompt: 'Reply with exactly OK.',
      }),
      TEST_TIMEOUT_MS
    )

    return {
      ok: true,
      providerId: model.providerId,
      modelId: model.modelId,
    }
  } catch (error) {
    return {
      ok: false,
      providerId: model.providerId,
      modelId: model.modelId,
      errorCode: 'request-failed',
      errorMessage: getErrorMessage(error),
    }
  }
}
