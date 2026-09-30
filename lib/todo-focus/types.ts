// Shared todo + focus types (main + renderer). Keep free of Electron / Node imports.

export type TodoPriority = 0 | 1 | 2 | 3

export type TodoTask = {
  id: string
  title: string
  notes?: string
  done: boolean
  doneAt?: number
  createdAt: number
  updatedAt: number
  /** Local calendar day, `YYYY-MM-DD`. */
  dueDate?: string
  /** Local time of day, `HH:mm`; only meaningful with `dueDate`. */
  dueTime?: string
  /** 0 = none, 3 = highest. */
  priority: TodoPriority
  tags: string[]
  /** Planned pomodoros. */
  estimate?: number
  pomodoros: number
  focusMinutes: number
}

export type TodoTaskDraft = {
  title: string
  notes?: string
  dueDate?: string
  dueTime?: string
  priority?: TodoPriority
  tags?: string[]
  estimate?: number
}

export type TodoTaskPatch = Partial<
  Pick<TodoTask, 'title' | 'notes' | 'done' | 'dueDate' | 'dueTime' | 'priority' | 'tags' | 'estimate'>
>

export type FocusPhase = 'idle' | 'focus' | 'shortBreak' | 'longBreak'

export type FocusSettings = {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  /** A long break follows every N completed pomodoros. */
  longBreakEvery: number
  autoStartBreak: boolean
  sound: boolean
  /** Full-screen "focus complete" moment with a breathing guide when a pomodoro ends. */
  celebrate: boolean
}

export const defaultFocusSettings: FocusSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  autoStartBreak: true,
  sound: true,
  celebrate: true,
}

export type FocusState = {
  phase: FocusPhase
  taskId?: string
  taskTitle?: string
  /** Epoch ms the current phase started. */
  startedAt?: number
  /** Epoch ms the running phase ends (not set while paused). */
  endsAt?: number
  /** Remaining ms while paused. */
  pausedRemainingMs?: number
  paused: boolean
  /** Planned length of the current phase in ms. */
  durationMs?: number
  /** Pomodoros completed in the current cycle (resets after a long break). */
  cycleCount: number
  today: { focusMinutes: number; pomodoros: number }
  settings: FocusSettings
}

export type FocusSession = {
  id: string
  taskId?: string
  startedAt: number
  endedAt: number
  minutes: number
  /** Ran the full planned length. */
  completed: boolean
}

/** Payload of the full-screen overlay shown when a pomodoro ends. */
export type FocusCelebration = {
  language: 'zh-CN' | 'en'
  taskTitle?: string
  todayPomodoros: number
  todayFocusMinutes: number
  breakMinutes: number
  longBreak: boolean
  /** Set when the break already started (auto-start); otherwise the overlay offers to start it. */
  breakEndsAt?: number
  sound: boolean
  /** Played from settings: buttons only close, nothing touches the timer. */
  preview?: boolean
}

export type TodoSnapshot = {
  tasks: TodoTask[]
}

/** Shape written by the previous renderer-only version (localStorage `popmind.todo.minimalist.v1`). */
export type LegacyTodo = {
  id: string
  text: string
  completed: boolean
  createdAt: number
  dueDate?: number
  priority: number
  tags?: Array<{ label: string }>
}

export const TODO_LEGACY_STORAGE_KEY = 'popmind.todo.minimalist.v1'
