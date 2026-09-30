import { useEffect, useState } from 'react'
import { useConveyor } from '@/app/hooks/use-conveyor'
import { TODO_LEGACY_STORAGE_KEY, type FocusState, type LegacyTodo, type TodoTask } from '@/lib/todo-focus/types'

// Sample tasks the old version wrote on first open; not worth importing.
const LEGACY_SAMPLE_TEXTS = new Set([
  '欢迎使用极简风格待办',
  '点击左侧日历查看特定日期的任务',
  '在输入框下方可以设置日期、优先级和标签',
  '点击任务下方的标签可以直接修改属性',
])

const readLegacyTodos = (): LegacyTodo[] => {
  try {
    const raw = window.localStorage.getItem(TODO_LEGACY_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is LegacyTodo =>
            typeof item?.id === 'string' && typeof item?.text === 'string' && !LEGACY_SAMPLE_TEXTS.has(item.text)
        )
      : []
  } catch {
    return []
  }
}

/** Tasks + focus state from the main process, kept live through push events. */
export function useTodoFocus() {
  const todo = useConveyor('todo')
  const [tasks, setTasks] = useState<TodoTask[] | null>(null)
  const [focus, setFocus] = useState<FocusState | null>(null)

  useEffect(() => {
    let alive = true

    const load = async () => {
      if (!(await todo.isLegacyImported())) {
        await todo.importLegacy(readLegacyTodos())
      }
      const [snapshot, focusState] = await Promise.all([todo.list(), todo.getFocus()])
      if (alive) {
        setTasks(snapshot.tasks)
        setFocus(focusState)
      }
    }

    void load().catch((error) => console.error('[todo] load failed', error))
    const offState = todo.onState((snapshot) => setTasks(snapshot.tasks))
    const offFocus = todo.onFocus((state) => setFocus(state))

    return () => {
      alive = false
      offState()
      offFocus()
    }
  }, [todo])

  return { todo, tasks, focus }
}

/** Remaining ms of the running phase, re-rendering every 250 ms while it runs. */
export function useFocusRemaining(focus: FocusState | null) {
  const [now, setNow] = useState(() => Date.now())
  const running = Boolean(focus && focus.phase !== 'idle' && !focus.paused)

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [running])

  if (!focus || focus.phase === 'idle') return 0
  if (focus.paused) return focus.pausedRemainingMs ?? 0
  return Math.max(0, (focus.endsAt ?? now) - now)
}

export const formatClock = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}
