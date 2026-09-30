import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CalendarClock, CheckCircle2, Inbox, Plus, Sun, Timer } from 'lucide-react'
import { EditTaskDialog, type TaskEdit } from '@/app/components/todo-focus/EditTaskDialog'
import { FocusCard } from '@/app/components/todo-focus/FocusCard'
import { FocusSettingsPopover } from '@/app/components/todo-focus/FocusSettingsPopover'
import { TaskRow, type TaskMenuAction } from '@/app/components/todo-focus/TaskRow'
import {
  buildGroups,
  formatDay,
  formatDue,
  isOverdue,
  tagHue,
  todoViews,
  viewCounts,
  type TodoView,
} from '@/app/components/todo-focus/todo-model'
import { useTodoFocus } from '@/app/components/todo-focus/use-todo-focus'
import type { AppLanguage } from '@/lib/capability/types'
import { addDays, toDayKey } from '@/lib/todo-focus/dates'
import { todoT, type TodoI18nKey } from '@/lib/todo-focus/i18n'
import { parseQuickAdd } from '@/lib/todo-focus/parse'
import type { TodoPriority, TodoTask } from '@/lib/todo-focus/types'
import { cn } from '@/lib/utils'
import './todo-focus.css'

type TodoFocusPanelProps = {
  query: string
  trigger: string
  setQuery: (nextQuery: string) => void
  language: AppLanguage
}

type Toast = { id: number; message: string; actionLabel?: string; onAction?: () => void }

const VIEW_ICONS = { today: Sun, upcoming: CalendarClock, inbox: Inbox, done: CheckCircle2 } as const
const LINGER_MS = 900
const TOAST_MS = 4000

// Deferred: Radix restores focus when a menu / dialog closes, after our close handler runs.
const focusLauncherInput = () =>
  window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.ms-input')?.focus())

/** Re-renders every minute so "overdue" and day labels stay correct while the panel is open. */
const useMinuteClock = () => {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === 'TEXTAREA' ||
    (target.tagName === 'INPUT' && !target.classList.contains('ms-input')))

