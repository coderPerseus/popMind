import { useCallback, useEffect, useRef, useState } from 'react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import type { MainSearchCommand } from '@/app/components/home/query-command'
import { copyTextToClipboard } from '@/app/plugins/main-search'
import {
  getEnabledTranslationEngineIds,
  resolvePreferredTranslationEngine,
  translationLanguages,
} from '@/lib/translation/shared'
import type {
  TranslationEngineId,
  TranslationLanguageOption,
  TranslationQueryMode,
  TranslationSettings,
  TranslationWordEntry,
} from '@/lib/translation/types'

const DEFAULT_TARGET_LANGUAGE = 'zh-CN'
type TargetLanguageMode = 'auto' | 'manual'
const TRANSLATE_ENGINE_STORAGE_KEY = 'popmind.translate.preferred-engine'

const resolveDefaultTargetLanguage = (settings: TranslationSettings) =>
  settings.firstLanguage || DEFAULT_TARGET_LANGUAGE

const readStoredEngineId = (): TranslationEngineId | undefined => {
  try {
    const rawValue = window.localStorage.getItem(TRANSLATE_ENGINE_STORAGE_KEY)
    if (!rawValue) {
      return undefined
    }

    return rawValue as TranslationEngineId
  } catch {
    return undefined
  }
}

const writeStoredEngineId = (engineId: TranslationEngineId) => {
  try {
    window.localStorage.setItem(TRANSLATE_ENGINE_STORAGE_KEY, engineId)
  } catch {
    // Ignore persistence failures and keep runtime behavior intact.
  }
}

export type TranslateCardState =
  | { status: 'idle' }
  | {
      status: 'loading'
      query: string
      trigger: string
      sourceLanguage: string
      targetLanguage: string
    }
  | {
      status: 'success'
      query: string
      trigger: string
      translatedText: string
      queryMode: TranslationQueryMode
      sourceLanguage: string
      targetLanguage: string
      engineId: TranslationEngineId
      detectedSourceLanguage?: string
      wordEntry?: TranslationWordEntry
    }
  | {
      status: 'error'
      query: string
      trigger: string
      error: string
      sourceLanguage: string
      targetLanguage: string
    }

