// Paste Stack controller (spec §5.6), written against injected dependencies so the queue logic is unit testable.
// Real wiring lives in write/index.ts.
//
// Invariant while active: the pasteboard holds queue[0] (the item the next user ⌘V will paste).
//   - a newly captured item is appended; it is on the pasteboard right after the copy, so if it is not the head the
//     head is written back;
//   - every physical ⌘V pastes the head: it leaves the queue and (after a short delay) the new head is written;
//   - the stack ends when the queue runs empty, or when toggled off.
import type { ClipItemsChangedEvent, ClipListItem, ClipPasteStackState } from '@/lib/clipboard/types'

export type PasteStackDeps = {
  getItemsByIds: (ids: string[]) => Promise<ClipListItem[]>
  /** Writes the item to the pasteboard with the `paste-stack` marker. */
  writeToPasteboard: (id: string) => Promise<boolean>
  /** Starts the physical ⌘V monitor; false when it could not be started (no permission / unsupported). */
  startMonitor: (onUserPaste: () => void) => boolean
  stopMonitor: () => void
  subscribeItemsChanged: (handler: (event: ClipItemsChangedEvent) => void) => () => void
  emitState: (state: ClipPasteStackState) => void
  setTimer: (callback: () => void, ms: number) => () => void
  now: () => number
  log: (message: string, details?: Record<string, unknown>) => void
  /** Delay between a user ⌘V and writing the next item (lets the target app read the pasteboard first). */
  pasteDelayMs?: number
}

export type PasteStackController = {
  toggle: () => Promise<ClipPasteStackState>
  getState: () => Promise<ClipPasteStackState>
  isActive: () => boolean
  /** Test / debug helper: current queue of item ids, first = next. */
  peekQueue: () => string[]
  dispose: () => void
}

const DEFAULT_PASTE_DELAY_MS = 100
/** Echo window: capture may report the item we just wrote back as `bumped`. */
const OWN_WRITE_ECHO_MS = 800

export const createPasteStack = (deps: PasteStackDeps): PasteStackController => {
  const pasteDelayMs = deps.pasteDelayMs ?? DEFAULT_PASTE_DELAY_MS

  let active = false
  let queue: string[] = []
  /** Id of the item we believe is on the pasteboard right now. */
  let onPasteboard: string | null = null
  let lastOwnWrite: { id: string; at: number } | null = null
  let unsubscribe: (() => void) | null = null
  let cancelPasteTimer: (() => void) | null = null
  // All mutations are serialized so async writes never interleave.
  let chain: Promise<unknown> = Promise.resolve()

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.then(task, task)
    chain = next.catch(() => undefined)
    return next
  }

  const buildState = async (): Promise<ClipPasteStackState> => {
    if (!active) return { active: false, items: [] }
    const ids = [...queue]
    if (ids.length === 0) return { active: true, items: [] }
    const items = await deps.getItemsByIds([...new Set(ids)])
    const byId = new Map(items.map((item) => [item.id, item]))
    return {
      active: true,
      items: ids.map((id) => byId.get(id)).filter((item): item is ClipListItem => Boolean(item)),
    }
  }

  const emit = async () => {
    try {
      deps.emitState(await buildState())
    } catch (error) {
      deps.log('[clip-paste] paste stack emit failed', { error: String(error) })
    }
  }

  const ensureHeadOnPasteboard = async () => {
    const head = queue[0]
    if (!head || head === onPasteboard) return

    const ok = await deps.writeToPasteboard(head)
    if (ok) {
      onPasteboard = head
      lastOwnWrite = { id: head, at: deps.now() }
    }
    deps.log('[clip-paste] paste stack wrote head', { id: head, ok, remaining: queue.length })
  }

  const stop = (reason: string) => {
    if (!active) return
    active = false
    queue = []
    onPasteboard = null
    lastOwnWrite = null
    cancelPasteTimer?.()
    cancelPasteTimer = null
    unsubscribe?.()
    unsubscribe = null
    deps.stopMonitor()
    deps.log('[clip-paste] paste stack stopped', { reason })
  }

  const handleItemsChanged = (event: ClipItemsChangedEvent) => {
    if (!active) return
    if (event.reason !== 'added' && event.reason !== 'bumped') return

    void enqueue(async () => {
      if (!active) return

      let ids = event.ids
      const echo = lastOwnWrite
      if (echo && deps.now() - echo.at < OWN_WRITE_ECHO_MS && ids.length === 1 && ids[0] === echo.id) {
        // The pasteboard change we caused ourselves.
        return
      }
      ids = ids.filter(Boolean)
      if (ids.length === 0) return

      queue.push(...ids)
      // The newest captured item is what is on the pasteboard now.
      onPasteboard = ids[ids.length - 1]
      deps.log('[clip-paste] paste stack push', { ids, size: queue.length })
      await ensureHeadOnPasteboard()
      await emit()
    })
  }

  const handleUserPaste = () => {
    void enqueue(async () => {
      if (!active || queue.length === 0) return

      // The head is what just got pasted (it was on the pasteboard).
      const pasted = queue.shift()
      onPasteboard = pasted ?? null
      deps.log('[clip-paste] paste stack user paste', { pasted, remaining: queue.length })

      if (queue.length === 0) {
        stop('empty')
        await emit()
        return
      }

      await emit()
      cancelPasteTimer?.()
      cancelPasteTimer = deps.setTimer(() => {
        cancelPasteTimer = null
        void enqueue(async () => {
          if (active) await ensureHeadOnPasteboard()
        })
      }, pasteDelayMs)
    })
  }

  const start = () => {
    if (!deps.startMonitor(handleUserPaste)) {
      deps.log('[clip-paste] paste stack monitor unavailable')
      return false
    }

    active = true
    queue = []
    onPasteboard = null
    lastOwnWrite = null
    unsubscribe = deps.subscribeItemsChanged(handleItemsChanged)
    deps.log('[clip-paste] paste stack started')
    return true
  }

  return {
    toggle: () =>
      enqueue(async () => {
        if (active) {
          stop('toggle')
        } else {
          start()
        }
        const state = await buildState()
        deps.emitState(state)
        return state
      }),
    getState: () => enqueue(buildState),
    isActive: () => active,
    peekQueue: () => [...queue],
    dispose: () => stop('dispose'),
  }
}
