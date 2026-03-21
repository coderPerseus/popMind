import { smoothStream, streamText } from 'ai'
import { createLanguageModel, estimateMessageTokens } from '@/lib/ai-service/provider-factory'
import { capabilityService } from '@/lib/capability/service'
import { translateMessage } from '@/lib/i18n/shared'
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

export const runExplain = async ({
  selectionText,
  messages,
  signal,
  onChunk,
}: RunExplainInput): Promise<ExplainResult> => {
  const settings = await capabilityService.getSettings()
  const model = createLanguageModel(settings)
  if (!model) {
    throw new Error('No AI provider configured')
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

  const result = streamText({
    model: model.model,
    abortSignal: signal,
    experimental_transform: createSmoothTransform(settings.appLanguage),
    system: buildExplainSystemPrompt(settings.appLanguage),
    prompt: buildExplainPrompt({
      language: settings.appLanguage,
      selectionText,
      messages,
      searchResults,
    }),
  })

  let text = ''
  for await (const chunk of result.textStream) {
    text += chunk
    onChunk?.(chunk, text)
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
