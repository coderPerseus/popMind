import { smoothStream, streamText, type ModelMessage } from 'ai'
import { createLanguageModel, estimateMessageTokens } from '@/lib/ai-service/provider-factory'
import { capabilityService } from '@/lib/capability/service'
import { translateMessage } from '@/lib/i18n/shared'
import { mainLogger } from '@/lib/main/logger'
import { webSearchService } from '@/lib/web-search/service'
import {
  buildChatPrompt,
  buildChatSystemPrompt,
  buildExplainPrompt,
  buildExplainSystemPrompt,
} from '@/lib/selection-chat/prompt'
import type { ExplainResult, RunExplainInput } from './types'

const EXPLAIN_REQUEST_TIMEOUT_MS = 30_000
const SEARCH_REQUEST_TIMEOUT_MS = 12_000

export const isAbortError = (error: unknown) => {
  if (!error) {
    return false
  }

  if (error instanceof Error) {
    return error.name === 'AbortError' || /aborted|AbortError/i.test(error.message)
  }

  return typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError'
}

const createAbortError = (message = 'The operation was aborted.') => {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError()
  }
}

const createSmoothTransform = (language: ExplainResult['language']) => {
  const chunking = language === 'zh-CN' ? new Intl.Segmenter('zh', { granularity: 'word' }) : ('word' as const)

  return smoothStream({
    delayInMs: 18,
    chunking,
  })
}

const shouldRetryWithoutImage = (error: unknown, hasPartialText: boolean) => {
  if (hasPartialText) {
    return false
  }

  const message = error instanceof Error ? error.message : String(error)
  return /image|vision|multimodal|media type|unsupported/i.test(message)
}

const createTimedAbortSignal = (sourceSignal: AbortSignal | undefined, timeoutMs: number) => {
  const controller = new AbortController()
  let didTimeout = false
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const abortFromSource = () => {
    controller.abort(sourceSignal?.reason)
  }

  if (sourceSignal?.aborted) {
    abortFromSource()
  } else if (sourceSignal) {
    sourceSignal.addEventListener('abort', abortFromSource, { once: true })
  }

  timeoutId = setTimeout(() => {
    didTimeout = true
    controller.abort(new Error('Explain request timed out'))
  }, timeoutMs)

  return {
    signal: controller.signal,
    didTimeout: () => didTimeout,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      if (sourceSignal) {
        sourceSignal.removeEventListener('abort', abortFromSource)
      }
    },
  }
}

