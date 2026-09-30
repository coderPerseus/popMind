import { z } from 'zod'
import type { FocusState, TodoSnapshot, TodoTask } from '@/lib/todo-focus/types'

const prioritySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
const dayKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/)

const draftSchema = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(10_000).optional(),
  dueDate: dayKeySchema.optional(),
  dueTime: timeSchema.optional(),
  priority: prioritySchema.optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  estimate: z.number().int().min(1).max(99).optional(),
})

const patchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  notes: z.string().max(10_000).optional(),
  done: z.boolean().optional(),
  dueDate: dayKeySchema.nullable().optional(),
  dueTime: timeSchema.nullable().optional(),
  priority: prioritySchema.optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  estimate: z.number().int().min(1).max(99).nullable().optional(),
})

const focusSettingsPatchSchema = z
  .object({
    focusMinutes: z.number().int().min(1).max(180),
    shortBreakMinutes: z.number().int().min(1).max(60),
    longBreakMinutes: z.number().int().min(1).max(90),
    longBreakEvery: z.number().int().min(1).max(12),
    autoStartBreak: z.boolean(),
    sound: z.boolean(),
    celebrate: z.boolean(),
  })
  .partial()

const legacyTodoSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    completed: z.boolean(),
    createdAt: z.number(),
    dueDate: z.number().optional(),
    priority: z.number(),
    tags: z.array(z.object({ label: z.string() }).passthrough()).optional(),
  })
  .passthrough()

const taskSchema = z.custom<TodoTask>()
const focusStateSchema = z.custom<FocusState>()

export const todoIpcSchema = {
  'todo-list': { args: z.tuple([]), return: z.custom<TodoSnapshot>() },
  'todo-create': { args: z.tuple([draftSchema]), return: taskSchema },
  'todo-update': { args: z.tuple([z.string(), patchSchema]), return: taskSchema.nullable() },
  'todo-delete': { args: z.tuple([z.string()]), return: taskSchema.nullable() },
  /** Undo of a delete. */
  'todo-restore': { args: z.tuple([taskSchema]), return: taskSchema },
  /** One-time import of the old localStorage todos; returns how many were imported (0 once done). */
  'todo-import-legacy': { args: z.tuple([z.array(legacyTodoSchema)]), return: z.number() },
  'todo-legacy-imported': { args: z.tuple([]), return: z.boolean() },
  'focus-get': { args: z.tuple([]), return: focusStateSchema },
  'focus-start': { args: z.tuple([z.string().optional()]), return: focusStateSchema },
  'focus-pause': { args: z.tuple([]), return: focusStateSchema },
  'focus-resume': { args: z.tuple([]), return: focusStateSchema },
  'focus-stop': { args: z.tuple([]), return: focusStateSchema },
  'focus-skip-break': { args: z.tuple([]), return: focusStateSchema },
  'focus-complete-task': { args: z.tuple([]), return: focusStateSchema },
  'focus-update-settings': { args: z.tuple([focusSettingsPatchSchema]), return: focusStateSchema },
  /** Starts the break offered by the overlay when breaks do not start automatically. */
  'focus-start-break': { args: z.tuple([]), return: focusStateSchema },
  /** The full-screen overlay was dismissed; `skipBreak` also ends the running break. */
  /** Plays the end-of-pomodoro moment from settings. */
  'focus-overlay-preview': { args: z.tuple([]), return: z.object({ ok: z.boolean() }) },
  'focus-overlay-close': { args: z.tuple([z.enum(['rest', 'skipBreak'])]), return: z.object({ ok: z.boolean() }) },
} as const
