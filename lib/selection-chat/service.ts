import { randomUUID } from 'node:crypto'
import { smoothStream, streamText } from 'ai'
import { createLanguageModel, estimateMessageTokens } from '@/lib/ai-service/provider-factory'
import type { AppLanguage } from '@/lib/capability/types'
import { capabilityService } from '@/lib/capability/service'
import { translateMessage } from '@/lib/i18n/shared'
import { searchHistoryService } from '@/lib/search-history/service'
import type { ExplainHistoryMessage } from '@/lib/search-history/types'
import { webSearchService } from '@/lib/web-search/service'
import { buildExplainPrompt, buildExplainSystemPrompt } from './prompt'
import type { SelectionChatMessage, SelectionChatSession } from './types'

const createMessage = (role: 'user' | 'assistant', text = ''): SelectionChatMessage => ({
  id: randomUUID(),
  role,
  text,
  createdAt: Date.now(),
})

const createSmoothTransform = (language: AppLanguage) => {
  const chunking =
    language === 'zh-CN' ? new Intl.Segmenter('zh', { granularity: 'word' }) : ('word' as const)

  return smoothStream({
    delayInMs: 18,
    chunking,
  })
}

export class SelectionChatService {
  private session: SelectionChatSession | null = null
  private currentAbortController: AbortController | null = null
  private listeners = new Set<(session: SelectionChatSession | null) => void>()
  private activeRunId = 0

