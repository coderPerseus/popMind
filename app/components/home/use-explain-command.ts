import { useCallback, useEffect, useRef, useState } from 'react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import type { MainSearchCommand } from '@/app/components/home/query-command'
import { copyTextToClipboard } from '@/app/plugins/main-search'
import type { ExplainMessageSource } from '@/lib/search-history/types'

export type ExplainCardState =
  | { status: 'idle' }
  | {
      status: 'loading'
      query: string
      trigger: string
    }
  | {
      status: 'success'
      query: string
      trigger: string
      text: string
      language: 'zh-CN' | 'en'
      aiProvider: string
      modelId: string
      webSearchProvider?: string
      sources: ExplainMessageSource[]
    }
  | {
      status: 'error'
      query: string
      trigger: string
      error: string
    }

export function useExplainCommand(command: MainSearchCommand) {
  const explain = useConveyor('explain')
  const search = useConveyor('search')
  const [cardState, setCardState] = useState<ExplainCardState>({ status: 'idle' })
  const [copied, setCopied] = useState(false)
  const requestIdRef = useRef(0)
  const debounceTimerRef = useRef<number | null>(null)

  const isActive = command.kind === 'explain'

  const runExplain = useCallback(
    async (trigger: string, text: string) => {
      const normalizedText = text.trim()
      if (!normalizedText) {
        setCardState({ status: 'idle' })
        return
      }

      const requestId = ++requestIdRef.current
      setCopied(false)
      setCardState({
        status: 'loading',
        query: normalizedText,
        trigger,
      })

      try {
        const result = await explain.explain({ text: normalizedText })
        if (requestId !== requestIdRef.current) {
          return
        }

        setCardState({
          status: 'success',
          query: normalizedText,
          trigger,
          text: result.text,
          language: result.language,
          aiProvider: result.aiProvider,
          modelId: result.modelId,
          webSearchProvider: result.webSearchProvider,
          sources: result.sources,
        })

        void search
          .recordHistory({
            kind: 'command',
            query: `${trigger} ${normalizedText}`,
            actionId: 'command.explain',
            actionLabel: trigger,
            metadata: {
              resultText: result.text,
            },
          })
          .catch(() => undefined)
      } catch (error) {
        if (requestId !== requestIdRef.current) {
          return
        }

        setCardState({
          status: 'error',
          query: normalizedText,
          trigger,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [explain, search]
  )

  useEffect(() => {
    if (!copied) {
      return
    }

    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    if (!isActive) {
      requestIdRef.current += 1
      setCardState({ status: 'idle' })
      return
    }

    if (command.kind !== 'explain' || !command.text) {
      requestIdRef.current += 1
      setCardState({ status: 'idle' })
      return
    }

    requestIdRef.current += 1
    setCopied(false)
    setCardState({
      status: 'loading',
      query: command.text.trim(),
      trigger: command.trigger,
    })
    debounceTimerRef.current = window.setTimeout(() => {
      void runExplain(command.trigger, command.text)
    }, 260)

    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [command, isActive, runExplain])

  const runImmediately = useCallback(() => {
    if (command.kind !== 'explain' || !command.text) {
      return
    }

    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }

    void runExplain(command.trigger, command.text)
  }, [command, runExplain])

  const copyResult = useCallback(async () => {
    if (cardState.status !== 'success' || !cardState.text) {
      return false
    }

    const didCopy = await copyTextToClipboard(cardState.text)
    setCopied(didCopy)
    return didCopy
  }, [cardState])

  const reset = useCallback(() => {
    requestIdRef.current += 1
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    setCardState({ status: 'idle' })
    setCopied(false)
  }, [])

  return {
    isActive,
    cardState,
    copied,
    runImmediately,
    copyResult,
    reexplain: runImmediately,
    reset,
  }
}