export function useTranslateCommand(command: MainSearchCommand) {
  const translation = useConveyor('translation')
  const search = useConveyor('search')
  const [cardState, setCardState] = useState<TranslateCardState>({ status: 'idle' })
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [targetLanguage, setTargetLanguage] = useState(DEFAULT_TARGET_LANGUAGE)
  const [targetLanguageMode, setTargetLanguageMode] = useState<TargetLanguageMode>('auto')
  const [engineId, setEngineId] = useState<TranslationEngineId>('google')
  const [enabledEngineIds, setEnabledEngineIds] = useState<TranslationEngineId[]>(['google'])
  const [copied, setCopied] = useState(false)
  const requestIdRef = useRef(0)
  const debounceTimerRef = useRef<number | null>(null)
  const defaultLanguagesRef = useRef({
    sourceLanguage: 'auto',
    targetLanguage: DEFAULT_TARGET_LANGUAGE,
    targetLanguageMode: 'auto' as TargetLanguageMode,
    engineId: 'google' as TranslationEngineId,
    enabledEngineIds: ['google'] as TranslationEngineId[],
  })

  const isActive = command.kind === 'translate'

  useEffect(() => {
    let mounted = true

    void translation
      .getSettings()
      .then((settings) => {
        if (!mounted) {
          return
        }

        const nextSourceLanguage = settings.defaultSourceLanguage || 'auto'
        const nextTargetLanguage = resolveDefaultTargetLanguage(settings)
        const nextEnabledEngineIds = getEnabledTranslationEngineIds(settings)
        const nextEngineId = resolvePreferredTranslationEngine(settings, readStoredEngineId()) ?? 'google'

        defaultLanguagesRef.current = {
          sourceLanguage: nextSourceLanguage,
          targetLanguage: nextTargetLanguage,
          targetLanguageMode: 'auto',
          engineId: nextEngineId,
          enabledEngineIds: nextEnabledEngineIds.length ? nextEnabledEngineIds : [nextEngineId],
        }
        setSourceLanguage((current) => (current === 'auto' ? nextSourceLanguage : current))
        setTargetLanguage((current) => (current === DEFAULT_TARGET_LANGUAGE ? nextTargetLanguage : current))
        setEngineId((current) => (current === 'google' ? nextEngineId : current))
        setEnabledEngineIds(nextEnabledEngineIds.length ? nextEnabledEngineIds : [nextEngineId])
      })
      .catch(() => undefined)

    return () => {
      mounted = false
    }
  }, [translation])

  const runTranslate = useCallback(
    async (
      trigger: string,
      text: string,
      options: {
        sourceLanguage: string
        targetLanguage: string
        targetLanguageMode: TargetLanguageMode
        engineId: TranslationEngineId
      }
    ) => {
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
        sourceLanguage: options.sourceLanguage,
        targetLanguage: options.targetLanguage,
      })

      try {
        const result = await translation.translate({
          text: normalizedText,
          sourceLanguage: options.sourceLanguage,
          targetLanguage:
            options.sourceLanguage === 'auto' && options.targetLanguageMode === 'auto'
              ? undefined
              : options.targetLanguage,
          engineId: options.engineId,
        })

        if (requestId !== requestIdRef.current) return

        if (options.targetLanguageMode === 'auto') {
          setTargetLanguage(result.targetLanguage)
        }

        if (result.queryMode !== 'word') {
          setEngineId(result.engineId)
        }
        setCardState({
          status: 'success',
          query: normalizedText,
          trigger,
          translatedText: result.translatedText,
          queryMode: result.queryMode,
          sourceLanguage: result.sourceLanguage,
          targetLanguage: result.targetLanguage,
          engineId: result.engineId,
          detectedSourceLanguage: result.detectedSourceLanguage,
          wordEntry: result.wordEntry,
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
          sourceLanguage: options.sourceLanguage,
          targetLanguage: options.targetLanguage,
        })
      }
    },
    [search, translation]
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

    if (command.kind !== 'translate' || !command.text) {
      requestIdRef.current += 1
      setCardState({ status: 'idle' })
      return
    }

    const { trigger, text } = command
    requestIdRef.current += 1
    setCopied(false)
    setCardState({
      status: 'loading',
      query: text.trim(),
      trigger,
      sourceLanguage,
      targetLanguage,
    })
    debounceTimerRef.current = window.setTimeout(() => {
      void runTranslate(trigger, text, { sourceLanguage, targetLanguage, targetLanguageMode, engineId })
    }, 260)

    return () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [command, engineId, isActive, runTranslate, sourceLanguage, targetLanguage, targetLanguageMode])

  const runImmediately = useCallback(() => {
    if (command.kind !== 'translate' || !command.text) return
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    void runTranslate(command.trigger, command.text, { sourceLanguage, targetLanguage, targetLanguageMode, engineId })
  }, [command, engineId, runTranslate, sourceLanguage, targetLanguage, targetLanguageMode])

  const handleSourceLanguageChange = useCallback(
    (value: string) => {
      setSourceLanguage(value)

      if (targetLanguageMode === 'auto' && value !== 'auto') {
        setTargetLanguage(defaultLanguagesRef.current.targetLanguage)
      }
    },
    [targetLanguageMode]
  )

  const handleTargetLanguageChange = useCallback((value: string) => {
    setTargetLanguageMode('manual')
    setTargetLanguage(value)
  }, [])

  const handleEngineChange = (value: TranslationEngineId) => {
    writeStoredEngineId(value)
    defaultLanguagesRef.current.engineId = value
    setEngineId(value)
  }

  const copyResult = useCallback(async () => {
    if (cardState.status !== 'success' || !cardState.translatedText) {
      return false
    }

    const didCopy = await copyTextToClipboard(cardState.translatedText)
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
    setSourceLanguage(defaultLanguagesRef.current.sourceLanguage)
    setTargetLanguage(defaultLanguagesRef.current.targetLanguage)
    setTargetLanguageMode(defaultLanguagesRef.current.targetLanguageMode)
    setEngineId(defaultLanguagesRef.current.engineId)
    setEnabledEngineIds(defaultLanguagesRef.current.enabledEngineIds)
    setCopied(false)
  }, [])

  return {
    isActive,
    cardState,
    runImmediately,
    reset,
    sourceLanguage,
    targetLanguage,
    engineId,
    enabledEngineIds,
    copied,
    setSourceLanguage: handleSourceLanguageChange,
    setTargetLanguage: handleTargetLanguageChange,
    setEngineId: handleEngineChange,
    copyResult,
    retranslate: runImmediately,
    languages: translationLanguages as TranslationLanguageOption[],
  }
}
