import { smoothStream, streamText, type ModelMessage } from 'ai'
import { createLanguageModel, estimateMessageTokens } from '@/lib/ai-service/provider-factory'
import { capabilityService } from '@/lib/capability/service'
import { translateMessage } from '@/lib/i18n/shared'
import { mainLogger } from '@/lib/main/logger'
import { webSearchService } from '@/lib/web-search/service'
import { buildExplainPrompt, buildExplainSystemPrompt } from '@/lib/selection-chat/prompt'
import type { ExplainResult, RunExplainInput } from './types'

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

export const runExplain = async ({
  selectionText,
  messages,
  sourceAppName,
  contextImage,
  signal,
  onChunk,
}: RunExplainInput): Promise<ExplainResult> => {
  const settings = await capabilityService.getSettings()
  const model = createLanguageModel(settings)
  if (!model) {
    throw new Error(translateMessage(settings.appLanguage, 'selectionChat.error.missingAiConfig'))
  }

  const estimatedTokens = estimateMessageTokens([selectionText, ...messages.map((item) => item.text)])
  if (estimatedTokens > model.contextLimit) {
    throw new Error(translateMessage(settings.appLanguage, 'selectionChat.error.contextLimit'))
  }

  const latestQuestion = messages.filter((message) => message.role === 'user').at(-1)?.text ?? selectionText
  let searchResults: Awaited<ReturnType<typeof webSearchService.search>>['results'] = []
  let webSearchProvider: ExplainResult['webSearchProvider']

  if (settings.webSearch.enabled) {
    try {
      const search = await webSearchService.search(settings, `${selectionText}\n${latestQuestion}`)
      searchResults = search.results
      webSearchProvider = search.providerId
    } catch {
      searchResults = []
    }
  }

  let text = ''
  const executeExplainRequest = async (includeImage: boolean) => {
    const result = streamText({
      model: model.model,
      abortSignal: signal,
      experimental_transform: createSmoothTransform(settings.appLanguage),
      system: buildExplainSystemPrompt(settings.appLanguage),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildExplainPrompt({
                language: settings.appLanguage,
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
  }

  const includeImage = Boolean(contextImage && model.supportsImageInput)
  mainLogger.info('[ExplainRunner] start', {
    providerId: model.providerId,
    modelId: model.modelId,
    supportsImageInput: model.supportsImageInput,
    includeImage,
    imageBytes: contextImage?.data.length ?? 0,
    sourceAppName: sourceAppName ?? 'unknown',
    webSearchEnabled: settings.webSearch.enabled,
  })

  try {
    await executeExplainRequest(includeImage)
  } catch (error) {
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
    language: settings.appLanguage,
    aiProvider: model.providerId,
    modelId: model.modelId,
    webSearchProvider,
    sources: searchResults,
  }
}
