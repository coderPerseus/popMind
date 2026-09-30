import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { useI18n } from '@/app/i18n'
import { syncDocumentThemeWithSystemPreference } from '@/app/theme'
import {
  defaultClipboardSettings,
  mergeClipboardSettings,
  type ClipDetail,
  type ClipKind,
  type ClipListItem,
  type ClipPanelShowEvent,
  type ClipPasteMode,
  type ClipPasteResult,
  type ClipPasteStackState,
  type ClipQueryToken,
  type ClipSourceApp,
  type ClipboardSettings,
  type Pinboard,
} from '@/lib/clipboard/types'
import { CardStrip, type StripEntry } from '@/app/components/clipboard-panel/CardStrip'
import { PanelActionsContext, type PanelActionsValue } from '@/app/components/clipboard-panel/ClipContextMenu'
import { FilterRow } from '@/app/components/clipboard-panel/FilterRow'
import { ConfirmDialog, NameDialog, TextDialog } from '@/app/components/clipboard-panel/PanelDialogs'
import {
  PanelToast,
  PasteStackIndicator,
  ResizeHandle,
  type PanelToastState,
} from '@/app/components/clipboard-panel/PanelOverlays'
import { CLIP_DRAG_TYPE } from '@/app/components/clipboard-panel/PinboardTabs'
import { QuickLook } from '@/app/components/clipboard-panel/QuickLook'
import type { UiFilterChip } from '@/app/components/clipboard-panel/SearchField'
import { TopBar, type PauseChoice } from '@/app/components/clipboard-panel/TopBar'
import {
  UNDO_WINDOW_MS,
  canEditText,
  canOpen,
  createTranslate,
  getPinboardColor,
  isEditableTarget,
  stripTextRange,
} from '@/app/components/clipboard-panel/panel-utils'
import {
  clickSelection,
  emptySelection,
  moveSelection,
  reconcileSelection,
  selectAllItems,
  singleSelection,
  type Selection,
} from '@/app/components/clipboard-panel/selection'
import { useAiSearch } from '@/app/components/clipboard-panel/use-ai-search'
import { hasActiveFilters, useClipList } from '@/app/components/clipboard-panel/use-clip-list'
import { useEvent } from '@/app/components/clipboard-panel/use-event'
import '@/app/styles/clipboard-panel.css'

type DialogState =
  | { type: 'rename'; item: ClipListItem }
  | { type: 'edit'; item: ClipListItem; text: string; loading: boolean }
  | { type: 'newText' }
  | { type: 'pinboardRename'; pinboard: Pinboard }
  | { type: 'pinboardDelete'; pinboard: Pinboard }

const COPY_HINT_MS = 2800
const CLOSE_OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

