import { randomUUID } from 'node:crypto'
import { createLanguageModel } from '@/lib/ai-service/provider-factory'
import { capabilityService } from '@/lib/capability/service'
import { translateMessage } from '@/lib/i18n/shared'
import { searchHistoryService } from '@/lib/search-history/service'
import type { ExplainHistoryMessage } from '@/lib/search-history/types'
import { runExplain } from './runner'
import type { ExplainConversationMessage, ExplainSession, ExplainSessionMessage } from './types'

const createMessage = (role: 'user' | 'assistant', text = ''): ExplainSessionMessage => ({
  id: randomUUID(),
  role,
  text,
  createdAt: Date.now(),
})

export class MainExplainSessionService {
  private session: ExplainSession | null = null
  private currentAbortController: AbortController | null = null
  private listeners = new Set<(session: ExplainSession | null) => void>()
  private activeRunId = 0

  subscribe(listener: (session: ExplainSession | null) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState() {
    return this.session
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.session)
    }
  }

  private setMissingAiConfigState(selectionText: string, language: 'zh-CN' | 'en') {
    const firstUserMessage = createMessage('user', selectionText.trim())
    if (!firstUserMessage.text) {
      this.session = null
      this.emit()
      return null
    }

    this.session = {
      id: randomUUID(),
      selectionText: firstUserMessage.text,
      messages: [firstUserMessage],
      status: 'error',
      language,
      errorMessage: translateMessage(language, 'selectionChat.error.missingAiConfig'),
    }
    this.emit()
    return this.session
  }

  async startSession(selectionText: string) {
    const settings = await capabilityService.getSettings()
    const model = createLanguageModel(settings)
    if (!model) {
      return this.setMissingAiConfigState(selectionText, settings.appLanguage)
    }

    const firstUserMessage = createMessage('user', selectionText.trim())
    if (!firstUserMessage.text) {
      this.session = null
      this.emit()
      return null
    }

    this.session = {
      id: randomUUID(),
      selectionText: firstUserMessage.text,
      messages: [firstUserMessage],
      status: 'ready',
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

  async reset() {
    this.activeRunId += 1
    this.currentAbortController?.abort()
    this.currentAbortController = null
    this.session = null
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
      throw new Error(translateMessage(settings.appLanguage, 'selectionChat.error.missingAiConfig'))
    }

    const conversationMessages = this.session.messages
    const assistantMessage = createMessage('assistant', '')

    this.session = {
      ...this.session,
      status: settings.webSearch.enabled ? 'searching' : 'streaming',
      loadingMessage: translateMessage(
        settings.appLanguage,
        settings.webSearch.enabled ? 'selectionChat.searching' : 'selectionChat.loading'
      ),
      aiProvider: model.providerId,
      modelId: model.modelId,
      messages: [...conversationMessages, assistantMessage],
      errorMessage: undefined,
    }
    this.emit()

    const abortController = new AbortController()
    this.currentAbortController = abortController

    try {
      const result = await runExplain({
        selectionText: this.session.selectionText,
        messages: conversationMessages.map((message) => ({
          role: message.role,
          text: message.text,
        })) as ExplainConversationMessage[],
        signal: abortController.signal,
        onChunk: (_chunk, fullText) => {
          if (!this.isRunActive(runId) || !this.session) {
            return
          }

          if (this.session.status === 'searching') {
            this.session = {
              ...this.session,
              status: 'streaming',
              loadingMessage: translateMessage(settings.appLanguage, 'selectionChat.loading'),
            }
          }

          const lastMessage = this.session.messages.at(-1)
          if (!lastMessage || lastMessage.id !== assistantMessage.id) {
            return
          }

          this.session = {
            ...this.session,
            messages: [
              ...this.session.messages.slice(0, -1),
              {
                ...lastMessage,
                text: fullText,
              },
            ],
          }
          this.emit()
        },
      })

      if (!this.isRunActive(runId) || !this.session) {
        return
      }

      this.session = {
        ...this.session,
        status: 'ready',
        loadingMessage: undefined,
        aiProvider: result.aiProvider,
        modelId: result.modelId,
        webSearchProvider: result.webSearchProvider,
        messages: [
          ...this.session.messages.slice(0, -1),
          {
            ...assistantMessage,
            text: result.text,
            sources: result.sources.length ? result.sources : undefined,
          },
        ],
      }
      this.emit()
      await this.persistSession()
    } catch (error) {
      if (!this.isRunActive(runId) || !this.session) {
        return
      }

      const message =
        error instanceof Error ? error.message : translateMessage(settings.appLanguage, 'selectionChat.error.generic')
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

export const mainExplainSessionService = new MainExplainSessionService()
