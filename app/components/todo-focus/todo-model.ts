// Pure view logic for the todo panel: which tasks each view shows, how they are grouped and labelled.
import type { AppLanguage } from '@/lib/capability/types'
import { addDays, dayDiff, mondayIndex, parseDayKey, toDayKey } from '@/lib/todo-focus/dates'
import { todoT } from '@/lib/todo-focus/i18n'
import type { TodoTask } from '@/lib/todo-focus/types'

export const todoViews = ['today', 'upcoming', 'inbox', 'done'] as const
export type TodoView = (typeof todoViews)[number]

export type TodoGroup = {
  key: string
  label: string
  tone?: 'overdue'
  tasks: TodoTask[]
}

const byPlan = (left: TodoTask, right: TodoTask) =>
  (left.dueTime ?? '99:99').localeCompare(right.dueTime ?? '99:99') ||
  right.priority - left.priority ||
  right.createdAt - left.createdAt

export const formatDay = (language: AppLanguage, dayKey: string, now: Date) => {
  const date = parseDayKey(dayKey)
  const diff = dayDiff(now, date)
  if (diff === 0) return todoT(language, 'day.today')
  if (diff === 1) return todoT(language, 'day.tomorrow')
  if (diff === -1) return todoT(language, 'day.yesterday')
  if (diff > 1 && diff < 7) return todoT(language, `weekday.${mondayIndex(date)}` as 'weekday.0')
  const params = { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
  return todoT(language, date.getFullYear() === now.getFullYear() ? 'date.monthDay' : 'date.fullDate', params)
}

/** Label for a task's due date on its row; omits what the group header already says. */
export const formatDue = (language: AppLanguage, task: TodoTask, now: Date, view: TodoView) => {
  if (!task.dueDate || view === 'done') return ''
  const today = toDayKey(now)
  // Upcoming has one group per day for the next 7 days; overdue / later groups still need the date on the row.
  const inDayGroup = task.dueDate >= today && task.dueDate < toDayKey(addDays(now, 7))
  const dayShownByGroup = (view === 'upcoming' && inDayGroup) || (view === 'today' && task.dueDate === today)
  const day = dayShownByGroup ? '' : formatDay(language, task.dueDate, now)
  return [day, task.dueTime].filter(Boolean).join(' ')
}

export const isOverdue = (task: TodoTask, now: Date) => {
  if (task.done || !task.dueDate) return false
  const today = toDayKey(now)
  if (task.dueDate < today) return true
  if (task.dueDate > today || !task.dueTime) return false
  const [hours, minutes] = task.dueTime.split(':').map(Number)
  return now.getHours() * 60 + now.getMinutes() > hours * 60 + minutes
}

export const viewCounts = (tasks: TodoTask[], now: Date) => {
  const today = toDayKey(now)
  let todayCount = 0
  let inbox = 0
  for (const task of tasks) {
    if (task.done) continue
    if (!task.dueDate) inbox += 1
    else if (task.dueDate <= today) todayCount += 1
  }
  return { today: todayCount, upcoming: 0, inbox, done: 0 }
}

/**
 * Groups for a view. `lingering` keeps just-completed tasks in place for a moment (Things style) so completing one
 * does not make the list jump under the pointer.
 */
export const buildGroups = (
  tasks: TodoTask[],
  view: TodoView,
  now: Date,
  language: AppLanguage,
  lingering: ReadonlySet<string>
): TodoGroup[] => {
  const today = toDayKey(now)
  const open = tasks.filter((task) => !task.done || lingering.has(task.id))

  if (view === 'today') {
    const overdue = open.filter((task) => task.dueDate && task.dueDate < today).sort(byPlan)
    const dueToday = open.filter((task) => task.dueDate === today).sort(byPlan)
    return [
      { key: 'overdue', label: todoT(language, 'group.overdue'), tone: 'overdue' as const, tasks: overdue },
      // Only label "today" when an overdue group sits above it; alone it needs no heading.
      { key: 'today', label: overdue.length ? todoT(language, 'group.today') : '', tasks: dueToday },
    ].filter((group) => group.tasks.length > 0)
  }

  if (view === 'inbox') {
    const inbox = open
      .filter((task) => !task.dueDate)
      .sort((left, right) => right.priority - left.priority || right.createdAt - left.createdAt)
    return inbox.length ? [{ key: 'inbox', label: '', tasks: inbox }] : []
  }

  if (view === 'upcoming') {
    const dated = open.filter((task) => task.dueDate).sort((left, right) => left.dueDate!.localeCompare(right.dueDate!))
    const weekEnd = toDayKey(addDays(now, 7))
    const groups = new Map<string, TodoGroup>()
    const push = (key: string, label: string, task: TodoTask, tone?: 'overdue') => {
      const group = groups.get(key) ?? { key, label, tone, tasks: [] }
      group.tasks.push(task)
      groups.set(key, group)
    }
    for (const task of dated) {
      const due = task.dueDate!
      if (due < today) push('overdue', todoT(language, 'group.overdue'), task, 'overdue')
      else if (due < weekEnd) push(due, formatDay(language, due, now), task)
      else push('later', todoT(language, 'group.later'), task)
    }
    return [...groups.values()].map((group) => ({ ...group, tasks: [...group.tasks].sort(byPlan) }))
  }

  // done: logbook grouped by completion day, newest first
  const done = tasks.filter((task) => task.done).sort((left, right) => (right.doneAt ?? 0) - (left.doneAt ?? 0))
  const groups = new Map<string, TodoGroup>()
  for (const task of done) {
    const day = toDayKey(new Date(task.doneAt ?? task.updatedAt))
    const diff = dayDiff(now, parseDayKey(day))
    const label =
      diff === 0
        ? todoT(language, 'group.doneToday')
        : diff === -1
          ? todoT(language, 'group.doneYesterday')
          : formatDay(language, day, now)
    const group = groups.get(day) ?? { key: day, label, tasks: [] }
    group.tasks.push(task)
    groups.set(day, group)
  }
  return [...groups.values()]
}

const TAG_HUES = [4, 28, 45, 140, 190, 215, 265, 320]

/** Stable hue per tag so the same tag always has the same color. */
export const tagHue = (tag: string) => {
  let hash = 0
  for (const character of tag.toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) | 0
  return TAG_HUES[Math.abs(hash) % TAG_HUES.length]
}
