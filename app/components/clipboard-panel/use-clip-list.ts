import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipboardApi } from '@/lib/conveyor/api/clipboard-api'
import type { ClipDatePreset, ClipKind, ClipListItem, ClipQuery, ParsedClipQuery } from '@/lib/clipboard/types'
import { PAGE_SIZE, mergeUniqueById, presetToRange } from '@/app/components/clipboard-panel/panel-utils'

const SEARCH_DEBOUNCE_MS = 80

export type ClipFilters = {
  /** Raw search box text (may contain inline tokens). */
  text: string
  /** null = clipboard history, otherwise a pinboard id. */
  scopeId: string | null
  kinds: ClipKind[]
  appIds: string[]
  datePreset: ClipDatePreset | null
}

export const emptyClipFilters: ClipFilters = { text: '', scopeId: null, kinds: [], appIds: [], datePreset: null }

const filtersKey = (filters: ClipFilters) =>
  JSON.stringify([filters.text, filters.scopeId, filters.kinds, filters.appIds, filters.datePreset])

export const hasActiveFilters = (filters: ClipFilters) =>
  filters.kinds.length > 0 || filters.appIds.length > 0 || filters.datePreset !== null

export const buildScopeFilters = (
  filters: ClipFilters
): Pick<ClipQuery, 'kinds' | 'appBundleIds' | 'dateRange' | 'scope'> => ({
  scope: filters.scopeId ? { type: 'pinboard', pinboardId: filters.scopeId } : { type: 'history' },
  kinds: filters.kinds.length ? filters.kinds : undefined,
  appBundleIds: filters.appIds.length ? filters.appIds : undefined,
  dateRange: filters.datePreset ? presetToRange(filters.datePreset) : undefined,
})

const buildQuery = (filters: ClipFilters, extra: Pick<ClipQuery, 'cursor' | 'limit'>): ClipQuery => ({
  ...buildScopeFilters(filters),
  // The raw text is sent as is, so token positions in the parsed result stay valid for chip removal.
  text: filters.text.trim() ? filters.text : undefined,
  ...extra,
})

/** Query state + paged results for the card strip. */
export function useClipList(clipboard: ClipboardApi) {
  const [filters, setFilters] = useState<ClipFilters>(emptyClipFilters)
  const [composing, setComposing] = useState(false)
  const [items, setItems] = useState<ClipListItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [parsed, setParsed] = useState<ParsedClipQuery | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  /** Bumped every time the result set was replaced because the query (not a background refresh) changed. */
  const [resetToken, setResetToken] = useState(0)

  const filtersRef = useRef(filters)
  const itemsRef = useRef(items)
  const cursorRef = useRef(nextCursor)
  const requestRef = useRef(0)
  const epochRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const lastTextRef = useRef('')

  filtersRef.current = filters
  itemsRef.current = items
  cursorRef.current = nextCursor

  const fetchFirst = useCallback(
    async (mode: 'reset' | 'refresh') => {
      const requestId = ++requestRef.current
      epochRef.current += 1
      const loaded = itemsRef.current.length
      const limit = mode === 'refresh' ? Math.min(200, Math.max(PAGE_SIZE, loaded)) : PAGE_SIZE

      if (mode === 'reset') {
        setLoading(true)
      }

      try {
        const result = await clipboard.list(buildQuery(filtersRef.current, { limit }))

        if (requestId !== requestRef.current) {
          return
        }

        if (mode === 'refresh' && loaded > 200) {
          // Only the head was re-fetched; keep the already paged tail and its cursor.
          const headIds = new Set(result.items.map((item) => item.id))
          const tail = itemsRef.current.slice(200).filter((item) => !headIds.has(item.id))
          setItems([...result.items, ...tail])
        } else {
          setItems(result.items)
          setNextCursor(result.nextCursor)
        }

        setParsed(result.parsed)

        if (mode === 'reset') {
          setResetToken((value) => value + 1)
        }
      } catch (error) {
        console.error('[clipboard-panel] list failed', error)
      } finally {
        if (requestId === requestRef.current) {
          setLoading(false)
        }
      }
    },
    [clipboard]
  )

  const loadMore = useCallback(async () => {
    const cursor = cursorRef.current

    if (!cursor || loadingMoreRef.current) {
      return
    }

    loadingMoreRef.current = true
    setLoadingMore(true)
    const epoch = epochRef.current

    try {
      const result = await clipboard.list(buildQuery(filtersRef.current, { cursor, limit: PAGE_SIZE }))

      if (epoch !== epochRef.current) {
        return
      }

      setItems((previous) => mergeUniqueById(previous, result.items))
      setNextCursor(result.nextCursor)
    } catch (error) {
      console.error('[clipboard-panel] list next page failed', error)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [clipboard])

  const refresh = useCallback(() => fetchFirst('refresh'), [fetchFirst])

  const key = filtersKey(filters)

  useEffect(() => {
    if (composing) {
      return
    }

    const textChanged = lastTextRef.current !== filtersRef.current.text
    lastTextRef.current = filtersRef.current.text
    const timer = setTimeout(() => void fetchFirst('reset'), textChanged ? SEARCH_DEBOUNCE_MS : 0)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, composing, fetchFirst])

  const patchFilters = useCallback((patch: Partial<ClipFilters>) => {
    setFilters((previous) => ({ ...previous, ...patch }))
  }, [])

  /** Called when the panel is shown again. */
  const resetForShow = useCallback(
    (initialQuery?: string) => {
      const next: ClipFilters = { ...emptyClipFilters, text: initialQuery ?? '' }
      const same = filtersKey(next) === filtersKey(filtersRef.current)

      setComposing(false)

      if (same) {
        void fetchFirst('reset')
        return
      }

      setItems([])
      setNextCursor(undefined)
      setFilters(next)
    },
    [fetchFirst]
  )

  const removeIds = useCallback((ids: string[]) => {
    const removed = new Set(ids)
    setItems((previous) => previous.filter((item) => !removed.has(item.id)))
  }, [])

  const patchItem = useCallback((updated: ClipListItem) => {
    setItems((previous) => previous.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)))
  }, [])

  return {
    filters,
    patchFilters,
    setComposing,
    items,
    nextCursor,
    parsed,
    loading,
    loadingMore,
    resetToken,
    loadMore,
    refresh,
    resetForShow,
    removeIds,
    patchItem,
  }
}
