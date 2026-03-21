import type { AppLanguage, AiProviderId, WebSearchProviderId } from '@/lib/capability/types'
import type { ExplainMessageSource } from '@/lib/search-history/types'

export type ExplainConversationMessage = {
  role: 'user' | 'assistant'
  text: string
}

export type ExplainInput = {
  text: string
}

export type ExplainResult = {
  text: string
  language: AppLanguage
  aiProvider: AiProviderId
  modelId: string
  webSearchProvider?: WebSearchProviderId
  sources: ExplainMessageSource[]
}

export type RunExplainInput = {
  selectionText: string
  messages: ExplainConversationMessage[]
  signal?: AbortSignal
  onChunk?: (chunk: string, fullText: string) => void
}
