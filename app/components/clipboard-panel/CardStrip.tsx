import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type MutableRefObject,
  type WheelEvent,
} from 'react'
import { ClipboardList, SearchX } from 'lucide-react'
import type { AppLanguage } from '@/lib/capability/types'
import type { ClipListItem } from '@/lib/clipboard/types'
import { ContextMenu, ContextMenuTrigger } from '@/app/components/ui/context-menu'
import { ClipCard } from '@/app/components/clipboard-panel/ClipCard'
import { ClipContextMenuContent } from '@/app/components/clipboard-panel/ClipContextMenu'
import { Spinner } from '@/app/components/clipboard-panel/panel-parts'
import {
  CARD_GAP,
  CARD_WIDTH,
  GROUP_WIDTH,
  OVERSCAN_PX,
  STRIP_PADDING,
  type PanelTranslate,
} from '@/app/components/clipboard-panel/panel-utils'

export type StripEntry =
  | { type: 'card'; item: ClipListItem; index: number }
  | { type: 'group'; key: string; label: string; loading?: boolean }

type CardStripProps = {
  entries: StripEntry[]
  activeId: string | null
  selectedIds: Set<string>
  metaHeld: boolean
  now: number
  language: AppLanguage
  t: PanelTranslate
  pinboardColors: Record<string, string>
  loading: boolean
  hasQuery: boolean
  hasMore: boolean
  loadingMore: boolean
  /** Changes when the result set was replaced by a new query: scroll back to the start. */
  scrollResetKey: number
  /** Written on every render: card index of the first fully visible card (base of the ⌘1–9 numbers). */
  firstVisibleRef: MutableRefObject<{ first: number; count: number }>
  onLoadMore: () => void
  onCardClick: (event: MouseEvent, item: ClipListItem) => void
  onCardDoubleClick: (item: ClipListItem) => void
  onCardContextMenu: (item: ClipListItem) => void
  onCardDragStart: (event: DragEvent, item: ClipListItem) => void
}

const entryWidth = (entry: StripEntry) => (entry.type === 'card' ? CARD_WIDTH : GROUP_WIDTH)