  subscribe(listener: (session: SelectionChatSession | null) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.session)
    }
  }

  getState() {
    return this.session
  }

  async openSession(input: { selectionText: string; selectionId?: string; sourceAppId?: string }) {
    const settings = await capabilityService.getSettings()
    const model = createLanguageModel(settings)
    if (!model) {
      return null
    }

    const firstUserMessage = createMessage('user', input.selectionText)
    this.session = {
      id: randomUUID(),
      selectionId: input.selectionId,
      sourceAppId: input.sourceAppId,
      selectionText: input.selectionText,
      messages: [firstUserMessage],
      status: 'ready',
      pinned: false,
      language: settings.appLanguage,
      aiProvider: model.providerId,
      modelId: model.modelId,
    }
    this.emit()
    await this.runAssistantTurn()
    return this.session
  }

  async submitMessage(text: string) {
    if (!this.session) {
      return
    }

    const nextMessage = createMessage('user', text.trim())
    if (!nextMessage.text) {
      return
    }

    this.session = {
      ...this.session,
      messages: [...this.session.messages, nextMessage],
      status: 'ready',
      errorMessage: undefined,
    }
    this.emit()
    await this.runAssistantTurn()
  }

  async regenerate() {
    if (!this.session) {
      return
    }

    const messages = [...this.session.messages]
    if (messages.at(-1)?.role === 'assistant') {
      messages.pop()
    }

    this.session = {
      ...this.session,
      messages,
      status: 'ready',
      errorMessage: undefined,
      loadingMessage: undefined,
    }
    this.emit()
    await this.runAssistantTurn()
  }

  async stop() {
    this.activeRunId += 1
    this.currentAbortController?.abort()
    this.currentAbortController = null

    if (this.session) {
      this.session = {
        ...this.session,
        status: 'ready',
        loadingMessage: undefined,
      }
      await this.persistSession()
      this.emit()
    }
  }

  async close() {
    this.activeRunId += 1
    this.currentAbortController?.abort()
    this.currentAbortController = null
    this.session = null
    this.emit()
  }

  setPinned(pinned: boolean) {
    if (!this.session) {
      return
    }

    this.session = {
      ...this.session,
      pinned,
    }
    this.emit()
  }

  private async runAssistantTurn() {
    if (!this.session) {
      return
    }

    const runId = ++this.activeRunId
    const settings = await capabilityService.getSettings()
    if (!this.isRunActive(runId)) {
      return
    }

    const model = createLanguageModel(settings)
    if (!model) {
      throw new Error('No AI provider configured')
    }

    const latestQuestion =
      this.session.messages
        .filter((message) => message.role === 'user')
        .at(-1)?.text ?? this.session.selectionText
    const estimatedTokens = estimateMessageTokens(this.session.messages.map((item) => item.text))

    if (estimatedTokens > model.contextLimit) {
      this.session = {
        ...this.session,
        status: 'error',
        errorMessage: translateMessage(settings.appLanguage, 'selectionChat.error.contextLimit'),
      }
      this.emit()
      await this.persistSession()
      return
    }

    const conversationMessages = this.session.messages
    const assistantMessage = createMessage('assistant', '')
    let webSearchProvider = this.session.webSearchProvider
    let searchResults: Awaited<ReturnType<typeof webSearchService.search>>['results'] = []

    this.session = {
      ...this.session,
      status: settings.webSearch.enabled ? 'searching' : 'streaming',
      loadingMessage: translateMessage(
        settings.appLanguage,
        settings.webSearch.enabled ? 'selectionChat.searching' : 'selectionChat.loading',
      ),
      aiProvider: model.providerId,
      modelId: model.modelId,
      messages: [...conversationMessages, assistantMessage],
      errorMessage: undefined,
    }
    this.emit()

    if (settings.webSearch.enabled) {
      try {
        const search = await webSearchService.search(settings, `${this.session.selectionText}\n${latestQuestion}`)
        if (!this.isRunActive(runId)) {
          return
        }

        searchResults = search.results
        webSearchProvider = search.providerId
      } catch {
        if (!this.isRunActive(runId)) {
          return
        }

        searchResults = []
      }

      if (!this.session) {
        return
      }

      this.session = {
        ...this.session,
        status: 'streaming',
        loadingMessage: translateMessage(settings.appLanguage, 'selectionChat.loading'),
        webSearchProvider,
      }
      this.emit()
    }

    const abortController = new AbortController()
    this.currentAbortController = abortController

    try {
      const result = streamText({
        model: model.model,
        abortSignal: abortController.signal,
        experimental_transform: createSmoothTransform(settings.appLanguage),
        system: buildExplainSystemPrompt(settings.appLanguage),
        prompt: buildExplainPrompt({
          language: settings.appLanguage,
          selectionText: this.session.selectionText,
          messages: conversationMessages,
          searchResults,
        }),
      })

      for await (const chunk of result.textStream) {
        if (!this.isRunActive(runId) || !this.session) {
          return
        }

        const lastMessage = this.session.messages.at(-1)
        if (!lastMessage || lastMessage.id !== assistantMessage.id) {
          continue
        }

        const nextLastMessage: SelectionChatMessage = {
          ...lastMessage,
          text: `${lastMessage.text}${chunk}`,
          sources: searchResults.length ? searchResults : undefined,
        }

        this.session = {
          ...this.session,
          messages: [...this.session.messages.slice(0, -1), nextLastMessage],
        }
        this.emit()
      }

      if (!this.isRunActive(runId) || !this.session) {
        return
      }

      this.session = {
        ...this.session,
        status: 'ready',
        loadingMessage: undefined,
      }
      this.emit()
      await this.persistSession()
    } catch (error) {
      if (!this.isRunActive(runId) || !this.session) {
        return
      }

      const message = error instanceof Error ? error.message : translateMessage(settings.appLanguage, 'selectionChat.error.generic')
      const lastMessage = this.session.messages.at(-1)
      const nextLastMessage =
        lastMessage?.id === assistantMessage.id
          ? {
              ...lastMessage,
              errorMessage: message,
            }
          : undefined

      this.session = {
        ...this.session,
        status: 'error',
        loadingMessage: undefined,
        errorMessage: message,
        messages: nextLastMessage ? [...this.session.messages.slice(0, -1), nextLastMessage] : this.session.messages,
      }
      this.emit()
      await this.persistSession()
    } finally {
      if (this.currentAbortController === abortController) {
        this.currentAbortController = null
      }
    }
  }

  private isRunActive(runId: number) {
    return this.activeRunId === runId && this.session != null
  }

  private async persistSession() {
    if (!this.session || this.session.messages.length === 0) {
      return
    }

    const messages: ExplainHistoryMessage[] = this.session.messages.map((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
      sources: message.sources,
      errorMessage: message.errorMessage,
    }))

    await searchHistoryService.recordExplain({
      id: this.session.id,
      selectionText: this.session.selectionText,
      messages,
      aiProvider: this.session.aiProvider ?? 'unknown',
      webSearchProvider: this.session.webSearchProvider,
      language: this.session.language,
    })
  }
}

export const selectionChatService = new SelectionChatService()
