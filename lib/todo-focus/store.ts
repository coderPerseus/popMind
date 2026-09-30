// Todo + focus persistence (main process). One JSON file, loaded lazily, written atomically (tmp + rename) with a
// short debounce so rapid edits coalesce.
import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mainLogger } from '@/lib/main/logger'
import { isValidTime, toDayKey } from '@/lib/todo-focus/dates'
import {
  defaultFocusSettings,
  type FocusSession,
  type FocusSettings,
  type LegacyTodo,
  type TodoPriority,
  type TodoSnapshot,
  type TodoTask,
  type TodoTaskDraft,
  type TodoTaskPatch,
} from '@/lib/todo-focus/types'

export const TodoChannel = {
  /** TodoSnapshot, after any task change. */
  State: 'todo:state',
  /** FocusState, on every focus state change (not every second). */
  Focus: 'todo:focus',
  /** FocusCelebration, to the full-screen overlay window. */
  Celebrate: 'todo:celebrate',
} as const

type TodoFile = {
  version: 1
  tasks: TodoTask[]
  sessions: FocusSession[]
  settings: FocusSettings
  legacyImported: boolean
}

const SAVE_DEBOUNCE_MS = 200
const SESSION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const MAX_TITLE_LENGTH = 500

const clampPriority = (value: unknown): TodoPriority => (value === 1 || value === 2 || value === 3 ? value : 0)

const normalizeTags = (tags: unknown) => {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags) {
    const tag = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase())
      result.push(tag)
    }
  }
  return result
}

const normalizeDay = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined

const normalizeTime = (value: unknown) => (typeof value === 'string' && isValidTime(value) ? value : undefined)

const normalizeEstimate = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), 99) : undefined

class TodoStore {
  private data: TodoFile | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private listeners = new Set<(snapshot: TodoSnapshot) => void>()

  private get filePath() {
    return join(app.getPath('userData'), 'todo-focus.json')
  }

