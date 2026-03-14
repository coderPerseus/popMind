import type { AppLanguage, AiProviderId, WebSearchProviderId } from '@/lib/capability/types'
import type { ExplainMessageSource } from '@/lib/search-history/types'

export interface SelectionChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  sources?: ExplainMessageSource[]
  errorMessage?: string
}

export interface SelectionChatSession {
  id: string
  selectionId?: string
  sourceAppId?: string
  selectionText: string
  messages: SelectionChatMessage[]
  status: 'idle' | 'searching' | 'streaming' | 'ready' | 'error'
  pinned: boolean
  language: AppLanguage
  aiProvider?: AiProviderId
  webSearchProvider?: WebSearchProviderId
  errorMessage?: string
  loadingMessage?: string
  modelId?: string
}

export interface SelectionChatWindowState {
  session: SelectionChatSession | null
}

export interface SelectionChatWindowPreloadApi {
  onState(handler: (state: SelectionChatWindowState) => void): () => void
  getState(): Promise<SelectionChatWindowState>
  submitMessage(message: string): Promise<{ ok: boolean }>
  stop(): Promise<{ ok: boolean }>
  setPinned(pinned: boolean): Promise<{ ok: boolean; pinned: boolean }>
  closeWindow(): Promise<{ ok: boolean }>
  copyMessage(messageId: string): Promise<{ ok: boolean }>
  dismissTopmost(): Promise<{ ok: boolean }>
  notifyInteraction(durationMs?: number): void
  moveWindow(deltaX: number, deltaY: number): void
}
