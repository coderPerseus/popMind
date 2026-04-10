import type { AppLanguage, AiProviderId, WebSearchProviderId } from '@/lib/capability/types'
import type { ExplainMessageSource } from '@/lib/search-history/types'

export type ExplainConversationMessage = {
  role: 'user' | 'assistant'
  text: string
}

export type ExplainSessionMode = 'explain' | 'chat'

export type ExplainImageContext = {
  data: Buffer
  mediaType: string
}

export type ExplainInput = {
  selectionText: string
  messages: ExplainConversationMessage[]
  sourceAppName?: string
  contextImage?: ExplainImageContext
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
  mode?: ExplainSessionMode
  providerId?: AiProviderId
  selectionText: string
  messages: ExplainConversationMessage[]
  sourceAppName?: string
  contextImage?: ExplainImageContext
  signal?: AbortSignal
  onChunk?: (chunk: string, fullText: string) => void
}

export interface ExplainSessionMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  sources?: ExplainMessageSource[]
  errorMessage?: string
}

export interface ExplainSession {
  id: string
  mode: ExplainSessionMode
  providerId?: AiProviderId
  selectionText: string
  messages: ExplainSessionMessage[]
  status: 'idle' | 'searching' | 'streaming' | 'ready' | 'error'
  language: AppLanguage
  aiProvider?: AiProviderId
  webSearchProvider?: WebSearchProviderId
  errorMessage?: string
  loadingMessage?: string
  modelId?: string
}

export interface MainExplainState {
  session: ExplainSession | null
}