export function TodoFocusPanel({ query, trigger, setQuery, language }: TodoFocusPanelProps) {
  const t = useCallback(
    (key: TodoI18nKey, params?: Record<string, string | number>) => todoT(language, key, params),
    [language]
  )
  const { todo, tasks, focus } = useTodoFocus()
  const now = useMinuteClock()
  const [view, setView] = useState<TodoView>('today')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [editing, setEditing] = useState<TodoTask | null>(null)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [lingering, setLingering] = useState<ReadonlySet<string>>(new Set())
  const [toast, setToast] = useState<Toast | null>(null)
  const [inlineDraft, setInlineDraft] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  const draft = query.trim()
  const parsed = useMemo(() => parseQuickAdd(query, now), [query, now])
  const todayKey = toDayKey(now)
  const groups = useMemo(
    () => buildGroups(tasks ?? [], view, now, language, lingering),
    [tasks, view, now, language, lingering]
  )
  const flat = useMemo(() => groups.flatMap((group) => group.tasks), [groups])
  const counts = useMemo(() => viewCounts(tasks ?? [], now), [tasks, now])
  const selected = flat.find((task) => task.id === selectedId) ?? null
  const focusActive = Boolean(focus && focus.phase !== 'idle')

  // Keep a valid selection: same task if still visible, else the neighbour of where it was.
  const lastIndex = useRef(0)
  useEffect(() => {
    if (!flat.length) {
      if (selectedId) setSelectedId(null)
      return
    }
    const index = flat.findIndex((task) => task.id === selectedId)
    if (index >= 0) {
      lastIndex.current = index
      return
    }
    setSelectedId(flat[Math.min(lastIndex.current, flat.length - 1)].id)
  }, [flat, selectedId])

  useEffect(() => {
    if (selectedId) document.querySelector(`[data-task-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const showToast = useCallback((next: Omit<Toast, 'id'>) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToast({ ...next, id: Date.now() })
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }, [])
  useEffect(() => () => void (toastTimer.current && window.clearTimeout(toastTimer.current)), [])

  const viewOf = (task: Pick<TodoTask, 'dueDate'>): TodoView =>
    !task.dueDate ? 'inbox' : task.dueDate <= todayKey ? 'today' : 'upcoming'

  // ---- actions ----
  const addTask = async (text: string, source: 'launcher' | 'inline') => {
    const result = parseQuickAdd(text, new Date())
    if (!result.title) return
    const dueDate = result.dueDate ?? (view === 'today' ? todayKey : undefined)
    const created = await todo.create({
      title: result.title,
      dueDate,
      dueTime: result.dueTime,
      priority: result.priority,
      tags: result.tags,
      estimate: result.estimate,
    })
    if (source === 'launcher') setQuery(`${trigger} `)
    else setInlineDraft('')
    const target = viewOf(created)
    const visibleHere = target === view || (view === 'upcoming' && target === 'today')
    if (visibleHere) {
      setSelectedId(created.id)
    } else {
      showToast({
        message: t('toast.added', { view: t(`view.${target}`) }),
        actionLabel: t('toast.show'),
        onAction: () => {
          setView(target)
          setSelectedId(created.id)
        },
      })
    }
  }

  const closeInline = () => {
    setInlineDraft(null)
    focusLauncherInput()
  }

  const toggleDone = useCallback(
    (task: TodoTask) => {
      const done = !task.done
      if (done) {
        setLingering((current) => new Set(current).add(task.id))
        window.setTimeout(() => {
          setLingering((current) => {
            const next = new Set(current)
            next.delete(task.id)
            return next
          })
        }, LINGER_MS)
      }
      void todo.update(task.id, { done })
    },
    [todo]
  )

  const startFocus = useCallback(
    (task: TodoTask) => {
      if (focus && focus.phase === 'focus' && focus.taskId === task.id) {
        void (focus.paused ? todo.resumeFocus() : todo.pauseFocus())
        return
      }
      void todo.startFocus(task.id)
    },
    [focus, todo]
  )

  const removeTask = async (task: TodoTask) => {
    const removed = await todo.remove(task.id)
    if (!removed) return
    showToast({
      message: t('toast.deleted', { task: removed.title }),
      actionLabel: t('action.undo'),
      onAction: () => void todo.restore(removed).then((restored) => setSelectedId(restored.id)),
    })
  }

  const setDue = (task: TodoTask, dueDate: string | null) => void todo.update(task.id, { dueDate })

  const saveEdit = (task: TodoTask, edit: TaskEdit) => {
    void todo.update(task.id, {
      title: edit.title,
      notes: edit.notes,
      dueDate: edit.dueDate,
      dueTime: edit.dueTime,
      priority: edit.priority,
      tags: edit.tags,
      estimate: edit.estimate,
    })
    setEditing(null)
    focusLauncherInput()
  }

  const menuActions = (task: TodoTask): TaskMenuAction[] => {
    const tomorrow = toDayKey(addDays(now, 1))
    const actions: TaskMenuAction[] = []
    if (!task.done)
      actions.push({ type: 'item', label: t('action.startFocus'), shortcut: '↩', onSelect: () => startFocus(task) })
    actions.push(
      {
        type: 'item',
        label: t(task.done ? 'action.uncomplete' : 'action.complete'),
        shortcut: '⌘↩',
        onSelect: () => toggleDone(task),
      },
      { type: 'separator' },
      { type: 'item', label: t('action.edit'), shortcut: '⌘E', onSelect: () => setEditing(task) }
    )
    if (task.dueDate !== todayKey)
      actions.push({ type: 'item', label: t('action.today'), shortcut: '⌘T', onSelect: () => setDue(task, todayKey) })
    if (task.dueDate !== tomorrow) {
      actions.push({
        type: 'item',
        label: t('action.tomorrow'),
        shortcut: '⇧⌘T',
        onSelect: () => setDue(task, tomorrow),
      })
    }
    if (task.dueDate) actions.push({ type: 'item', label: t('action.clearDate'), onSelect: () => setDue(task, null) })
    actions.push(
      {
        type: 'submenu',
        label: t('action.priority'),
        items: ([3, 2, 1, 0] as TodoPriority[]).map((priority) => ({
          label: priority ? t(`priority.${priority}` as TodoI18nKey) : t('priority.none'),
          checked: task.priority === priority,
          onSelect: () => void todo.update(task.id, { priority }),
        })),
      },
      { type: 'separator' },
      {
        type: 'item',
        label: t('action.delete'),
        shortcut: '⌘⌫',
        destructive: true,
        onSelect: () => void removeTask(task),
      }
    )
    return actions
  }

  const moveSelection = (delta: number) => {
    if (!flat.length) return
    const index = flat.findIndex((task) => task.id === selectedId)
    const next = index < 0 ? 0 : Math.min(flat.length - 1, Math.max(0, index + delta))
    setSelectedId(flat[next].id)
  }

  const togglePause = () => {
    if (!focusActive || !focus) return
    void (focus.paused ? todo.resumeFocus() : todo.pauseFocus())
  }

  // ---- keyboard (focus stays in the launcher search field) ----
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined)
  keyHandler.current = (event: KeyboardEvent) => {
    if (event.isComposing || editing || menuFor || popoverOpen || isTextField(event.target)) return
    const meta = event.metaKey || event.ctrlKey
    const handled = () => {
      event.preventDefault()
      event.stopPropagation()
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      handled()
      moveSelection(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (meta && /^[1-4]$/.test(event.key)) {
      handled()
      setView(todoViews[Number(event.key) - 1])
      return
    }
    if (meta && event.key.toLowerCase() === 'p' && focusActive) {
      handled()
      togglePause()
      return
    }
    if (event.key === 'Enter' && !meta && !event.shiftKey && !event.altKey) {
      handled()
      if (draft) void addTask(query, 'launcher')
      else if (selected && !selected.done) startFocus(selected)
      return
    }

    // Row commands only when the search field is empty, so ⌘⌫ etc. keep editing text there.
    if (draft || !selected || !meta) return
    if (event.key === 'Enter') {
      handled()
      toggleDone(selected)
    } else if (event.key.toLowerCase() === 'e') {
      handled()
      setEditing(selected)
    } else if (event.key.toLowerCase() === 'k') {
      handled()
      setMenuFor(selected.id)
    } else if (event.key === 'Backspace') {
      handled()
      void removeTask(selected)
    } else if (event.key.toLowerCase() === 't') {
      handled()
      setDue(selected, event.shiftKey ? toDayKey(addDays(now, 1)) : todayKey)
    }
  }
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event)
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [])

  const onMenuOpenChange = useCallback((id: string, open: boolean) => {
    setMenuFor(open ? id : null)
    if (open) setSelectedId(id)
    else focusLauncherInput()
  }, [])

  // ---- render ----
  const tokenLabel = (kind: string, value: string) => {
    if (kind === 'date') return formatDay(language, value, now)
    if (kind === 'tag') return `#${value}`
    if (kind === 'priority') return `!${value}`
    if (kind === 'estimate') return t('compose.estimate', { count: value })
    return value
  }

  const hints: Array<[string, string]> =
    inlineDraft !== null
      ? [
          ['↩', t('hint.addTask')],
          ['esc', t('hint.cancel')],
        ]
      : draft
        ? [['↩', t('hint.addTask')]]
        : selected
          ? [
              ...(!selected.done ? ([['↩', t('hint.startFocus')]] as Array<[string, string]>) : []),
              ['⌘↩', t('hint.complete')],
              ['⌘E', t('hint.edit')],
              ['⌘K', t('hint.more')],
            ]
          : []
  if (inlineDraft === null) {
    if (focusActive && focus) hints.push(['⌘P', t(focus.paused ? 'hint.resume' : 'hint.pause')])
    hints.push(['⌘1–4', t('hint.views')])
  }

  const emptyKeys: Record<TodoView, [TodoI18nKey, TodoI18nKey]> = {
    today: ['empty.today', 'empty.todayHint'],
    upcoming: ['empty.upcoming', 'empty.upcomingHint'],
    inbox: ['empty.inbox', 'empty.inboxHint'],
    done: ['empty.done', 'empty.doneHint'],
  }
  const EmptyIcon = VIEW_ICONS[view]

  return (
    <div className="tf-panel">
      <header className="tf-header">
        <div className="tf-views" role="tablist">
          {todoViews.map((id) => {
            const Icon = VIEW_ICONS[id]
            const count = id === 'today' ? counts.today : id === 'inbox' ? counts.inbox : 0
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                className={cn('tf-view', view === id && 'is-active')}
                onClick={() => setView(id)}
              >
                <Icon size={14} className={`tf-view-icon is-${id}`} />
                {t(`view.${id}`)}
                {count ? <span className="tf-view-count">{count}</span> : null}
              </button>
            )
          })}
        </div>
        <div className="tf-header-right">
          {focus ? (
            <span className="tf-stats">
              {t('stats.today', { minutes: focus.today.focusMinutes, pomodoros: focus.today.pomodoros })}
            </span>
          ) : null}
          {!focusActive ? (
            <button
              type="button"
              className="tf-icon-button"
              title={t('focus.startFree')}
              onClick={() => void todo.startFocus()}
            >
              <Timer size={14} />
            </button>
          ) : null}
          {focus ? (
            <FocusSettingsPopover
              settings={focus.settings}
              language={language}
              onChange={(patch) => void todo.updateFocusSettings(patch)}
              onPreviewCelebration={() => void todo.previewOverlay()}
              onOpenChange={(open) => {
                setPopoverOpen(open)
                if (!open) focusLauncherInput()
              }}
            />
          ) : null}
        </div>
      </header>

      {focus && focusActive ? (
        <FocusCard
          focus={focus}
          language={language}
          onPause={() => void todo.pauseFocus()}
          onResume={() => void todo.resumeFocus()}
          onStop={() => void todo.stopFocus()}
          onSkipBreak={() => void todo.skipBreak()}
          onCompleteTask={() => void todo.completeFocusTask()}
        />
      ) : null}

      <div className="tf-list">
        {draft ? (
          <div className="tf-compose">
            <Plus size={16} className="tf-compose-icon" />
            <span className={cn('tf-compose-title', !parsed.title && 'is-placeholder')}>
              {parsed.title || t('compose.placeholderTitle')}
            </span>
            <span className="tf-compose-tokens">
              {parsed.tokens.map((token) => (
                <span
                  key={`${token.kind}-${token.start}`}
                  className={cn('tf-token', `is-${token.kind}`)}
                  style={token.kind === 'tag' ? ({ '--tf-tag-hue': tagHue(token.value) } as CSSProperties) : undefined}
                >
                  {tokenLabel(token.kind, token.value)}
                </span>
              ))}
              {!parsed.tokens.some((token) => token.kind === 'date') && view === 'today' && parsed.title ? (
                <span className="tf-token is-date is-implicit">{t('day.today')}</span>
              ) : null}
            </span>
            <kbd className="tf-kbd">↩ {t('compose.add')}</kbd>
          </div>
        ) : null}

        {tasks === null ? null : flat.length ? (
          groups.map((group) => (
            <section key={group.key} className="tf-group">
              {group.label ? (
                <div className={cn('tf-group-label', group.tone && `is-${group.tone}`)}>{group.label}</div>
              ) : null}
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={task.id === selectedId}
                  focused={focusActive && focus?.taskId === task.id}
                  dueLabel={formatDue(language, task, now, view)}
                  overdue={isOverdue(task, now)}
                  menuOpen={menuFor === task.id}
                  actions={menuActions(task)}
                  startFocusLabel={t('action.startFocus')}
                  moreLabel={t('action.more')}
                  onSelect={setSelectedId}
                  onToggle={toggleDone}
                  onStartFocus={startFocus}
                  onEdit={setEditing}
                  onMenuOpenChange={onMenuOpenChange}
                />
              ))}
            </section>
          ))
        ) : !draft ? (
          <div className="tf-empty">
            <EmptyIcon size={28} />
            <div className="tf-empty-title">{t(emptyKeys[view][0])}</div>
            <div className="tf-empty-hint">{view === 'today' ? t('compose.hint') : t(emptyKeys[view][1])}</div>
          </div>
        ) : null}

        {tasks !== null && view !== 'done' && !draft ? (
          inlineDraft === null ? (
            <button type="button" className="tf-add-row" onClick={() => setInlineDraft('')}>
              <Plus size={14} />
              <span>{t('compose.new')}</span>
              <span className="tf-add-hint">{t('compose.inlineHint')}</span>
            </button>
          ) : (
            <div className="tf-add-row is-editing">
              <span className="tf-check" />
              <input
                className="tf-add-input"
                autoFocus
                value={inlineDraft}
                placeholder={t('compose.inlinePlaceholder')}
                onChange={(event) => setInlineDraft(event.target.value)}
                onBlur={() => {
                  if (!inlineDraft.trim()) closeInline()
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (inlineDraft.trim()) void addTask(inlineDraft, 'inline')
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    closeInline()
                  }
                }}
              />
              <span className="tf-compose-tokens">
                {parseQuickAdd(inlineDraft, now).tokens.map((token) => (
                  <span
                    key={`${token.kind}-${token.start}`}
                    className={cn('tf-token', `is-${token.kind}`)}
                    style={
                      token.kind === 'tag' ? ({ '--tf-tag-hue': tagHue(token.value) } as CSSProperties) : undefined
                    }
                  >
                    {tokenLabel(token.kind, token.value)}
                  </span>
                ))}
              </span>
            </div>
          )
        ) : null}
      </div>

      <footer className="tf-footer">
        {hints.map(([key, label]) => (
          <span key={key} className="tf-hint">
            <kbd>{key}</kbd>
            {label}
          </span>
        ))}
      </footer>

      {toast ? (
        <div className="tf-toast" key={toast.id}>
          <span>{toast.message}</span>
          {toast.actionLabel && toast.onAction ? (
            <button
              type="button"
              onClick={() => {
                toast.onAction?.()
                setToast(null)
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      <EditTaskDialog
        task={editing}
        language={language}
        onCancel={() => {
          setEditing(null)
          focusLauncherInput()
        }}
        onSave={saveEdit}
      />
    </div>
  )
}