export const runExplain = async ({
  mode = 'explain',
  providerId,
  selectionText,
  messages,
  webSearchEnabled,
  sourceAppName,
  contextImage,
  signal,
  onChunk,
}: RunExplainInput): Promise<ExplainResult> => {
  const settings = await capabilityService.getSettings()
  const effectiveSettings =
    typeof webSearchEnabled === 'boolean'
      ? {
          ...settings,
          webSearch: {
            ...settings.webSearch,
            enabled: webSearchEnabled,
          },
        }
      : settings
  const model = createLanguageModel(effectiveSettings, providerId)
  if (!model) {
    throw new Error(translateMessage(effectiveSettings.appLanguage, 'selectionChat.error.missingAiConfig'))
  }

  const estimatedTokens = estimateMessageTokens([selectionText, ...messages.map((item) => item.text)])
  if (estimatedTokens > model.contextLimit) {
    throw new Error(translateMessage(effectiveSettings.appLanguage, 'selectionChat.error.contextLimit'))
  }

  const latestQuestion = messages.filter((message) => message.role === 'user').at(-1)?.text ?? selectionText
  let searchResults: Awaited<ReturnType<typeof webSearchService.search>>['results'] = []
  let webSearchProvider: ExplainResult['webSearchProvider']

  if (effectiveSettings.webSearch.enabled) {
    throwIfAborted(signal)
    const searchAbort = createTimedAbortSignal(signal, SEARCH_REQUEST_TIMEOUT_MS)
    try {
      const search = await webSearchService.search(
        effectiveSettings,
        `${selectionText}\n${latestQuestion}`,
        searchAbort.signal
      )
      searchResults = search.results
      webSearchProvider = search.providerId
    } catch (error) {
      if (signal?.aborted || (isAbortError(error) && !searchAbort.didTimeout())) {
        throw isAbortError(error) ? error : createAbortError()
      }

      mainLogger.warn('[ExplainRunner] search_failed', {
        reason: error instanceof Error ? error.message : String(error),
        timedOut: searchAbort.didTimeout(),
      })
      searchResults = []
    } finally {
      searchAbort.cleanup()
    }
  }

  throwIfAborted(signal)

  let text = ''
  const systemPrompt =
    mode === 'chat'
      ? buildChatSystemPrompt(effectiveSettings.appLanguage)
      : buildExplainSystemPrompt(effectiveSettings.appLanguage)
  const executeExplainRequest = async (includeImage: boolean) => {
    const timedAbort = createTimedAbortSignal(signal, EXPLAIN_REQUEST_TIMEOUT_MS)

    mainLogger.info('[ExplainRunner] request', {
      providerId: model.providerId,
      modelId: model.modelId,
      includeImage,
      imageBytes: includeImage ? (contextImage?.data.length ?? 0) : 0,
      mediaType: includeImage ? (contextImage?.mediaType ?? null) : null,
      timeoutMs: EXPLAIN_REQUEST_TIMEOUT_MS,
    })

    try {
      const result = streamText({
        model: model.model,
        abortSignal: timedAbort.signal,
        experimental_transform: createSmoothTransform(effectiveSettings.appLanguage),
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  mode === 'chat'
                    ? buildChatPrompt({
                        language: effectiveSettings.appLanguage,
                        selectionText,
                        messages,
                        searchResults,
                      })
                    : buildExplainPrompt({
                        language: effectiveSettings.appLanguage,
                        selectionText,
                        messages,
                        searchResults,
                        sourceAppName,
                        hasImageContext: includeImage,
                      }),
              },
              ...(includeImage && contextImage
                ? [
                    {
                      type: 'image' as const,
                      image: contextImage.data,
                      mediaType: contextImage.mediaType,
                    },
                  ]
                : []),
            ],
          },
        ] satisfies ModelMessage[],
      })

      for await (const chunk of result.textStream) {
        text += chunk
        onChunk?.(chunk, text)
      }
    } catch (error) {
      if (timedAbort.didTimeout()) {
        mainLogger.warn('[ExplainRunner] request_timeout', {
          providerId: model.providerId,
          modelId: model.modelId,
          includeImage,
          timeoutMs: EXPLAIN_REQUEST_TIMEOUT_MS,
          partialChars: text.length,
        })
        throw new Error(translateMessage(effectiveSettings.appLanguage, 'selectionChat.error.timeout'))
      }

      throw error
    } finally {
      timedAbort.cleanup()
    }

    mainLogger.info('[ExplainRunner] completed', {
      providerId: model.providerId,
      modelId: model.modelId,
      includeImage,
      outputChars: text.length,
    })
  }

  const includeImage = Boolean(contextImage && model.supportsImageInput)
  mainLogger.info('[ExplainRunner] start', {
    providerId: model.providerId,
    modelId: model.modelId,
    supportsImageInput: model.supportsImageInput,
    includeImage,
    imageBytes: contextImage?.data.length ?? 0,
    sourceAppName: sourceAppName ?? 'unknown',
    webSearchEnabled: effectiveSettings.webSearch.enabled,
  })

  try {
    await executeExplainRequest(includeImage)
  } catch (error) {
    mainLogger.warn('[ExplainRunner] request_failed', {
      providerId: model.providerId,
      modelId: model.modelId,
      includeImage,
      partialChars: text.length,
      reason: error instanceof Error ? error.message : String(error),
    })

    if (!includeImage || !shouldRetryWithoutImage(error, text.length > 0)) {
      throw error
    }

    mainLogger.warn('[ExplainRunner] retry_without_image', {
      providerId: model.providerId,
      modelId: model.modelId,
      reason: error instanceof Error ? error.message : String(error),
    })
    text = ''
    await executeExplainRequest(false)
  }

  return {
    text,
    language: effectiveSettings.appLanguage,
    aiProvider: model.providerId,
    modelId: model.modelId,
    webSearchProvider,
    sources: searchResults,
  }
}