export function ClipboardPanelApp() {
  const { language } = useI18n()
  const t = useMemo(() => createTranslate(language), [language])
  const clipboard = useConveyor('clipboard')
  const capability = useConveyor('capability')
  const windowApi = useConveyor('window')

  useEffect(() => syncDocumentThemeWithSystemPreference(), [])

  // ---- settings ----
  const [settings, setSettings] = useState<ClipboardSettings>(defaultClipboardSettings)

  useEffect(() => {
    let mounted = true

    void capability.getSettings().then((next) => {
      if (mounted) {
        setSettings(mergeClipboardSettings(next.clipboard, undefined))
      }
    })
    const unsubscribe = capability.onState((next) => setSettings(mergeClipboardSettings(next.clipboard, undefined)))

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [capability])

  // ---- data ----
  const list = useClipList(clipboard)
  const { filters } = list
  const aiEnabled = settings.ai.enabled
  const ai = useAiSearch({ clipboard, enabled: aiEnabled, trigger: settings.ai.trigger, filters })
  const [pinboards, setPinboards] = useState<Pinboard[]>([])
  const [apps, setApps] = useState<ClipSourceApp[]>([])
  const [stack, setStack] = useState<ClipPasteStackState>({ active: false, items: [] })

  const refreshPinboards = useCallback(async () => {
    try {
      setPinboards(await clipboard.listPinboards())
    } catch (error) {
      console.error('[clipboard-panel] list pinboards failed', error)
    }
  }, [clipboard])

  const pinboardColors = useMemo(
    () => Object.fromEntries(pinboards.map((pinboard) => [pinboard.id, getPinboardColor(pinboard.color)])),
    [pinboards]
  )

  // ---- cards (keyword results, optionally led by the AI ranking) ----
  const aiReady = aiEnabled && ai.state.status === 'ready' && !ai.dismissed
  const aiLoading = aiEnabled && ai.state.status === 'loading'

  const { entries, cards } = useMemo(() => {
    const nextEntries: StripEntry[] = []
    const nextCards: ClipListItem[] = []
    const pushCard = (item: ClipListItem) => {
      nextEntries.push({ type: 'card', item, index: nextCards.length })
      nextCards.push(item)
    }

    if (aiLoading) {
      nextEntries.push({ type: 'group', key: 'ai-loading', label: t('clip.panel.ai.group'), loading: true })
    }

    if (aiReady) {
      nextEntries.push({ type: 'group', key: 'ai', label: t('clip.panel.ai.group') })
      ai.state.items.forEach(pushCard)
      const rankedIds = new Set(ai.state.items.map((item) => item.id))
      const rest = list.items.filter((item) => !rankedIds.has(item.id))

      if (rest.length > 0) {
        nextEntries.push({ type: 'group', key: 'rest', label: t('clip.panel.ai.rest') })
        rest.forEach(pushCard)
      }
    } else {
      list.items.forEach(pushCard)
    }

    return { entries: nextEntries, cards: nextCards }
  }, [aiLoading, aiReady, ai.state.items, list.items, t])

  // ---- selection ----
  const [selection, setSelection] = useState<Selection>(emptySelection)
  const selectionRef = useRef(selection)
  const cardsRef = useRef(cards)
  const previousCardsRef = useRef<ClipListItem[]>([])
  const resetKeyRef = useRef('')
  const pendingSelectRef = useRef<string | null>(null)
  selectionRef.current = selection
  cardsRef.current = cards

  const resetKey = `${list.resetToken}:${aiReady}`

  useEffect(() => {
    const isReset = resetKeyRef.current !== resetKey
    resetKeyRef.current = resetKey
    const pending = pendingSelectRef.current
    let next: Selection

    if (pending && cards.some((item) => item.id === pending)) {
      pendingSelectRef.current = null
      next = singleSelection(pending)
    } else if (isReset) {
      next = cards.length > 0 ? singleSelection(cards[0].id) : emptySelection
    } else {
      next = reconcileSelection(cards, selectionRef.current, previousCardsRef.current)
    }

    previousCardsRef.current = cards
    setSelection(next)
  }, [cards, resetKey])

  const selectedIds = useMemo(() => new Set(selection.ids), [selection.ids])
  const activeItem = useMemo(
    () => cards.find((item) => item.id === selection.activeId) ?? null,
    [cards, selection.activeId]
  )

  const getTargets = useEvent((): ClipListItem[] => {
    const selected = new Set(selectionRef.current.ids)
    const targets = cardsRef.current.filter((item) => selected.has(item.id))

    if (targets.length > 0) {
      return targets
    }

    const active = cardsRef.current.find((item) => item.id === selectionRef.current.activeId)
    return active ? [active] : []
  })

  // ---- panel lifecycle ----
  // The window is pre-warmed: the content is always rendered, show/hide is instant and state is reset in place.
  const visibleRef = useRef(false)
  const [showEpoch, setShowEpoch] = useState(0)
  const showEpochRef = useRef(0)
  const [panelMeta, setPanelMeta] = useState<{ targetAppName?: string; canDirectPaste: boolean }>({
    canDirectPaste: true,
  })
  const [now, setNow] = useState(() => Date.now())
  const [metaHeld, setMetaHeld] = useState(false)
  const [compact, setCompact] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const stripRef = useRef<HTMLDivElement | null>(null)
  const firstVisibleRef = useRef({ first: 0, count: 0 })

  const focusSearch = useEvent(() => {
    searchRef.current?.focus({ preventScroll: true })
  })

  const focusResults = useEvent(() => {
    searchRef.current?.blur()
    stripRef.current?.focus({ preventScroll: true })
  })

  // ---- transient UI ----
  const [quickLookOpen, setQuickLookOpen] = useState(false)
  const [detail, setDetail] = useState<ClipDetail | null | undefined>(undefined)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [toast, setToast] = useState<PanelToastState | null>(null)
  const toastTimerRef = useRef<number | undefined>(undefined)
  const hintCloseTimerRef = useRef<number | undefined>(undefined)
  const toastIdRef = useRef(0)
  const [filterRowOpen, setFilterRowOpen] = useState(false)
  const [newPinboardOpen, setNewPinboardOpen] = useState(false)
  const lastDeleteRef = useRef<{ token: string; at: number } | null>(null)

  const dismissToast = useCallback(() => {
    window.clearTimeout(toastTimerRef.current)
    setToast(null)
  }, [])

  const showToast = useEvent((next: Omit<PanelToastState, 'id'>, duration: number = 3200) => {
    window.clearTimeout(toastTimerRef.current)
    toastIdRef.current += 1
    setToast({ ...next, id: toastIdRef.current })
    toastTimerRef.current = window.setTimeout(() => setToast(null), duration)
  })

  /** Bring every piece of transient state back to its default (done when hiding, so the next show is clean). */
  const resetInPlace = useEvent((initialQuery?: string) => {
    window.clearTimeout(toastTimerRef.current)
    window.clearTimeout(hintCloseTimerRef.current)
    setMetaHeld(false)
    setQuickLookOpen(false)
    setDialog(null)
    setToast(null)
    setFilterRowOpen(false)
    setNewPinboardOpen(false)
    lastDeleteRef.current = null
    pendingSelectRef.current = null
    ai.cancel()
    list.resetForShow(initialQuery)
  })

  const enter = useEvent((event?: ClipPanelShowEvent) => {
    showEpochRef.current += 1
    visibleRef.current = true
    setShowEpoch(showEpochRef.current)
    setPanelMeta({ targetAppName: event?.targetAppName, canDirectPaste: event?.canDirectPaste ?? true })
    setNow(Date.now())
    resetInPlace(event?.initialQuery)
    void refreshPinboards()
    void clipboard.getPasteStack().then(setStack, () => undefined)
    focusSearch()
  })

  const requestClose = useEvent(() => {
    if (!visibleRef.current) {
      return
    }

    visibleRef.current = false
    resetInPlace()
    void clipboard.hidePanel()
  })

  const refreshTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const offShow = clipboard.onPanelShow((event) => enter(event))
    const offHide = clipboard.onPanelRequestHide(() => requestClose())
    const offStack = clipboard.onPasteStack(setStack)
    const offChanged = clipboard.onItemsChanged((event) => {
      if (event.reason === 'pinboards') {
        void refreshPinboards()
      }

      if (event.reason === 'deleted') {
        list.removeIds(event.ids)
        ai.removeIds(event.ids)
      }

      if (!visibleRef.current) {
        return
      }

      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = window.setTimeout(() => void list.refresh(), 100)
    })

    return () => {
      offShow()
      offHide()
      offStack()
      offChanged()
      window.clearTimeout(refreshTimerRef.current)
      window.clearTimeout(toastTimerRef.current)
      window.clearTimeout(hintCloseTimerRef.current)
    }
    // Subscriptions only depend on stable handles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipboard])

  // Relative times tick while the panel is open.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (visibleRef.current) {
        setNow(Date.now())
      }
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // Compact mode for a squeezed panel.
  useEffect(() => {
    const element = rootRef.current

    if (!element) {
      return
    }

    const observer = new ResizeObserver(() => setCompact(element.clientHeight < 250))
    observer.observe(element)
    setCompact(element.clientHeight < 250)

    return () => observer.disconnect()
  }, [])

  // Focus the search box whenever the surface is remounted for a new show.
  useEffect(() => {
    focusSearch()
  }, [showEpoch, focusSearch])

  // ---- Quick Look detail ----
  const detailCacheRef = useRef(new Map<string, ClipDetail | null>())
  const activeId = activeItem?.id ?? null
  const activeStamp = activeItem ? `${activeItem.id}:${activeItem.lastCopiedAt}:${activeItem.title}` : ''

  useEffect(() => {
    if (!quickLookOpen || !activeId) {
      return
    }

    const cached = detailCacheRef.current.get(activeStamp)

    if (cached !== undefined) {
      setDetail(cached)
      return
    }

    let cancelled = false
    setDetail(undefined)
    void clipboard
      .getDetail(activeId)
      .then((result) => {
        if (cancelled) {
          return
        }

        detailCacheRef.current.set(activeStamp, result)

        if (detailCacheRef.current.size > 30) {
          const oldest = detailCacheRef.current.keys().next().value

          if (oldest !== undefined) {
            detailCacheRef.current.delete(oldest)
          }
        }

        setDetail(result)
      })
      .catch((error) => console.error('[clipboard-panel] get detail failed', error))

    return () => {
      cancelled = true
    }
  }, [quickLookOpen, activeId, activeStamp, clipboard])

  useEffect(() => {
    if (quickLookOpen && !activeItem) {
      setQuickLookOpen(false)
    }
  }, [quickLookOpen, activeItem])

  // Source apps for the filter row.
  useEffect(() => {
    if (filterRowOpen) {
      void clipboard.listApps().then(setApps, () => undefined)
    }
  }, [filterRowOpen, clipboard])

  // ---- actions ----
  const handlePasteResult = useEvent((result: ClipPasteResult) => {
    if (result.ok && result.action === 'pasted') {
      // The main process already hid the window right before sending ⌘V; only reset the local state.
      visibleRef.current = false
      resetInPlace()
      return
    }

    if (result.action === 'copied') {
      if (!result.reason) {
        requestClose()
        return
      }

      // Copy-only outcome with a reason: show the hint for a moment, then close.
      const epoch = showEpochRef.current
      showToast(
        {
          text: t(`clip.panel.paste.${result.reason}`),
          tone: 'warning',
          actionLabel: result.reason === 'no_permission' ? t('clip.panel.footer.openSettings') : undefined,
          onAction: () => {
            void clipboard.openAccessibilitySettings()
            requestClose()
          },
        },
        COPY_HINT_MS
      )
      window.clearTimeout(hintCloseTimerRef.current)
      hintCloseTimerRef.current = window.setTimeout(() => {
        if (epoch === showEpochRef.current) {
          requestClose()
        }
      }, COPY_HINT_MS)
      return
    }

    if (result.reason === 'not_found') {
      showToast({ text: t('clip.panel.paste.not_found') })
      void list.refresh()
      return
    }

    showToast({ text: t('clip.panel.paste.write_failed'), tone: 'warning' })
  })

  const pasteItems = useEvent(async (targets: ClipListItem[], mode: ClipPasteMode) => {
    if (targets.length === 0) {
      return
    }

    try {
      handlePasteResult(
        await clipboard.paste(
          targets.map((item) => item.id),
          mode
        )
      )
    } catch (error) {
      console.error('[clipboard-panel] paste failed', error)
      showToast({ text: t('clip.panel.paste.write_failed'), tone: 'warning' })
    }
  })

  const copyItems = useEvent(async (targets: ClipListItem[], mode: ClipPasteMode = 'default') => {
    if (targets.length === 0) {
      return
    }

    try {
      const result = await clipboard.copy(
        targets.map((item) => item.id),
        mode
      )

      if (result.ok) {
        requestClose()
      } else {
        showToast({ text: t('clip.panel.paste.write_failed'), tone: 'warning' })
      }
    } catch (error) {
      console.error('[clipboard-panel] copy failed', error)
    }
  })

  const quickPaste = useEvent((position: number, mode: ClipPasteMode) => {
    const visible = firstVisibleRef.current
    const item = position <= visible.count ? cardsRef.current[visible.first + position - 1] : undefined

    if (item) {
      setSelection(singleSelection(item.id))
      void pasteItems([item], mode)
    }
  })

  const undoLastDelete = useEvent(async () => {
    const last = lastDeleteRef.current

    if (!last || Date.now() - last.at > UNDO_WINDOW_MS + 500) {
      return false
    }

    lastDeleteRef.current = null
    dismissToast()

    try {
      const result = await clipboard.undoDelete(last.token)

      if (result.ok && result.restoredIds.length > 0) {
        pendingSelectRef.current = result.restoredIds[0]
        await list.refresh()
      }
    } catch (error) {
      console.error('[clipboard-panel] undo delete failed', error)
    }

    return true
  })

  const removeItems = useEvent(async (targets: ClipListItem[]) => {
    if (targets.length === 0) {
      return
    }

    const ids = targets.map((item) => item.id)
    const deleted = new Set(ids)
    const all = cardsRef.current
    const indexes = all.flatMap((item, index) => (deleted.has(item.id) ? [index] : []))
    const nextItem =
      all.slice(Math.max(...indexes) + 1).find((item) => !deleted.has(item.id)) ??
      all
        .slice(0, Math.min(...indexes))
        .reverse()
        .find((item) => !deleted.has(item.id))

    try {
      const result = await clipboard.remove(ids)

      if (!result.ok) {
        return
      }

      list.removeIds(result.deletedIds)
      ai.removeIds(result.deletedIds)
      setSelection(nextItem ? singleSelection(nextItem.id) : emptySelection)

      if (result.undoToken) {
        lastDeleteRef.current = { token: result.undoToken, at: Date.now() }
        showToast(
          {
            text: t('clip.panel.toast.deleted', { count: result.deletedIds.length }),
            actionLabel: t('clip.panel.toast.undo'),
            onAction: () => void undoLastDelete(),
          },
          UNDO_WINDOW_MS
        )
      }
    } catch (error) {
      console.error('[clipboard-panel] delete failed', error)
    }
  })

  const openItem = useEvent(async (item: ClipListItem | null) => {
    if (!item || !canOpen(item)) {
      return
    }

    try {
      const result = await clipboard.open(item.id)

      if (result.ok) {
        requestClose()
      }
    } catch (error) {
      console.error('[clipboard-panel] open failed', error)
    }
  })

  const revealItem = useEvent(async (item: ClipListItem | null) => {
    if (!item || item.kind !== 'file') {
      return
    }

    try {
      const result = await clipboard.reveal(item.id)

      if (result.ok) {
        requestClose()
      }
    } catch (error) {
      console.error('[clipboard-panel] reveal failed', error)
    }
  })

  const startEdit = useEvent(async (item: ClipListItem | null) => {
    if (!item || !canEditText(item)) {
      return
    }

    setDialog({ type: 'edit', item, text: '', loading: true })

    try {
      const full = await clipboard.getDetail(item.id)
      setDialog((current) =>
        current?.type === 'edit' && current.item.id === item.id
          ? { ...current, text: full?.plainText ?? item.previewText, loading: false }
          : current
      )
    } catch (error) {
      console.error('[clipboard-panel] load text failed', error)
      setDialog(null)
    }
  })

  const toggleItemsInPinboard = useEvent(async (pinboardId: string) => {
    const targets = getTargets()

    if (targets.length === 0) {
      return
    }

    const ids = targets.map((item) => item.id)
    const allIncluded = targets.every((item) => item.pinboardIds.includes(pinboardId))
    const name = pinboards.find((pinboard) => pinboard.id === pinboardId)?.name ?? ''

    try {
      if (allIncluded) {
        await clipboard.removeFromPinboard(pinboardId, ids)
        showToast({ text: t('clip.panel.toast.removedFromPinboard', { name }) })
      } else {
        await clipboard.addToPinboard(pinboardId, ids)
        showToast({ text: t('clip.panel.toast.addedToPinboard', { name }) })
      }

      void refreshPinboards()
      void list.refresh()
    } catch (error) {
      console.error('[clipboard-panel] pinboard update failed', error)
    }
  })

  const dropItemsOnPinboard = useEvent(async (pinboardId: string, ids: string[]) => {
    try {
      await clipboard.addToPinboard(pinboardId, ids)
      const name = pinboards.find((pinboard) => pinboard.id === pinboardId)?.name ?? ''
      showToast({ text: t('clip.panel.toast.addedToPinboard', { name }) })
      void refreshPinboards()
      void list.refresh()
    } catch (error) {
      console.error('[clipboard-panel] drop to pinboard failed', error)
    }
  })

  const selectScope = useEvent((scopeId: string | null) => {
    list.patchFilters({ scopeId })
    focusSearch()
  })

  const switchScope = useEvent((direction: 1 | -1) => {
    const ids: Array<string | null> = [null, ...pinboards.map((pinboard) => pinboard.id)]
    const current = Math.max(0, ids.indexOf(filters.scopeId))
    selectScope(ids[(current + direction + ids.length) % ids.length])
  })

  const createPinboard = useEvent(async (name: string, color: string) => {
    try {
      const created = await clipboard.createPinboard(name, color)
      await refreshPinboards()
      selectScope(created.id)
    } catch (error) {
      console.error('[clipboard-panel] create pinboard failed', error)
    }
  })

  const isPaused = settings.pausedUntil === -1 || settings.pausedUntil > now
  const setPaused = useEvent((choice: PauseChoice | 'resume') => {
    const pausedUntil =
      choice === 'resume' ? 0 : choice === 'forever' ? -1 : Date.now() + (choice === '15m' ? 15 : 60) * 60_000

    setSettings((current) => ({ ...current, pausedUntil }))
    void capability.updateSettings({ clipboard: { pausedUntil } })
  })

  const togglePaused = useEvent(() => setPaused(isPaused ? 'resume' : 'forever'))

  const toggleStack = useEvent(async () => {
    try {
      setStack(await clipboard.togglePasteStack())
    } catch (error) {
      console.error('[clipboard-panel] toggle paste stack failed', error)
    }
  })

  const openSettings = useEvent(() => {
    void windowApi.windowShowRoute('settings')
    requestClose()
  })

  const resizePanel = useEvent((height: number) => void clipboard.setPanelHeight(height))

  // ---- search / filters ----
  const parsed = list.parsed
  const hasQuery = Boolean(filters.text.trim()) || hasActiveFilters(filters)

  const clearQuery = useEvent(() => {
    list.patchFilters({ text: '', kinds: [], appIds: [], datePreset: null })
    ai.cancel()
  })

  const removeToken = useEvent((token: ClipQueryToken) => {
    list.patchFilters({ text: stripTextRange(filters.text, token.start, token.end) })
  })

  const acceptSuggestion = useEvent((token: ClipQueryToken) => {
    const text = stripTextRange(filters.text, token.start, token.end)

    if (token.kind === 'type') {
      const kind = token.value as ClipKind
      list.patchFilters({ text, kinds: filters.kinds.includes(kind) ? filters.kinds : [...filters.kinds, kind] })
    } else if (token.kind === 'app') {
      list.patchFilters({
        text,
        appIds: filters.appIds.includes(token.value) ? filters.appIds : [...filters.appIds, token.value],
      })
    } else if (token.kind === 'date') {
      list.patchFilters({ text, datePreset: token.value as typeof filters.datePreset })
    } else {
      list.patchFilters({ text, scopeId: token.value })
    }
  })

  const uiChips = useMemo<UiFilterChip[]>(() => {
    const chips: UiFilterChip[] = []
    const parsedTypeValues = new Set(
      (parsed?.tokens ?? []).filter((token) => token.kind === 'type').map((token) => token.value)
    )

    filters.kinds.forEach((kind) => {
      if (!parsedTypeValues.has(kind)) {
        chips.push({
          key: `kind:${kind}`,
          kind: 'type',
          value: kind,
          label: t(`clip.panel.kind.${kind}`),
          onRemove: () => list.patchFilters({ kinds: filters.kinds.filter((value) => value !== kind) }),
        })
      }
    })

    filters.appIds.forEach((bundleId) => {
      chips.push({
        key: `app:${bundleId}`,
        kind: 'app',
        value: bundleId,
        label: apps.find((app) => app.bundleId === bundleId)?.name ?? bundleId,
        onRemove: () => list.patchFilters({ appIds: filters.appIds.filter((value) => value !== bundleId) }),
      })
    })

    if (filters.datePreset) {
      chips.push({
        key: `date:${filters.datePreset}`,
        kind: 'date',
        value: filters.datePreset,
        label: t(`clip.panel.date.${filters.datePreset}`),
        onRemove: () => list.patchFilters({ datePreset: null }),
      })
    }

    return chips
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.kinds, filters.appIds, filters.datePreset, parsed, apps, t])

  // ---- keyboard ----
  const hasTextSelection = () => {
    const input = searchRef.current

    if (document.activeElement === input && input && input.selectionStart !== input.selectionEnd) {
      return true
    }

    return Boolean(window.getSelection()?.toString())
  }

  const handleKeyDown = useEvent((event: KeyboardEvent) => {
    if (event.key === 'Meta') {
      setMetaHeld(true)
      return
    }

    if (event.isComposing || event.keyCode === 229) {
      return
    }

    if (!visibleRef.current || event.defaultPrevented) {
      return
    }

    // Dialogs, menus and popovers own the keyboard while they are open.
    if (dialog || document.querySelector(CLOSE_OVERLAY_SELECTOR)) {
      return
    }

    const input = searchRef.current
    const inSearch = document.activeElement === input
    const searchHasText = Boolean(input?.value)

    if (!inSearch && isEditableTarget(event.target)) {
      return
    }

    const { key, metaKey: meta, shiftKey: shift, ctrlKey: ctrl, altKey: alt } = event
    const digit = /^Digit([1-9])$/.exec(event.code)?.[1]
    const handled = () => event.preventDefault()

    if (key === 'Escape') {
      handled()

      if (quickLookOpen) {
        setQuickLookOpen(false)
      } else if (hasQuery) {
        clearQuery()
      } else {
        requestClose()
      }

      return
    }

    if (meta && !ctrl && !alt) {
      if (digit) {
        handled()
        quickPaste(Number(digit), shift ? 'plainText' : 'default')
        return
      }

      switch (key.toLowerCase()) {
        case 'f':
          handled()

          if (inSearch) {
            setFilterRowOpen((open) => !open)
          } else {
            focusSearch()
          }

          return
        case 'a':
          if (inSearch && searchHasText) {
            return
          }

          handled()
          setSelection((current) => selectAllItems(cardsRef.current, current))
          return
        case 'c':
          if (shift) {
            handled()
            void toggleStack()
            return
          }

          if (hasTextSelection()) {
            return
          }

          handled()
          void copyItems(getTargets())
          return
        case 'o':
          handled()
          void openItem(getTargets()[0] ?? null)
          return
        case 'r': {
          handled()
          const target = getTargets()[0]

          if (target) {
            setDialog({ type: 'rename', item: target })
          }

          return
        }
        case 'e':
          handled()
          void startEdit(getTargets()[0] ?? null)
          return
        case 'n':
          handled()

          if (shift) {
            setNewPinboardOpen(true)
          } else {
            setDialog({ type: 'newText' })
          }

          return
        case 'z':
          if (shift) {
            return
          }

          if (lastDeleteRef.current) {
            handled()
            void undoLastDelete()
          }

          return
        case 't':
          handled()
          togglePaused()
          return
        case 'enter':
          handled()

          if (aiEnabled) {
            void ai.run()
          }

          return
        case 'arrowup':
          handled()
          setSelection((current) => moveSelection(cardsRef.current, current, 'first', false))
          return
        case 'arrowdown':
          handled()
          setSelection((current) => moveSelection(cardsRef.current, current, 'last', false))
          return
        case 'arrowleft':
          handled()
          switchScope(-1)
          return
        case 'arrowright':
          handled()
          switchScope(1)
          return
        case 'backspace':
          if (inSearch && searchHasText) {
            return
          }

          handled()
          void removeItems(getTargets())
          return
        default:
          return
      }
    }

    if (meta || ctrl || alt) {
      return
    }

    switch (key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const forward = key === 'ArrowRight'

        if (inSearch && searchHasText && input) {
          const { selectionStart, selectionEnd, value } = input
          const collapsed = selectionStart === selectionEnd
          const atEdge = forward ? selectionEnd === value.length : selectionStart === 0

          // Let the caret move inside the text; only jump to cards at the edge.
          if (shift || !collapsed || !atEdge) {
            return
          }
        }

        handled()
        setSelection((current) => moveSelection(cardsRef.current, current, forward ? 'next' : 'prev', shift))
        return
      }
      case 'ArrowDown':
        if (inSearch) {
          handled()
          focusResults()
        }

        return
      case 'ArrowUp':
        if (!inSearch) {
          handled()
          focusSearch()
        }

        return
      case 'Enter':
        handled()
        void pasteItems(getTargets(), shift ? 'plainText' : 'default')
        return
      case 'Tab':
        handled()

        if (inSearch) {
          focusResults()
        } else {
          focusSearch()
        }

        return
      case ' ':
        if (inSearch && searchHasText) {
          return
        }

        handled()
        setQuickLookOpen((open) => !open)
        return
      case 'Backspace':
      case 'Delete':
        if (inSearch && searchHasText) {
          return
        }

        handled()
        void removeItems(getTargets())
        return
      default:
        // Typing anywhere goes to the search box.
        if (key.length === 1 && !inSearch) {
          focusSearch()
        }
    }
  })

  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta') {
        setMetaHeld(false)
      }
    }
    const onBlur = () => setMetaHeld(false)

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [handleKeyDown])

  // ---- card interactions ----
  const handleCardClick = useEvent((event: React.MouseEvent, item: ClipListItem) => {
    setSelection((current) =>
      clickSelection(cardsRef.current, current, item.id, { meta: event.metaKey, shift: event.shiftKey })
    )
  })

  const handleCardDoubleClick = useEvent((item: ClipListItem) => {
    const selected = new Set(selectionRef.current.ids)
    const targets = selected.size > 1 && selected.has(item.id) ? getTargets() : [item]
    void pasteItems(targets, 'default')
  })

  const handleCardContextMenu = useEvent((item: ClipListItem) => {
    if (!selectionRef.current.ids.includes(item.id)) {
      setSelection(singleSelection(item.id))
    }
  })

  const handleCardDragStart = useEvent((event: React.DragEvent, item: ClipListItem) => {
    if (item.kind === 'image' || item.kind === 'file') {
      event.preventDefault()
      void clipboard.startDrag(item.id)
      return
    }

    const ids = selectionRef.current.ids.includes(item.id) ? getTargets().map((target) => target.id) : [item.id]
    event.dataTransfer.setData(CLIP_DRAG_TYPE, JSON.stringify(ids))
    event.dataTransfer.setData('text/plain', item.previewText)
    event.dataTransfer.effectAllowed = 'copyMove'
  })

  const menuTargets = getTargets()
  const actionsValue: PanelActionsValue = {
    t,
    targets: menuTargets,
    pinboards,
    paste: (mode) => void pasteItems(getTargets(), mode),
    copy: () => void copyItems(getTargets()),
    preview: () => setQuickLookOpen(true),
    rename: () => {
      const target = getTargets()[0]

      if (target) {
        setDialog({ type: 'rename', item: target })
      }
    },
    edit: () => void startEdit(getTargets()[0] ?? null),
    open: () => void openItem(getTargets()[0] ?? null),
    reveal: () => void revealItem(getTargets()[0] ?? null),
    remove: () => void removeItems(getTargets()),
    togglePinboard: (pinboardId) => void toggleItemsInPinboard(pinboardId),
    newPinboard: () => setNewPinboardOpen(true),
    restoreFocus: focusSearch,
  }

  // ---- dialogs ----
  const closeDialog = useEvent(() => {
    setDialog(null)
    focusSearch()
  })

  const pausedLabel =
    settings.pausedUntil === -1
      ? t('clip.panel.pause.pausedForever')
      : t('clip.panel.pause.pausedUntil', {
          time: new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          }).format(settings.pausedUntil),
        })

  // Rotating hints in the search box replace the old footer bar.
  const placeholders = useMemo(() => {
    const hints = [
      t('clip.panel.search.placeholder'),
      panelMeta.canDirectPaste
        ? panelMeta.targetAppName
          ? t('clip.panel.hint.pasteTo', { app: panelMeta.targetAppName })
          : t('clip.panel.hint.pasteFront')
        : t('clip.panel.hint.copyOnly'),
      t('clip.panel.hint.plain'),
      t('clip.panel.hint.preview'),
      t('clip.panel.hint.quickPaste'),
      t('clip.panel.hint.filters'),
    ]

    if (aiEnabled) {
      hints.push(t('clip.panel.hint.ai'))
    }

    return hints
  }, [t, panelMeta.canDirectPaste, panelMeta.targetAppName, aiEnabled])

  const countLabel =
    selection.ids.length > 1
      ? t('clip.panel.count.selected', { count: selection.ids.length })
      : t(list.nextCursor ? 'clip.panel.count.more' : 'clip.panel.count.total', { count: cards.length })

  // "AI found nothing" is a quiet, transient note.
  useEffect(() => {
    if (ai.state.status === 'none' && ai.state.reason === 'no_match') {
      showToast({ text: t('clip.panel.ai.noMatch') }, 2200)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.state.status, ai.state.reason])

  return (
    <PanelActionsContext.Provider value={actionsValue}>
      <div ref={rootRef} className="cp-root" data-compact={compact || undefined}>
        <div className="cp-content">
          <div className="cp-strip">
            <ResizeHandle onResize={resizePanel} />

            <TopBar
              t={t}
              search={{
                inputRef: searchRef,
                text: filters.text,
                placeholders,
                resetKey: showEpoch,
                tokens: parsed?.tokens ?? [],
                suggestions: parsed?.suggestions ?? [],
                uiChips,
                t,
                onTextChange: (text) => list.patchFilters({ text }),
                onCompositionChange: list.setComposing,
                onRemoveToken: removeToken,
                onAcceptSuggestion: acceptSuggestion,
              }}
              tabs={{
                pinboards,
                scopeId: filters.scopeId,
                t,
                newOpen: newPinboardOpen,
                onNewOpenChange: setNewPinboardOpen,
                onSelect: selectScope,
                onCreate: (name, color) => void createPinboard(name, color),
                onRename: (pinboard) => setDialog({ type: 'pinboardRename', pinboard }),
                onRecolor: (pinboard, color) => {
                  void clipboard.updatePinboard(pinboard.id, { color }).then(refreshPinboards)
                },
                onDelete: (pinboard) => setDialog({ type: 'pinboardDelete', pinboard }),
                onDropItems: (pinboardId, ids) => void dropItemsOnPinboard(pinboardId, ids),
                restoreFocus: focusSearch,
              }}
              kinds={filters.kinds}
              onKindChange={(kind) => list.patchFilters({ kinds: kind ? [kind] : [] })}
              filterRowOpen={filterRowOpen}
              onToggleFilterRow={() => setFilterRowOpen((open) => !open)}
              ai={{
                enabled: aiEnabled,
                status: ai.state.status,
                dismissed: ai.dismissed,
                canRun: Boolean(filters.text.trim()),
                onRun: () => void ai.run(),
                onToggleDismissed: () => ai.setDismissed((value) => !value),
              }}
              paused={isPaused}
              pausedLabel={pausedLabel}
              onResume={() => setPaused('resume')}
              onPause={setPaused}
              stackActive={stack.active}
              countLabel={countLabel}
              countHighlighted={selection.ids.length > 1}
              stackIndicator={<PasteStackIndicator t={t} state={stack} onStop={() => void toggleStack()} />}
              onToggleStack={() => void toggleStack()}
              onOpenSettings={openSettings}
              restoreFocus={focusSearch}
            />

            {filterRowOpen ? (
              <FilterRow
                t={t}
                apps={apps}
                appIds={filters.appIds}
                datePreset={filters.datePreset}
                onToggleApp={(bundleId) =>
                  list.patchFilters({
                    appIds: filters.appIds.includes(bundleId)
                      ? filters.appIds.filter((value) => value !== bundleId)
                      : [...filters.appIds, bundleId],
                  })
                }
                onDateChange={(datePreset) => list.patchFilters({ datePreset })}
              />
            ) : null}

            <div className="cp-main">
              <CardStrip
                ref={stripRef}
                entries={entries}
                activeId={selection.activeId}
                selectedIds={selectedIds}
                metaHeld={metaHeld}
                now={now}
                language={language}
                t={t}
                pinboardColors={pinboardColors}
                loading={list.loading}
                hasQuery={hasQuery}
                hasMore={Boolean(list.nextCursor)}
                loadingMore={list.loadingMore}
                scrollResetKey={list.resetToken + (aiReady ? 1 : 0)}
                firstVisibleRef={firstVisibleRef}
                onLoadMore={list.loadMore}
                onCardClick={handleCardClick}
                onCardDoubleClick={handleCardDoubleClick}
                onCardContextMenu={handleCardContextMenu}
                onCardDragStart={handleCardDragStart}
              />
              <PanelToast toast={toast} onDismiss={dismissToast} />
            </div>

            {quickLookOpen && activeItem ? (
              <QuickLook
                key={activeItem.id}
                item={activeItem}
                detail={detail}
                language={language}
                t={t}
                onClose={() => setQuickLookOpen(false)}
                onPaste={() => void pasteItems([activeItem], 'default')}
                onOpen={() => void openItem(activeItem)}
                onNotify={(text) => showToast({ text })}
              />
            ) : null}
          </div>
        </div>
      </div>

      <NameDialog
        open={dialog?.type === 'rename'}
        t={t}
        title={t('clip.panel.dialog.renameTitle')}
        description={t('clip.panel.dialog.renameHint')}
        initialValue={dialog?.type === 'rename' ? (dialog.item.customTitle ?? '') : ''}
        placeholder={dialog?.type === 'rename' ? dialog.item.title : undefined}
        allowEmpty
        onClose={closeDialog}
        onSubmit={(value) => {
          if (dialog?.type !== 'rename') {
            return
          }

          const { item } = dialog
          closeDialog()
          void clipboard
            .rename(item.id, value || null)
            .then((updated) => (updated ? list.patchItem(updated) : list.refresh()))
        }}
      />

      <TextDialog
        open={dialog?.type === 'edit'}
        t={t}
        title={t('clip.panel.dialog.editTitle')}
        initialValue={dialog?.type === 'edit' ? dialog.text : ''}
        loading={dialog?.type === 'edit' ? dialog.loading : false}
        onClose={closeDialog}
        onSubmit={(value) => {
          if (dialog?.type !== 'edit') {
            return
          }

          const { item } = dialog
          closeDialog()
          void clipboard.updateText(item.id, value).then(() => list.refresh())
        }}
      />

      <TextDialog
        open={dialog?.type === 'newText'}
        t={t}
        title={t('clip.panel.dialog.newTextTitle')}
        initialValue=""
        onClose={closeDialog}
        onSubmit={(value) => {
          closeDialog()
          void clipboard.createText(value).then((created) => {
            pendingSelectRef.current = created.id
            return list.refresh()
          })
        }}
      />

      <NameDialog
        open={dialog?.type === 'pinboardRename'}
        t={t}
        title={t('clip.panel.pinboard.rename')}
        initialValue={dialog?.type === 'pinboardRename' ? dialog.pinboard.name : ''}
        onClose={closeDialog}
        onSubmit={(value) => {
          if (dialog?.type !== 'pinboardRename') {
            return
          }

          const { pinboard } = dialog
          closeDialog()
          void clipboard.updatePinboard(pinboard.id, { name: value }).then(refreshPinboards)
        }}
      />

      <ConfirmDialog
        open={dialog?.type === 'pinboardDelete'}
        t={t}
        title={t('clip.panel.pinboard.deleteTitle')}
        description={
          dialog?.type === 'pinboardDelete' ? t('clip.panel.pinboard.deleteHint', { name: dialog.pinboard.name }) : ''
        }
        confirmLabel={t('clip.panel.pinboard.delete')}
        onClose={closeDialog}
        onConfirm={() => {
          if (dialog?.type !== 'pinboardDelete') {
            return
          }

          const { pinboard } = dialog
          closeDialog()
          void clipboard.deletePinboard(pinboard.id).then(async () => {
            if (filters.scopeId === pinboard.id) {
              list.patchFilters({ scopeId: null })
            }

            await refreshPinboards()
            void list.refresh()
          })
        }}
      />
    </PanelActionsContext.Provider>
  )
}