const lowerBound = (offsets: number[], entries: StripEntry[], position: number) => {
  let low = 0
  let high = entries.length

  while (low < high) {
    const mid = (low + high) >> 1

    if (offsets[mid] + entryWidth(entries[mid]) < position) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return low
}

export const CardStrip = forwardRef<HTMLDivElement, CardStripProps>(function CardStrip(props, forwardedRef) {
  const {
    entries,
    activeId,
    selectedIds,
    metaHeld,
    now,
    language,
    t,
    pinboardColors,
    loading,
    hasQuery,
    hasMore,
    loadingMore,
    scrollResetKey,
    firstVisibleRef,
    onLoadMore,
    onCardClick,
    onCardDoubleClick,
    onCardContextMenu,
    onCardDragStart,
  } = props
  const elementRef = useRef<HTMLDivElement | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(1200)
  const frameRef = useRef(0)
  const previousLayoutRef = useRef<{ entries: StripEntry[]; offsets: number[] } | null>(null)
  const resetKeyRef = useRef(scrollResetKey)

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      elementRef.current = node

      if (typeof forwardedRef === 'function') {
        forwardedRef(node)
      } else if (forwardedRef) {
        forwardedRef.current = node
      }
    },
    [forwardedRef]
  )

  const layout = useMemo(() => {
    const offsets: number[] = []
    let x = STRIP_PADDING

    entries.forEach((entry) => {
      offsets.push(x)
      x += entryWidth(entry) + CARD_GAP
    })

    return { offsets, total: entries.length ? x - CARD_GAP + STRIP_PADDING : 0 }
  }, [entries])

  // Track the scroll viewport width.
  useLayoutEffect(() => {
    const element = elementRef.current

    if (!element) {
      return
    }

    setViewportWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth))
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  const handleScroll = useCallback(() => {
    if (frameRef.current) {
      return
    }

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      setScrollLeft(elementRef.current?.scrollLeft ?? 0)
    })
  }, [])

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  // Keep the view stable when the list changes: back to start on a new query, otherwise anchor on the first
  // visible card so an item added at the front does not shove the viewport.
  useLayoutEffect(() => {
    const element = elementRef.current

    if (!element) {
      return
    }

    const previous = previousLayoutRef.current
    previousLayoutRef.current = { entries, offsets: layout.offsets }

    if (resetKeyRef.current !== scrollResetKey) {
      resetKeyRef.current = scrollResetKey
      element.scrollLeft = 0
      setScrollLeft(0)
      return
    }

    if (!previous || element.scrollLeft < 4) {
      return
    }

    const anchorIndex = previous.entries.findIndex(
      (entry, index) => entry.type === 'card' && previous.offsets[index] >= element.scrollLeft - 8
    )
    const anchor = previous.entries[anchorIndex]

    if (!anchor || anchor.type !== 'card') {
      return
    }

    const nextIndex = entries.findIndex((entry) => entry.type === 'card' && entry.item.id === anchor.item.id)

    if (nextIndex < 0) {
      return
    }

    const delta = layout.offsets[nextIndex] - previous.offsets[anchorIndex]

    if (delta !== 0) {
      element.scrollLeft += delta
      setScrollLeft(element.scrollLeft)
    }
  }, [entries, layout, scrollResetKey])

  // Keep the active card in view.
  useLayoutEffect(() => {
    const element = elementRef.current

    if (!element || !activeId) {
      return
    }

    const index = entries.findIndex((entry) => entry.type === 'card' && entry.item.id === activeId)

    if (index < 0) {
      return
    }

    const left = layout.offsets[index]
    const right = left + CARD_WIDTH
    const viewport = element.clientWidth

    if (left - STRIP_PADDING < element.scrollLeft) {
      element.scrollLeft = Math.max(0, left - STRIP_PADDING)
    } else if (right + STRIP_PADDING > element.scrollLeft + viewport) {
      element.scrollLeft = right + STRIP_PADDING - viewport
    }

    setScrollLeft(element.scrollLeft)
    // Only when the active card changes, not on every list refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // Next page when the user gets near the end.
  useEffect(() => {
    if (hasMore && !loadingMore && layout.total > 0 && scrollLeft + viewportWidth > layout.total - 1400) {
      onLoadMore()
    }
  }, [hasMore, loadingMore, layout.total, scrollLeft, viewportWidth, onLoadMore])

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const element = elementRef.current

    if (element && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      element.scrollLeft += event.deltaY
    }
  }

  const from = lowerBound(layout.offsets, entries, scrollLeft - OVERSCAN_PX)
  const visible: Array<{ entry: StripEntry; offset: number }> = []

  for (let index = from; index < entries.length; index += 1) {
    if (layout.offsets[index] > scrollLeft + viewportWidth + OVERSCAN_PX) {
      break
    }

    visible.push({ entry: entries[index], offset: layout.offsets[index] })
  }

  let firstVisibleCard = -1

  for (let index = lowerBound(layout.offsets, entries, scrollLeft - 8); index < entries.length; index += 1) {
    const entry = entries[index]

    if (entry.type === 'card' && layout.offsets[index] >= scrollLeft - 8) {
      firstVisibleCard = entry.index
      break
    }
  }

  // Cards that are fully on screen, counted from the first one: the ⌘1–9 targets.
  let fullyVisibleCount = 0

  if (firstVisibleCard >= 0) {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]

      if (entry.type === 'card' && entry.index >= firstVisibleCard) {
        if (layout.offsets[index] + CARD_WIDTH > scrollLeft + viewportWidth + 4) {
          break
        }

        fullyVisibleCount += 1
      }
    }
  }

  firstVisibleRef.current = { first: Math.max(0, firstVisibleCard), count: Math.min(9, fullyVisibleCount) }

  return (
    <div ref={setRefs} className="cp-strip-scroll" tabIndex={-1} onScroll={handleScroll} onWheel={handleWheel}>
      {entries.length === 0 ? (
        <div className="cp-empty">
          {loading ? (
            <>
              <Spinner className="size-5" />
              <span>{t('clip.panel.state.loading')}</span>
            </>
          ) : hasQuery ? (
            <>
              <SearchX />
              <span>{t('clip.panel.state.noResults')}</span>
            </>
          ) : (
            <>
              <ClipboardList />
              <span>{t('clip.panel.state.empty')}</span>
              <small>{t('clip.panel.state.emptyHint')}</small>
            </>
          )}
        </div>
      ) : (
        <div className="cp-strip-track" style={{ width: layout.total }}>
          {visible.map(({ entry, offset }) => {
            if (entry.type === 'group') {
              return (
                <div key={`group:${entry.key}`} className="cp-group" style={{ left: offset, width: GROUP_WIDTH }}>
                  {entry.loading ? <Spinner className="size-3.5" /> : null}
                  <span>{entry.label}</span>
                </div>
              )
            }

            const { item } = entry
            const badge = entry.index - firstVisibleRef.current.first + 1

            return (
              <ContextMenu key={item.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className="cp-slot"
                    style={{ left: offset, width: CARD_WIDTH }}
                    draggable
                    onClick={(event) => onCardClick(event, item)}
                    onDoubleClick={() => onCardDoubleClick(item)}
                    onContextMenu={() => onCardContextMenu(item)}
                    onDragStart={(event) => onCardDragStart(event, item)}
                  >
                    <ClipCard
                      item={item}
                      selected={selectedIds.has(item.id)}
                      active={activeId === item.id}
                      badge={metaHeld && badge >= 1 && badge <= firstVisibleRef.current.count ? badge : undefined}
                      now={now}
                      language={language}
                      t={t}
                      pinboardColors={pinboardColors}
                    />
                  </div>
                </ContextMenuTrigger>
                <ClipContextMenuContent />
              </ContextMenu>
            )
          })}
          {loadingMore ? (
            <div className="cp-more" style={{ left: layout.total - STRIP_PADDING + CARD_GAP }}>
              <Spinner className="size-4" />
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
})
