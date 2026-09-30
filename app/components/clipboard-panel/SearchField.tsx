import { useEffect, useState, type RefObject } from 'react'
import { AppWindow, CalendarDays, Pin, Plus, Search, X } from 'lucide-react'
import type { ClipKind, ClipQueryToken } from '@/lib/clipboard/types'
import { KindIcon } from '@/app/components/clipboard-panel/panel-parts'
import type { PanelTranslate } from '@/app/components/clipboard-panel/panel-utils'

export type UiFilterChip = {
  key: string
  kind: ClipQueryToken['kind']
  value: string
  label: string
  onRemove: () => void
}

function ChipIcon({ kind, value }: { kind: ClipQueryToken['kind']; value: string }) {
  if (kind === 'type') {
    return <KindIcon kind={value as ClipKind} />
  }

  if (kind === 'date') {
    return <CalendarDays />
  }

  if (kind === 'pinboard') {
    return <Pin />
  }

  return <AppWindow />
}

export function SearchField({
  inputRef,
  text,
  placeholders,
  resetKey,
  tokens,
  suggestions,
  uiChips,
  t,
  onTextChange,
  onCompositionChange,
  onRemoveToken,
  onAcceptSuggestion,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  text: string
  /** Hints shown one after another (every ~3 s) while the input is empty; the first one is the plain prompt. */
  placeholders: string[]
  /** Changes when the panel is shown again: start from the first hint. */
  resetKey: number
  tokens: ClipQueryToken[]
  suggestions: ClipQueryToken[]
  uiChips: UiFilterChip[]
  t: PanelTranslate
  onTextChange: (value: string) => void
  onCompositionChange: (composing: boolean) => void
  onRemoveToken: (token: ClipQueryToken) => void
  onAcceptSuggestion: (token: ClipQueryToken) => void
}) {
  const [hintIndex, setHintIndex] = useState(0)
  const [composing, setComposing] = useState(false)
  const showHint = !text && !composing && tokens.length + uiChips.length === 0
  const rotating = showHint && placeholders.length > 1

  useEffect(() => setHintIndex(0), [resetKey])

  useEffect(() => {
    if (!rotating) {
      return
    }

    const timer = window.setInterval(() => setHintIndex((index) => index + 1), 3000)
    return () => window.clearInterval(timer)
  }, [rotating, placeholders.length])

  const hint = placeholders[hintIndex % Math.max(1, placeholders.length)] ?? ''

  return (
    <div className="cp-search" onMouseDown={(event) => event.target === event.currentTarget && event.preventDefault()}>
      <Search className="cp-search-icon" />
      <div className="cp-search-chips">
        {uiChips.map((chip) => (
          <span key={chip.key} className="cp-chip">
            <ChipIcon kind={chip.kind} value={chip.value} />
            <span className="cp-chip-label">{chip.label}</span>
            <button
              type="button"
              className="cp-chip-remove"
              aria-label={t('clip.panel.search.removeFilter')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={chip.onRemove}
            >
              <X />
            </button>
          </span>
        ))}
        {tokens.map((token) => (
          <span key={`${token.kind}:${token.value}:${token.start}`} className="cp-chip">
            <ChipIcon kind={token.kind} value={token.value} />
            <span className="cp-chip-label">{token.label}</span>
            <button
              type="button"
              className="cp-chip-remove"
              aria-label={t('clip.panel.search.removeFilter')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onRemoveToken(token)}
            >
              <X />
            </button>
          </span>
        ))}
      </div>
      <div className="cp-search-field">
        {showHint ? (
          <span key={hintIndex} className="cp-search-placeholder">
            {hint}
          </span>
        ) : null}
        <input
          ref={inputRef}
          className="cp-search-input"
          value={text}
          aria-label={placeholders[0]}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          onChange={(event) => onTextChange(event.target.value)}
          onCompositionStart={() => {
            setComposing(true)
            onCompositionChange(true)
          }}
          onCompositionEnd={() => {
            setComposing(false)
            onCompositionChange(false)
          }}
        />
      </div>
      {suggestions.length > 0 ? (
        <div className="cp-search-suggestions">
          {suggestions.slice(0, 3).map((token) => (
            <button
              key={`${token.kind}:${token.value}:${token.start}`}
              type="button"
              className="cp-chip is-suggestion"
              title={t('clip.panel.search.acceptSuggestion')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onAcceptSuggestion(token)}
            >
              <Plus />
              <span className="cp-chip-label">{token.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {text ? (
        <button
          type="button"
          className="cp-search-clear"
          aria-label={t('clip.panel.search.clear')}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onTextChange('')}
        >
          <X />
        </button>
      ) : null}
    </div>
  )
}