  private load(): TodoFile {
    if (this.data) return this.data

    const empty: TodoFile = {
      version: 1,
      tasks: [],
      sessions: [],
      settings: { ...defaultFocusSettings },
      legacyImported: false,
    }

    try {
      if (existsSync(this.filePath)) {
        const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<TodoFile>
        this.data = {
          ...empty,
          ...parsed,
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
          sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
          settings: { ...defaultFocusSettings, ...parsed.settings },
        }
        return this.data
      }
    } catch (error) {
      // Keep the broken file for inspection and start fresh rather than refusing to work.
      mainLogger.error('[todo] failed to read store, starting empty', error)
      try {
        renameSync(this.filePath, `${this.filePath}.broken-${Date.now()}`)
      } catch {
        // ignore
      }
    }

    this.data = empty
    return this.data
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS)
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.data) return

    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      const tmpPath = `${this.filePath}.tmp`
      writeFileSync(tmpPath, JSON.stringify(this.data), 'utf-8')
      renameSync(tmpPath, this.filePath)
    } catch (error) {
      mainLogger.error('[todo] failed to save store', error)
    }
  }

  private changed() {
    this.scheduleSave()
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(TodoChannel.State, snapshot)
    }
  }

  onChange(listener: (snapshot: TodoSnapshot) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): TodoSnapshot {
    return { tasks: this.load().tasks }
  }

  getTask(id: string) {
    return this.load().tasks.find((task) => task.id === id) ?? null
  }

  create(draft: TodoTaskDraft): TodoTask {
    const now = Date.now()
    const task: TodoTask = {
      id: randomUUID(),
      title: draft.title.trim().slice(0, MAX_TITLE_LENGTH),
      notes: draft.notes?.trim() || undefined,
      done: false,
      createdAt: now,
      updatedAt: now,
      dueDate: normalizeDay(draft.dueDate),
      dueTime: normalizeDay(draft.dueDate) ? normalizeTime(draft.dueTime) : undefined,
      priority: clampPriority(draft.priority),
      tags: normalizeTags(draft.tags),
      estimate: normalizeEstimate(draft.estimate),
      pomodoros: 0,
      focusMinutes: 0,
    }
    this.load().tasks.unshift(task)
    this.changed()
    mainLogger.info('[todo] created', { id: task.id, dueDate: task.dueDate, tags: task.tags.length })
    return task
  }

  update(id: string, patch: TodoTaskPatch): TodoTask | null {
    const task = this.getTask(id)
    if (!task) return null

    if (patch.title !== undefined && patch.title.trim()) task.title = patch.title.trim().slice(0, MAX_TITLE_LENGTH)
    if ('notes' in patch) task.notes = patch.notes?.trim() || undefined
    if ('dueDate' in patch) task.dueDate = normalizeDay(patch.dueDate)
    if ('dueTime' in patch || 'dueDate' in patch) {
      task.dueTime = task.dueDate ? normalizeTime('dueTime' in patch ? patch.dueTime : task.dueTime) : undefined
    }
    if (patch.priority !== undefined) task.priority = clampPriority(patch.priority)
    if (patch.tags !== undefined) task.tags = normalizeTags(patch.tags)
    if ('estimate' in patch) task.estimate = normalizeEstimate(patch.estimate)
    if (patch.done !== undefined && patch.done !== task.done) {
      task.done = patch.done
      task.doneAt = patch.done ? Date.now() : undefined
    }
    task.updatedAt = Date.now()
    this.changed()
    return task
  }

  remove(id: string): TodoTask | null {
    const tasks = this.load().tasks
    const index = tasks.findIndex((task) => task.id === id)
    if (index < 0) return null
    const [removed] = tasks.splice(index, 1)
    this.changed()
    return removed
  }

  /** Undo of a delete: puts the exact task back. */
  restore(task: TodoTask): TodoTask {
    const tasks = this.load().tasks
    if (!tasks.some((existing) => existing.id === task.id)) {
      tasks.unshift({ ...task, tags: normalizeTags(task.tags), priority: clampPriority(task.priority) })
      this.changed()
    }
    return this.getTask(task.id) ?? task
  }

  importLegacy(items: LegacyTodo[]) {
    const data = this.load()
    if (data.legacyImported) return 0

    let imported = 0
    for (const item of items) {
      if (typeof item?.text !== 'string' || !item.text.trim() || data.tasks.some((task) => task.id === item.id))
        continue
      const due = typeof item.dueDate === 'number' ? new Date(item.dueDate) : null
      const hasTime = due && (due.getHours() !== 0 || due.getMinutes() !== 0)
      const createdAt = typeof item.createdAt === 'number' ? item.createdAt : Date.now()
      data.tasks.push({
        id: typeof item.id === 'string' ? item.id : randomUUID(),
        title: item.text.trim().slice(0, MAX_TITLE_LENGTH),
        done: Boolean(item.completed),
        doneAt: item.completed ? createdAt : undefined,
        createdAt,
        updatedAt: createdAt,
        dueDate: due ? toDayKey(due) : undefined,
        dueTime:
          due && hasTime
            ? `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`
            : undefined,
        priority: clampPriority(item.priority),
        tags: normalizeTags((item.tags ?? []).map((tag) => tag?.label)),
        pomodoros: 0,
        focusMinutes: 0,
      })
      imported += 1
    }

    data.legacyImported = true
    this.changed()
    mainLogger.info('[todo] legacy todos imported', { imported })
    return imported
  }

  isLegacyImported() {
    return this.load().legacyImported
  }

  getSettings(): FocusSettings {
    return this.load().settings
  }

  updateSettings(patch: Partial<FocusSettings>) {
    const settings = this.load().settings
    const minutes = (value: unknown, fallback: number, max: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 1), max) : fallback
    const next: FocusSettings = {
      focusMinutes: minutes(patch.focusMinutes, settings.focusMinutes, 180),
      shortBreakMinutes: minutes(patch.shortBreakMinutes, settings.shortBreakMinutes, 60),
      longBreakMinutes: minutes(patch.longBreakMinutes, settings.longBreakMinutes, 90),
      longBreakEvery: minutes(patch.longBreakEvery, settings.longBreakEvery, 12),
      autoStartBreak: typeof patch.autoStartBreak === 'boolean' ? patch.autoStartBreak : settings.autoStartBreak,
      sound: typeof patch.sound === 'boolean' ? patch.sound : settings.sound,
      celebrate: typeof patch.celebrate === 'boolean' ? patch.celebrate : settings.celebrate,
    }
    this.load().settings = next
    this.scheduleSave()
    return next
  }

  /** Records a finished (or abandoned) focus run and credits the task. */
  recordSession(session: Omit<FocusSession, 'id'>) {
    const data = this.load()
    const cutoff = Date.now() - SESSION_RETENTION_MS
    data.sessions = data.sessions.filter((existing) => existing.endedAt >= cutoff)
    data.sessions.push({ ...session, id: randomUUID() })

    const task = session.taskId ? this.getTask(session.taskId) : null
    if (task) {
      task.focusMinutes += session.minutes
      if (session.completed) task.pomodoros += 1
      task.updatedAt = Date.now()
      this.changed()
    } else {
      this.scheduleSave()
    }
  }

  todayStats(now = new Date()) {
    const today = toDayKey(now)
    let focusMinutes = 0
    let pomodoros = 0
    for (const session of this.load().sessions) {
      if (toDayKey(new Date(session.endedAt)) !== today) continue
      focusMinutes += session.minutes
      if (session.completed) pomodoros += 1
    }
    return { focusMinutes, pomodoros }
  }
}

export const todoStore = new TodoStore()
