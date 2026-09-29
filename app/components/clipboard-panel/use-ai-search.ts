import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipboardApi } from '@/lib/conveyor/api/clipboard-api'
import type { ClipAiSearchStatus, ClipListItem } from '@/lib/clipboard/types'
import { buildScopeFilters, type ClipFilters } from '@/app/components/clipboard-panel/use-clip-list'
import { looksLikeNaturalLanguage } from '@/app/components/clipboard-panel/panel-utils'
import { useEvent } from '@/app/components/clipboard-panel/use-event'

const AUTO_TRIGGER_DELAY_MS = 500

export type AiSearchState = {
  status: 'idle' | 'loading' | 'ready' | 'none'
  items: ClipListItem[]
  /** Why nothing was returned (only for `none`). Handled quietly, never shown as an error. */
  reason?: ClipAiSearchStatus
}

const idleState: AiSearchState = { status: 'idle', items: [] }

/** Optional AI ranking on top of the keyword results. Only active when `enabled`. */
export function useAiSearch({
  clipboard,
  enabled,
  trigger,
  filters,
}: {
  clipboard: ClipboardApi
  enabled: boolean
  trigger: 'manual' | 'auto'
  filters: ClipFilters
}) {
  const [state, setState] = useState<AiSearchState>(idleState)
  const [dismissed, setDismissed] = useState(false)
  const requestRef = useRef(0)
  const loadingRef = useRef(false)
  loadingRef.current = state.status === 'loading'

  const run = useEvent(async () => {
    const query = filters.text.trim()

    if (!enabled || !query) {
      return
    }

    const requestId = ++requestRef.current
    setDismissed(false)
    setState({ status: 'loading', items: [] })

    try {
      const result = await clipboard.aiSearch(query, buildScopeFilters(filters))

      if (requestId !== requestRef.current) {
        return
      }

      if (result.status === 'ok' && result.items.length > 0) {
        setState({ status: 'ready', items: result.items })
      } else {
        setState({ status: 'none', items: [], reason: result.status })
      }
    } catch (error) {
      console.warn('[clipboard-panel] ai search failed', error)

      if (requestId === requestRef.current) {
        setState({ status: 'none', items: [], reason: 'error' })
      }
    }
  })

  const key = JSON.stringify([filters.text, filters.scopeId, filters.kinds, filters.appIds, filters.datePreset])

  // The query changed: drop stale AI results, cancel the request in flight, maybe schedule an automatic run.
  useEffect(() => {
    requestRef.current += 1

    if (loadingRef.current) {
      void clipboard.aiCancel()
    }

    setState((previous) => (previous.status === 'idle' ? previous : idleState))

    if (!enabled || trigger !== 'auto' || !looksLikeNaturalLanguage(filters.text)) {
      return
    }

    const timer = setTimeout(() => void run(), AUTO_TRIGGER_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, trigger])

  const cancel = useCallback(() => {
    requestRef.current += 1

    if (loadingRef.current) {
      void clipboard.aiCancel()
    }

    setState(idleState)
  }, [clipboard])

  const removeIds = useCallback((ids: string[]) => {
    const removed = new Set(ids)
    setState((previous) =>
      previous.items.some((item) => removed.has(item.id))
        ? { ...previous, items: previous.items.filter((item) => !removed.has(item.id)) }
        : previous
    )
  }, [])

  return {
    state,
    dismissed,
    removeIds,
    setDismissed,
    run,
    cancel,
  }
}
