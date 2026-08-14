import { randomUUID } from 'node:crypto'
import { createLanguageModel } from '@/lib/ai-service/provider-factory'
import { capabilityService } from '@/lib/capability/service'
import { translateMessage } from '@/lib/i18n/shared'
import { mainLogger } from '@/lib/main/logger'
import { searchHistoryService } from '@/lib/search-history/service'
import type { ExplainHistoryMessage } from '@/lib/search-history/types'
import { isAbortError, runExplain } from './runner'
import type { ExplainConversationMessage, ExplainSession, ExplainSessionMessage, ExplainSessionMode } from './types'
import type { AiProviderId } from '@/lib/capability/types'

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

  private setMissingAiConfigState(
    selectionText: string,
    language: 'zh-CN' | 'en',
    mode: ExplainSessionMode,
    providerId: AiProviderId | undefined,
    webSearchEnabled: boolean
  ) {
    const firstUserMessage = createMessage('user', selectionText.trim())
    if (!firstUserMessage.text) {
      this.session = null
      this.emit()
      return null
    }

    this.session = {
      id: randomUUID(),
      mode,
      providerId,
      selectionText: firstUserMessage.text,
      messages: [firstUserMessage],
      status: 'error',
      language,
      webSearchEnabled,
      errorMessage: translateMessage(language, 'selectionChat.error.missingAiConfig'),
    }
    this.emit()
    return this.session
  }

  async startSession(
    selectionText: string,
    mode: ExplainSessionMode = 'explain',
    providerId?: AiProviderId,
    webSearchEnabled?: boolean
  ) {
    const runId = this.beginRun()
    const settings = await capabilityService.getSettings()
    if (!this.isRunActive(runId)) {
      return this.session
    }

    const nextWebSearchEnabled = typeof webSearchEnabled === 'boolean' ? webSearchEnabled : settings.webSearch.enabled
    const model = createLanguageModel(settings, providerId)
    if (!model) {
      return this.setMissingAiConfigState(
        selectionText,
        settings.appLanguage,
        mode,
        providerId,
        nextWebSearchEnabled
      )
    }

    const firstUserMessage = createMessage('user', selectionText.trim())
    if (!firstUserMessage.text) {
      this.session = null
      this.emit()
      return null
    }

    this.session = {
      id: randomUUID(),
      mode,
      providerId: providerId ?? model.providerId,
      selectionText: firstUserMessage.text,
      messages: [firstUserMessage],
      status: 'ready',
      language: settings.appLanguage,
      aiProvider: model.providerId,
      modelId: model.modelId,
      webSearchEnabled: nextWebSearchEnabled,
    }
    this.emit()
    mainLogger.info('[MainExplain] session started', {
      sessionId: this.session.id,
      providerId: this.session.providerId,
      webSearchEnabled: this.session.webSearchEnabled,
    })
    await this.runAssistantTurn(runId)
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

    const runId = this.beginRun()
    this.session = {
      ...this.session,
      messages: [...this.session.messages, nextMessage],
      status: 'ready',
      errorMessage: undefined,
      loadingMessage: undefined,
    }
    this.emit()
    await this.runAssistantTurn(runId)
  }

  async regenerate() {
    if (!this.session) {
      return
    }

    const messages = [...this.session.messages]
    if (messages.at(-1)?.role === 'assistant') {
      messages.pop()
    }

    const runId = this.beginRun()
    this.session = {
      ...this.session,
      messages,
      status: 'ready',
      errorMessage: undefined,
      loadingMessage: undefined,
    }
    this.emit()
    await this.runAssistantTurn(runId)
  }

  async stop() {
    this.cancelRun()
    this.applyStoppedState()
    mainLogger.warn('[MainExplain] stop requested', {
      sessionId: this.session?.id,
      lastTextLength: this.session?.messages.at(-1)?.text.length ?? 0,
    })
    await this.persistSession()
  }

  async reset() {
    this.cancelRun()
    this.session = null
    this.emit()
  }

  setWebSearchEnabled(enabled: boolean) {
    if (!this.session) {
      return
    }

    this.session = {
      ...this.session,
      webSearchEnabled: enabled,
      webSearchProvider: enabled ? this.session.webSearchProvider : undefined,
    }
    this.emit()
    mainLogger.info('[MainExplain] web search toggled', {
      sessionId: this.session.id,
      enabled,
    })
  }

  async setProvider(providerId: AiProviderId) {
    if (!this.session) {
      return
    }

    const settings = await capabilityService.getSettings()
    const model = createLanguageModel(settings, providerId)
    this.session = {
      ...this.session,
      providerId,
      aiProvider: model?.providerId ?? providerId,
      modelId: model?.modelId,
      errorMessage: model ? undefined : translateMessage(settings.appLanguage, 'selectionChat.error.missingAiConfig'),
      status: model ? this.session.status : 'error',
    }
    this.emit()
    mainLogger.info('[MainExplain] provider changed', {
      sessionId: this.session.id,
      providerId,
      modelId: this.session.modelId,
    })

    if (model) {
      await this.regenerate()
    }
  }

  private async runAssistantTurn(runId: number) {
    if (!this.session || !this.isRunActive(runId)) {
      return
    }

    const settings = await capabilityService.getSettings()
    if (!this.isRunActive(runId) || !this.session) {
      return
    }

    const conversationMessages = this.session.messages
    const assistantMessage = createMessage('assistant', '')
    const abortController = new AbortController()

    try {
      const model = createLanguageModel(settings, this.session.providerId)
      if (!model) {
        throw new Error(translateMessage(settings.appLanguage, 'selectionChat.error.missingAiConfig'))
      }

      this.session = {
        ...this.session,
        status: this.session.webSearchEnabled ? 'searching' : 'streaming',
        loadingMessage: translateMessage(
          settings.appLanguage,
          this.session.webSearchEnabled ? 'selectionChat.searching' : 'selectionChat.loading'
        ),
        aiProvider: model.providerId,
        modelId: model.modelId,
        messages: [...conversationMessages, assistantMessage],
        errorMessage: undefined,
      }
      this.emit()
      this.currentAbortController = abortController

      const result = await runExplain({
        mode: this.session.mode,
        providerId: this.session.providerId,
        selectionText: this.session.selectionText,
        messages: conversationMessages.map((message) => ({
          role: message.role,
          text: message.text,
        })) as ExplainConversationMessage[],
        webSearchEnabled: this.session.webSearchEnabled,
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

      if (isAbortError(error) || abortController.signal.aborted) {
        this.applyStoppedState()
        await this.persistSession()
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

  private beginRun() {
    this.currentAbortController?.abort()
    this.currentAbortController = null
    this.activeRunId += 1
    return this.activeRunId
  }

  private cancelRun() {
    this.activeRunId += 1
    this.currentAbortController?.abort()
    this.currentAbortController = null
  }

  private applyStoppedState() {
    if (!this.session) {
      return
    }

    this.session = {
      ...this.session,
      status: 'ready',
      loadingMessage: undefined,
      errorMessage: undefined,
    }
    this.emit()
  }

  private isRunActive(runId: number) {
    return this.activeRunId === runId
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
