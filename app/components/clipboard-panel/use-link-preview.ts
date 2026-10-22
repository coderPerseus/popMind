import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import type { ClipLinkPreview } from '@/lib/clipboard/types'

// One cache for every link card; filled by `clip-link-preview` answers and `link-preview` push events.
const cache = new Map<string, ClipLinkPreview>()
const requested = new Set<string>()
const listeners = new Set<() => void>()
let unsubscribe: (() => void) | null = null

const notify = () => listeners.forEach((listener) => listener())

const store = (preview: ClipLinkPreview | null | undefined) => {
  if (!preview) return
  if (preview.fetchedAt === 0 && preview.status !== 'ready') {
    // Dropped from a full queue on the main side: forget it so the card asks again when it shows up next time.
    requested.delete(preview.url)
    if (cache.delete(preview.url)) notify()
    return
  }
  const current = cache.get(preview.url)
  // A `pending` answer must not hide a preview that already arrived through the event.
  if (preview.status === 'pending' && current && current.status !== 'pending') return
  cache.set(preview.url, preview)
  notify()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  if (!unsubscribe) unsubscribe = window.conveyor.clipboard.onLinkPreview?.(store) ?? (() => undefined)
  return () => {
    listeners.delete(listener)
  }
}

/** True while the element is inside the visible part of its scroll container. */
export function useInViewport(ref: RefObject<Element | null>) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.01 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return visible
}

/** Preview of `url`, requested only once the card is visible. */
export function useLinkPreview(url: string | undefined, visible: boolean) {
  const preview = useSyncExternalStore(subscribe, () => (url ? cache.get(url) : undefined))

  useEffect(() => {
    if (!url || !visible || requested.has(url)) return
    requested.add(url)
    const request = window.conveyor.clipboard.linkPreview?.(url)
    if (!request) return
    request
      .then((preview) => {
        // No preview and none queued (previews turned off): ask again next time the card shows.
        if (!preview) requested.delete(url)
        store(preview)
      })
      .catch(() => requested.delete(url))
  }, [url, visible])

  return preview
}
