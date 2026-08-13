import { Check, ChevronDown, CornerDownLeft, LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Select } from '@/app/components/ui/select'
import { Textarea } from '@/app/components/ui/textarea'
import { syncDocumentThemeWithSystemPreference } from '@/app/theme'
import type { InputTranslationWindowPreloadApi, InputTranslationWindowState } from '@/lib/input-translation/shared'
import { translationEngineLabels } from '@/lib/translation/shared'
import '@/app/components/input-translation/styles.css'

const TEXTAREA_MIN_HEIGHT = 46

const emptyState: InputTranslationWindowState = {
  status: 'idle',
  requestId: 0,
  value: '',
  sourceText: '',
  maxWindowHeight: 700,
  engineId: 'deepl',
  enabledEngineIds: ['deepl'],
  targetLanguage: 'en',
  languages: [],
  copied: false,
}

const missingApi: InputTranslationWindowPreloadApi = {
  onState: () => () => {},
  onFocus: () => () => {},
  async getState() {
    return null
  },
  async translate() {
    return { ok: false }
  },
  async updateOptions() {
    return { ok: false }
  },
  async copyDraft() {
    return { ok: false }
  },
  resizeWindow() {},
  moveWindow() {},
  async closeWindow() {
    return { ok: false }
  },
}

export function InputTranslationPanel() {
  const api = window.inputTranslationWindow ?? missingApi
  const panelRef = useRef<HTMLFormElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const compositionRef = useRef(false)
  const resizeFrameRef = useRef<number | null>(null)
  const dragRef = useRef<{ pointerId: number; screenX: number; screenY: number } | null>(null)
  const [state, setState] = useState(emptyState)
  const [value, setValue] = useState('')
  const [engineId, setEngineId] = useState<InputTranslationWindowState['engineId']>('deepl')
  const [targetLanguage, setTargetLanguage] = useState('en')
  const [isDragging, setIsDragging] = useState(false)

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      const length = inputRef.current?.value.length ?? 0
      inputRef.current?.setSelectionRange(length, length)
    })
  }, [])

  const resizeToContent = useCallback(() => {
    if (resizeFrameRef.current != null) {
      cancelAnimationFrame(resizeFrameRef.current)
    }

    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null
      const input = inputRef.current
      const panel = panelRef.current
      if (!input || !panel) {
        return
      }

      input.style.height = '0px'
      const maxInputHeight = Math.max(TEXTAREA_MIN_HEIGHT, state.maxWindowHeight - 56)
      const nextInputHeight = Math.max(TEXTAREA_MIN_HEIGHT, Math.min(input.scrollHeight, maxInputHeight))
      input.style.height = `${nextInputHeight}px`
      input.style.overflowY = input.scrollHeight > maxInputHeight ? 'auto' : 'hidden'
      api.resizeWindow(Math.ceil(panel.scrollHeight + 10))
    })
  }, [api, state.maxWindowHeight])

  useEffect(() => syncDocumentThemeWithSystemPreference(), [])

  useEffect(() => {
    const syncState = (nextState: InputTranslationWindowState) => {
      setState(nextState)
      setValue(nextState.value)
      setEngineId(nextState.engineId)
      setTargetLanguage(nextState.targetLanguage)
      focusInput()
    }

    const unsubscribeState = api.onState(syncState)
    const unsubscribeFocus = api.onFocus(focusInput)
    void api.getState().then((nextState) => {
      if (nextState) {
        syncState(nextState)
      }
    })

    return () => {
      unsubscribeState()
      unsubscribeFocus()
    }
  }, [api, focusInput])

  useEffect(() => {
    resizeToContent()
  }, [resizeToContent, state.status, state.errorMessage, value])

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current != null) {
        cancelAnimationFrame(resizeFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      void api.closeWindow()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [api])

  const submit = async () => {
    if (compositionRef.current || state.status === 'loading' || !value.trim()) {
      return
    }

    await api.translate({
      text: value,
      engineId,
      targetLanguage,
    })
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    void submit()
  }

  const handleValueChange = (nextValue: string) => {
    setValue(nextValue)
    if (state.status === 'success') {
      void api.copyDraft(nextValue)
    }
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || compositionRef.current) {
      return
    }

    event.preventDefault()
    void submit()
  }

  const handleEngineChange = (nextEngineId: InputTranslationWindowState['engineId']) => {
    setEngineId(nextEngineId)
    void api.updateOptions({
      engineId: nextEngineId,
      targetLanguage,
    })
  }

  const handleTargetLanguageChange = (nextTargetLanguage: string) => {
    setTargetLanguage(nextTargetLanguage)
    void api.updateOptions({
      engineId,
      targetLanguage: nextTargetLanguage,
    })
  }

  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return
    }

    dragRef.current = null
    setIsDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleToolbarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('select, button')) {
      return
    }

    event.preventDefault()
    dragRef.current = {
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY,
    }
    setIsDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleToolbarPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.screenX - drag.screenX
    const deltaY = event.screenY - drag.screenY
    if (!deltaX && !deltaY) {
      return
    }

    drag.screenX = event.screenX
    drag.screenY = event.screenY
    api.moveWindow(deltaX, deltaY)
  }

  const submitLabel =
    state.status === 'loading' ? '正在翻译' : state.status === 'success' && state.copied ? '已翻译并复制' : '回车翻译'

  return (
    <main className="input-translation-shell">
      <form ref={panelRef} className="input-translation-panel" data-status={state.status} onSubmit={handleSubmit}>
        <div className="input-translation-field">
          <Textarea
            ref={inputRef}
            value={value}
            rows={1}
            onChange={(event) => handleValueChange(event.target.value)}
            onKeyDown={handleInputKeyDown}
            onCompositionStart={() => {
              compositionRef.current = true
            }}
            onCompositionEnd={() => {
              compositionRef.current = false
            }}
            placeholder="输入中文，按回车翻译"
            aria-label="输入要翻译的内容"
            aria-invalid={state.status === 'error'}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="input-translation-submit"
            type="submit"
            disabled={!value.trim() || state.status === 'loading'}
            aria-label={submitLabel}
            title={submitLabel}
          >
            {state.status === 'loading' ? (
              <LoaderCircle className="input-translation-spinner" size={15} />
            ) : (
              <CornerDownLeft size={15} />
            )}
          </button>
        </div>

        <div
          className={`input-translation-toolbar${isDragging ? ' is-dragging' : ''}`}
          onPointerDown={handleToolbarPointerDown}
          onPointerMove={handleToolbarPointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
          onLostPointerCapture={stopDragging}
        >
          <label className="input-translation-compact-select engine-select">
            <span className="input-translation-select-label">翻译引擎：</span>
            <Select
              value={engineId}
              onChange={(event) => handleEngineChange(event.target.value as InputTranslationWindowState['engineId'])}
              disabled={state.status === 'loading'}
              aria-label="翻译引擎"
            >
              {state.enabledEngineIds.map((item) => (
                <option key={item} value={item}>
                  {translationEngineLabels[item]}
                </option>
              ))}
            </Select>
            <ChevronDown size={11} aria-hidden="true" />
          </label>

          <label className="input-translation-compact-select language-select">
            <span className="input-translation-select-label">目标语言：</span>
            <Select
              value={targetLanguage}
              onChange={(event) => handleTargetLanguageChange(event.target.value)}
              disabled={state.status === 'loading'}
              aria-label="目标语言"
            >
              {state.languages
                .filter((item) => item.code !== 'auto')
                .map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
            </Select>
            <ChevronDown size={11} aria-hidden="true" />
          </label>

          <span className={`input-translation-status status-${state.status}`} aria-live="polite">
            {state.status === 'loading' ? (
              '翻译中'
            ) : state.status === 'success' && state.copied ? (
              <>
                <Check size={11} aria-hidden="true" /> 已复制
              </>
            ) : state.status === 'error' ? (
              '翻译失败'
            ) : null}
          </span>

          <button
            className="input-translation-close"
            type="button"
            onClick={() => void api.closeWindow()}
            aria-label="关闭翻译输入框"
            title="关闭"
          >
            <X size={13} />
          </button>
        </div>

        <div className="input-translation-live" aria-live="polite">
          {state.status === 'error' ? state.errorMessage || '翻译失败' : submitLabel}
        </div>
      </form>
    </main>
  )
}
