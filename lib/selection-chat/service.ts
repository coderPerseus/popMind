import { randomUUID } from 'node:crypto'
import { createLanguageModel } from '@/lib/ai-service/provider-factory'
import { capabilityService } from '@/lib/capability/service'
import { translateMessage } from '@/lib/i18n/shared'
import { isAbortError, runExplain } from '@/lib/explain/runner'
import { mainLogger } from '@/lib/main/logger'
import { searchHistoryService } from '@/lib/search-history/service'
import type { ExplainHistoryMessage } from '@/lib/search-history/types'
import type { ExplainImageContext } from '@/lib/explain/types'
import type { SelectionChatMessage, SelectionChatSession } from './types'

const createMessage = (role: 'user' | 'assistant', text = ''): SelectionChatMessage => ({
  id: randomUUID(),
  role,
  text,
  createdAt: Date.now(),
})

export class SelectionChatService {
  private session: SelectionChatSession | null = null
  private currentAbortController: AbortController | null = null
  private listeners = new Set<(session: SelectionChatSession | null) => void>()
  private activeRunId = 0
  private sourceAppName: string | undefined
  private contextImage: ExplainImageContext | undefined

  subscribe(listener: (session: SelectionChatSession | null) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.session)
    }
  }

  private setMissingAiConfigState(
    input: { mode: 'explain' | 'ask'; selectionText: string; selectionId?: string; sourceAppId?: string },
    language: 'zh-CN' | 'en',
    webSearchEnabled = false
  ) {
    const selectionText = input.selectionText.trim()
    if (!selectionText) {
      this.session = null
      this.emit()
      return null
    }

    const messages = input.mode === 'explain' ? [createMessage('user', selectionText)] : []

    this.session = {
      id: randomUUID(),
      mode: input.mode,
      selectionId: input.selectionId,
      sourceAppId: input.sourceAppId,
      selectionText,
      messages,
      status: 'error',
      pinned: false,
      webSearchEnabled,
      language,
      errorMessage: translateMessage(language, 'selectionChat.error.missingAiConfig'),
    }
    this.emit()
    return this.session
  }

  getState() {
    return this.session
  }

  async openSession(input: {
    mode: 'explain' | 'ask'
    selectionText: string
    selectionId?: string
    sourceAppId?: string
    sourceAppName?: string
    contextImage?: ExplainImageContext
  }) {
    const runId = this.beginRun()
    this.sourceAppName = input.sourceAppName?.trim() || undefined
    this.contextImage = input.contextImage

    const settings = await capabilityService.getSettings()
    if (!this.isRunActive(runId)) {
      mainLogger.info('[SelectionChat] openSession skipped after cancel', { runId, activeRunId: this.activeRunId })
      return this.session
    }

    const model = createLanguageModel(settings)
    if (!model) {
      return this.setMissingAiConfigState(input, settings.appLanguage, settings.webSearch.enabled)
    }

    const selectionText = input.selectionText.trim()
    if (!selectionText) {
      this.session = null
      this.emit()
      return null
    }

    const messages = input.mode === 'explain' ? [createMessage('user', selectionText)] : []

    this.session = {
      id: randomUUID(),
      mode: input.mode,
      selectionId: input.selectionId,
      sourceAppId: input.sourceAppId,
      selectionText,
      messages,
      status: 'ready',
      pinned: false,
      webSearchEnabled: settings.webSearch.enabled,
      language: settings.appLanguage,
      aiProvider: model.providerId,
      modelId: model.modelId,
    }
    this.emit()
    mainLogger.info('[SelectionChat] session opened', {
      runId,
      sessionId: this.session.id,
      mode: input.mode,
      textLength: selectionText.length,
      webSearchEnabled: this.session.webSearchEnabled,
    })

    if (input.mode === 'explain') {
      await this.runAssistantTurn(runId)
    }

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
    mainLogger.info('[SelectionChat] submitMessage', {
      runId,
      sessionId: this.session.id,
      textLength: nextMessage.text.length,
    })
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
    mainLogger.info('[SelectionChat] regenerate', { runId, sessionId: this.session.id })
    await this.runAssistantTurn(runId)
  }

  async stop() {
    const sessionId = this.session?.id
    const previousStatus = this.session?.status
    this.cancelRun()
    this.applyStoppedState()
    mainLogger.warn('[SelectionChat] stop requested', {
      sessionId,
      previousStatus,
      activeRunId: this.activeRunId,
      lastTextLength: this.session?.messages.at(-1)?.text.length ?? 0,
    })
    await this.persistSession()
  }

  async close() {
    this.cancelRun()
    this.session = null
    this.sourceAppName = undefined
    this.contextImage = undefined
    this.emit()
    mainLogger.info('[SelectionChat] session closed')
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
  }

  private async runAssistantTurn(runId: number) {
    if (!this.session || !this.isRunActive(runId)) {
      return
    }

    const settings = await capabilityService.getSettings()
    if (!this.isRunActive(runId) || !this.session) {
      mainLogger.info('[SelectionChat] run skipped after cancel', { runId, activeRunId: this.activeRunId })
      return
    }

    const conversationMessages = this.session.messages
    const assistantMessage = createMessage('assistant', '')
    const abortController = new AbortController()

    try {
      const model = createLanguageModel(settings)
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
        webSearchProvider: undefined,
        messages: [...conversationMessages, assistantMessage],
        errorMessage: undefined,
      }
      this.emit()
      this.currentAbortController = abortController
      mainLogger.info('[SelectionChat] assistant turn started', {
        runId,
        sessionId: this.session.id,
        status: this.session.status,
        webSearchEnabled: this.session.webSearchEnabled,
      })

      const result = await runExplain({
        selectionText: this.session.selectionText,
        messages: conversationMessages.map((message) => ({
          role: message.role,
          text: message.text,
        })),
        webSearchEnabled: this.session.webSearchEnabled,
        sourceAppName: this.sourceAppName,
        contextImage: this.contextImage,
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

          const nextLastMessage: SelectionChatMessage = {
            ...lastMessage,
            text: fullText,
          }

          this.session = {
            ...this.session,
            messages: [...this.session.messages.slice(0, -1), nextLastMessage],
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
      mainLogger.info('[SelectionChat] assistant turn ready', {
        runId,
        sessionId: this.session.id,
        textLength: result.text.length,
        sourceCount: result.sources.length,
      })
      await this.persistSession()
    } catch (error) {
      if (!this.isRunActive(runId) || !this.session) {
        mainLogger.info('[SelectionChat] assistant turn ignored after cancel', {
          runId,
          activeRunId: this.activeRunId,
          reason: error instanceof Error ? error.message : String(error),
        })
        return
      }

      if (isAbortError(error) || abortController.signal.aborted) {
        this.applyStoppedState()
        mainLogger.warn('[SelectionChat] assistant turn aborted', {
          runId,
          sessionId: this.session?.id,
        })
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
      mainLogger.warn('[SelectionChat] assistant turn failed', {
        runId,
        sessionId: this.session.id,
        error: message,
      })
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

export const selectionChatService = new SelectionChatService()
