import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { Info, Layers, ShieldAlert, X } from 'lucide-react'
import type { ClipPasteStackState } from '@/lib/clipboard/types'
import { cn } from '@/lib/utils'
import { MAX_PANEL_HEIGHT, MIN_PANEL_HEIGHT, type PanelTranslate } from '@/app/components/clipboard-panel/panel-utils'

export type PanelToastState = {
  id: number
  text: string
  tone?: 'info' | 'warning'
  actionLabel?: string
  onAction?: () => void
}

export function PanelToast({ toast, onDismiss }: { toast: PanelToastState | null; onDismiss: () => void }) {
  if (!toast) {
    return null
  }

  return (
    <div className={cn('cp-toast', toast.tone === 'warning' && 'is-warning')} role="status">
      {toast.tone === 'warning' ? <ShieldAlert /> : <Info />}
      <span className="cp-toast-text">{toast.text}</span>
      {toast.actionLabel ? (
        <button
          type="button"
          className="cp-toast-action"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            toast.onAction?.()
            onDismiss()
          }}
        >
          {toast.actionLabel}
        </button>
      ) : null}
    </div>
  )
}

export function PasteStackIndicator({
  t,
  state,
  onStop,
}: {
  t: PanelTranslate
  state: ClipPasteStackState
  onStop: () => void
}) {
  if (!state.active) {
    return null
  }

  const next = state.items[0]
  const nextText = next ? next.previewText.replace(/\s+/g, ' ').trim() || next.title : ''

  return (
    <div className="cp-stack">
      <Layers />
      <span className="cp-stack-title">{t('clip.panel.stack.active')}</span>
      <span className="cp-stack-count">{t('clip.panel.stack.remaining', { count: state.items.length })}</span>
      {next ? (
        <span className="cp-stack-next">
          {t('clip.panel.stack.next')}
          <b>{nextText.slice(0, 40)}</b>
        </span>
      ) : (
        <span className="cp-stack-next">{t('clip.panel.stack.empty')}</span>
      )}
      <button type="button" className="cp-stack-stop" aria-label={t('clip.panel.stack.stop')} onClick={onStop}>
        <X />
      </button>
    </div>
  )
}

/** Drag the top edge of the panel to change its height (window is anchored to the bottom of the screen). */
export function ResizeHandle({ onResize }: { onResize: (height: number) => void }) {
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const frameRef = useRef(0)
  const pendingRef = useRef(0)

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  const handleDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      startY: event.screenY,
      startHeight: event.currentTarget.closest('.cp-root')?.clientHeight ?? window.innerHeight,
    }
  }

  const handleMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current

    if (!drag) {
      return
    }

    // The button was released outside the window: stop following the pointer.
    if (event.buttons === 0) {
      dragRef.current = null
      return
    }

    pendingRef.current = Math.round(
      Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, drag.startHeight + (drag.startY - event.screenY)))
    )

    if (!frameRef.current) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0
        onResize(pendingRef.current)
      })
    }
  }

  const handleUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      dragRef.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div
      className="cp-resize"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
    >
      <span className="cp-resize-grip" />
    </div>
  )
}
