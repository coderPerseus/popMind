import { useCallback, useEffect, useRef, useState } from 'react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import type { MainSearchCommand } from '@/app/components/home/query-command'

export type TranslateCardState =
  | { status: 'idle' }
  | { status: 'loading'; query: string; trigger: string }
  | {
      status: 'success'
      query: string
      trigger: string
      translatedText: string
      sourceLanguage: string
      targetLanguage: string
      engineId: string
      detectedSourceLanguage?: string
    }
  | { status: 'error'; query: string; trigger: string; error: string }

export function useTranslateCommand(command: MainSearchCommand) {
  const translation = useConveyor('translation')
  const search = useConveyor('search')
  const [cardState, setCardState] = useState<TranslateCardState>({ status: 'idle' })
  const requestIdRef = useRef(0)
  const debounceTimerRef = useRef<number | null>(null)

  const isActive = command.kind === 'translate'

  const runTranslate = useCallback(
    async (trigger: string, text: string) => {
      const normalizedText = text.trim()
      if (!normalizedText) {
        setCardState({ status: 'idle' })
        return
      }

      const requestId = ++requestIdRef.current
      setCardState({ status: 'loading', query: normalizedText, trigger })

      try {
        const result = await translation.translate({ text: normalizedText })

        if (requestId !== requestIdRef.current) return

        setCardState({
          status: 'success',
          query: normalizedText,
          trigger,
          translatedText: result.translatedText,
          sourceLanguage: result.sourceLanguage,
          targetLanguage: result.targetLanguage,
          engineId: result.engineId,
          detectedSourceLanguage: result.detectedSourceLanguage,
        })

        void search
          .recordHistory({
            kind: 'command',
            query: `${trigger} ${normalizedText}`,
            actionId: 'command.translate',
            actionLabel: trigger,
            metadata: {
              resultText: result.translatedText,
              sourceLanguage: result.sourceLanguage,
              targetLanguage: result.targetLanguage,
              detectedSourceLanguage: result.detectedSourceLanguage,
              engineId: result.engineId,
            },
          })
          .catch(() => undefined)
      } catch (error) {
        if (requestId !== requestIdRef.current) return

        setCardState({
          status: 'error',
          query: normalizedText,
          trigger,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [search, translation],
  )

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

    if (command.kind !== 'translate' || !command.text) {
      requestIdRef.current += 1
      setCardState({ status: 'idle' })
      return
    }

    const { trigger, text } = command
    debounceTimerRef.current = window.setTimeout(() => {
      void runTranslate(trigger, text)
    }, 260)

    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [command, isActive, runTranslate])

  const runImmediately = () => {
    if (command.kind !== 'translate' || !command.text) return
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    void runTranslate(command.trigger, command.text)
  }

  return { isActive, cardState, runImmediately }
}
