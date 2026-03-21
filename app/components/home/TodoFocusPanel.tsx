import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Calendar as CalendarIcon,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Flag,
  Inbox,
  Menu,
  Plus,
  Search,
  Sun,
  Trash2,
  X,
} from 'lucide-react'

type TodoFocusPanelProps = {
  query: string
  trigger: string
  setQuery: (nextQuery: string) => void
}

type Priority = 0 | 1 | 2 | 3
type ViewMode = 'inbox' | 'today' | 'upcoming' | 'calendar'

type Todo = {
  id: string
  text: string
  completed: boolean
  createdAt: number
  dueDate?: number
  priority: Priority
}

const STORAGE_KEY = 'popmind.todo.minimalist.v1'

const priorityColors: Record<Priority, string> = {
  0: 'text-slate-400',
  1: 'text-blue-500',
  2: 'text-orange-500',
  3: 'text-red-500',
}

const priorityCardColors: Record<Priority, string> = {
  0: 'bg-slate-100 text-slate-600 border-slate-200',
  1: 'bg-blue-50 text-blue-700 border-blue-200',
  2: 'bg-orange-50 text-orange-700 border-orange-200',
  3: 'bg-red-50 text-red-700 border-red-200',
}

const priorityOptions: Array<{ value: Priority; label: string; shortLabel: string }> = [
  { value: 0, label: '无优先级', shortLabel: '无' },
  { value: 1, label: '低优先级', shortLabel: '低' },
  { value: 2, label: '中优先级', shortLabel: '中' },
  { value: 3, label: '高优先级', shortLabel: '高' },
]

const createTodoId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const isSameDay = (left: Date | number, right: Date | number) => {
  const leftDate = new Date(left)
  const rightDate = new Date(right)

  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  )
}

const isToday = (date: Date | number) => isSameDay(date, new Date())

const startOfDay = (date: Date | number) => {
  const nextDate = new Date(date)
  nextDate.setHours(0, 0, 0, 0)
  return nextDate
}

const getLocalISOString = (timestamp: number) => {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}

const formatTaskDateLabel = (timestamp?: number) => {
  if (!timestamp) {
    return '设置日期'
  }

  const date = new Date(timestamp)
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

const PrioritySelect = ({
  value,
  onChange,
  compact = false,
}: {
  value: Priority
  onChange: (value: Priority) => void
  compact?: boolean
}) => {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const currentOption = priorityOptions.find((option) => option.value === value) ?? priorityOptions[0]

  useEffect(() => {
    if (!open) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex items-center rounded-lg bg-slate-100 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200 ${
          compact ? 'px-1.5 py-0.5 rounded-md' : 'px-2 py-1.5'
        }`}
      >
        <Flag className={`mr-1.5 size-4 ${priorityColors[value]}`} />
        <span>{compact ? currentOption.shortLabel : currentOption.label}</span>
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-20 min-w-[112px] rounded-xl border border-slate-200 bg-white p-1 shadow-[0_14px_30px_rgba(15,23,42,0.12)]">
          {priorityOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={`flex w-full items-center rounded-lg px-2 py-2 text-left text-xs transition-colors ${
                option.value === value ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Flag className={`mr-2 size-3.5 ${priorityColors[option.value]}`} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const readTodos = (): Todo[] => {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY)
    if (!rawValue) {
      const now = Date.now()
      return [
        { id: '1', text: '欢迎使用极简风格待办', completed: false, createdAt: now, priority: 3, dueDate: now },
        {
          id: '2',
          text: '点击左侧日历查看特定日期的任务',
          completed: false,
          createdAt: now - 1000,
          priority: 2,
          dueDate: now + 86400000,
        },
        {
          id: '3',
          text: '在输入框下方可以设置日期和优先级',
          completed: false,
          createdAt: now - 2000,
          priority: 1,
        },
        {
          id: '4',
          text: '点击任务下方的标签可以直接修改属性',
          completed: true,
          createdAt: now - 3000,
          priority: 0,
        },
      ]
    }

    const parsed = JSON.parse(rawValue)
    return Array.isArray(parsed)
      ? parsed.filter(
          (todo): todo is Todo =>
            typeof todo?.id === 'string' &&
            typeof todo?.text === 'string' &&
            typeof todo?.completed === 'boolean' &&
            typeof todo?.createdAt === 'number' &&
            typeof todo?.priority === 'number'
        )
      : []
  } catch {
    return []
  }
}

const TaskInput = ({
  draft,
  setDraft,
  onAdd,
  defaultDate,
}: {
  draft: string
  setDraft: (nextDraft: string) => void
  onAdd: (priority: Priority, date?: number) => void
  defaultDate?: number
}) => {
  const [priority, setPriority] = useState<Priority>(0)
  const [date, setDate] = useState<number | undefined>(defaultDate)

  useEffect(() => {
    setDate(defaultDate)
  }, [defaultDate])

  return (
    <div className="mb-5 rounded-[20px] border border-slate-200 bg-white p-3 shadow-sm transition-all focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
      <input
        type="text"
        placeholder="准备做点什么？"
        className="w-full bg-transparent px-2 py-1 text-[17px] text-slate-800 outline-none placeholder:text-slate-400"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onAdd(priority, date)
            setPriority(0)
            setDate(defaultDate)
          }
        }}
      />

      <div className="mt-3 flex items-center justify-between px-2">
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center rounded-lg bg-slate-100 px-2 py-1.5 transition-colors hover:bg-slate-200">
            <CalendarIcon className="mr-1.5 size-4 text-slate-500" />
            <input
              type="datetime-local"
              className="cursor-pointer bg-transparent text-xs font-medium text-slate-600 outline-none"
              value={date ? getLocalISOString(date) : ''}
              onChange={(event) => {
                if (event.target.value) {
                  setDate(new Date(event.target.value).getTime())
                  return
                }

                setDate(undefined)
              }}
            />
          </label>

          <PrioritySelect value={priority} onChange={setPriority} />
        </div>

        <button
          type="button"
          onClick={() => {
            onAdd(priority, date)
            setPriority(0)
            setDate(defaultDate)
          }}
          disabled={!draft.trim()}
          className="rounded-lg bg-blue-500 p-2 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="添加任务"
        >
          <Plus className="size-5" />
        </button>
      </div>
    </div>
  )
}

const TaskItem = ({
  todo,
  onToggle,
  onDelete,
  onUpdate,
}: {
  todo: Todo
  onToggle: () => void
  onDelete: () => void
  onUpdate: (updates: Partial<Todo>) => void
}) => {
  const overdue = Boolean(todo.dueDate && todo.dueDate < startOfDay(new Date()).getTime() && !todo.completed)
  const [draftText, setDraftText] = useState(todo.text)
  const [isEditingText, setIsEditingText] = useState(false)
  const [isEditingDate, setIsEditingDate] = useState(false)

  useEffect(() => {
    setDraftText(todo.text)
  }, [todo.text])

  const commitTextEdit = () => {
    const nextText = draftText.trim()
    setIsEditingText(false)

    if (!nextText || nextText === todo.text) {
      setDraftText(todo.text)
      return
    }

    onUpdate({ text: nextText })
  }

  return (
    <div className="group flex items-start justify-between rounded-[20px] border border-slate-100 bg-white p-4 shadow-sm transition-all duration-200 hover:bg-slate-50/80">
      <div className="flex min-w-0 flex-1 items-start">
        <button type="button" onClick={onToggle} className="mr-3 mt-0.5 flex-shrink-0">
          {todo.completed ? (
            <CheckCircle2 className="size-5 text-blue-500" />
          ) : (
            <Circle
              className={`size-5 transition-colors ${
                todo.priority === 3
                  ? 'text-red-400'
                  : todo.priority === 2
                    ? 'text-orange-400'
                    : todo.priority === 1
                      ? 'text-blue-400'
                      : 'text-slate-300 group-hover:text-blue-400'
              }`}
            />
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col">
          {isEditingText ? (
            <input
              autoFocus
              type="text"
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              onBlur={commitTextEdit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitTextEdit()
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  setDraftText(todo.text)
                  setIsEditingText(false)
                }
              }}
              className="rounded-md border border-blue-200 bg-white px-2 py-1 text-[15px] text-slate-700 outline-none ring-1 ring-blue-500/30"
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingText(true)}
              className={`truncate text-left text-[15px] transition-all ${
                todo.completed ? 'text-slate-400 line-through' : 'text-slate-700'
              }`}
            >
              {todo.text}
            </button>
          )}

          <div className="mt-1.5 flex items-center gap-2">
            {isEditingDate ? (
              <div
                className={`flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                  overdue ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'
                }`}
              >
                <CalendarIcon className="mr-1 size-3" />
                <input
                  autoFocus
                  type="datetime-local"
                  className="w-[136px] bg-transparent outline-none"
                  value={todo.dueDate ? getLocalISOString(todo.dueDate) : ''}
                  onChange={(event) => {
                    if (event.target.value) {
                      onUpdate({ dueDate: new Date(event.target.value).getTime() })
                      return
                    }

                    onUpdate({ dueDate: undefined })
                  }}
                  onBlur={() => setIsEditingDate(false)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === 'Escape') {
                      setIsEditingDate(false)
                    }
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingDate(true)}
                className={`flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                  overdue ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                <CalendarIcon className="mr-1 size-3" />
                {formatTaskDateLabel(todo.dueDate)}
              </button>
            )}

            <PrioritySelect value={todo.priority} onChange={(value) => onUpdate({ priority: value })} compact />
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="ml-4 rounded-xl p-2 text-slate-300 opacity-0 transition-all duration-200 hover:bg-rose-50 hover:text-rose-500 focus:opacity-100 group-hover:opacity-100"
        aria-label="删除任务"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  )
}

const MiniCalendar = ({
  selectedDate,
  onSelectDate,
  todos,
}: {
  selectedDate: Date
  onSelectDate: (date: Date) => void
  todos: Todo[]
}) => {
  const [currentMonth, setCurrentMonth] = useState(() => new Date(selectedDate))

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay()
  const days: Array<Date | null> = []

  for (let index = 0; index < firstDayOfMonth; index += 1) {
    days.push(null)
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day))
  }

  return (
    <div className="mx-4 mt-6 rounded-[20px] border border-slate-100 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="text-sm font-semibold text-slate-700">
          {currentMonth.getFullYear()}年{currentMonth.getMonth() + 1}月
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
            className="rounded-md p-1 transition-colors hover:bg-slate-100"
          >
            <ChevronLeft className="size-4 text-slate-500" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
            className="rounded-md p-1 transition-colors hover:bg-slate-100"
          >
            <ChevronRight className="size-4 text-slate-500" />
          </button>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-400">
        {['日', '一', '二', '三', '四', '五', '六'].map((dayLabel) => (
          <div key={dayLabel}>{dayLabel}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs">
        {days.map((date, index) => {
          if (!date) {
            return <div key={`empty-${index}`} className="h-7" />
          }

          const selected = isSameDay(date, selectedDate)
          const today = isToday(date)
          const hasTodo = todos.some((todo) => todo.dueDate && isSameDay(todo.dueDate, date) && !todo.completed)

          return (
            <button
              key={date.toISOString()}
              type="button"
              onClick={() => onSelectDate(date)}
              className={`relative flex h-7 w-7 flex-col items-center justify-center rounded-full transition-colors ${
                selected
                  ? 'bg-blue-500 font-semibold text-white shadow-md shadow-blue-500/30'
                  : today
                    ? 'bg-blue-50 font-semibold text-blue-600'
                    : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span>{date.getDate()}</span>
              {hasTodo ? (
                <span className={`absolute bottom-0.5 size-1 rounded-full ${selected ? 'bg-white' : 'bg-blue-400'}`} />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const CalendarView = ({
  todos,
  selectedDate,
  setSelectedDate,
  onToggleTodo,
}: {
  todos: Todo[]
  selectedDate: Date
  setSelectedDate: (date: Date) => void
  onToggleTodo: (id: string) => void
}) => {
  const [currentMonth, setCurrentMonth] = useState(() => new Date(selectedDate))
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay()
  const days: Array<Date | null> = []

  for (let index = 0; index < firstDayOfMonth; index += 1) {
    days.push(null)
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 p-4">
        <h2 className="text-lg font-bold text-slate-800">
          {currentMonth.getFullYear()}年 {currentMonth.getMonth() + 1}月
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
            className="rounded-lg p-1.5 transition-colors hover:bg-slate-200"
          >
            <ChevronLeft className="size-5 text-slate-600" />
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date())}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            今天
          </button>
          <button
            type="button"
            onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
            className="rounded-lg p-1.5 transition-colors hover:bg-slate-200"
          >
            <ChevronRight className="size-5 text-slate-600" />
          </button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-7 gap-px overflow-auto bg-slate-200">
        {['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map((dayLabel) => (
          <div key={dayLabel} className="bg-slate-50 py-2 text-center text-xs font-semibold text-slate-500">
            {dayLabel}
          </div>
        ))}

        {days.map((date, index) => {
          if (!date) {
            return <div key={`empty-${index}`} className="min-h-[96px] bg-slate-50/30" />
          }

          const today = isToday(date)
          const selected = isSameDay(date, selectedDate)
          const dayTodos = todos.filter((todo) => todo.dueDate && isSameDay(todo.dueDate, date))

          return (
            <div
              key={date.toISOString()}
              onClick={() => setSelectedDate(date)}
              className={`relative flex min-h-[110px] cursor-pointer flex-col bg-white p-2 transition-colors hover:bg-slate-50 ${
                selected ? 'z-10 ring-2 ring-inset ring-blue-500' : ''
              }`}
            >
              <div
                className={`mb-2 flex size-7 items-center justify-center rounded-full text-sm font-medium ${
                  today ? 'bg-blue-500 text-white' : 'text-slate-700'
                }`}
              >
                {date.getDate()}
              </div>

              <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
                {dayTodos.map((todo) => (
                  <button
                    key={todo.id}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggleTodo(todo.id)
                    }}
                    title={todo.text}
                    className={`w-full truncate rounded-md border px-2 py-1.5 text-left text-[11px] transition-all hover:shadow-sm ${
                      todo.completed
                        ? 'border-slate-200 bg-slate-50 text-slate-500 line-through opacity-50'
                        : priorityCardColors[todo.priority]
                    }`}
                  >
                    {todo.text}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TodoFocusPanel({ query, trigger, setQuery }: TodoFocusPanelProps) {
  const [draft, setDraft] = useState(query)
  const [todos, setTodos] = useState<Todo[]>(() => readTodos())
  const [viewMode, setViewMode] = useState<ViewMode>('today')
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date())
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(todos))
  }, [todos])

  useEffect(() => {
    setDraft(query)
  }, [query])

  const handleAddTodo = (priority: Priority, date?: number) => {
    if (!draft.trim()) {
      return
    }

    const nextTodo: Todo = {
      id: createTodoId(),
      text: draft.trim(),
      completed: false,
      createdAt: Date.now(),
      priority,
      dueDate: date,
    }

    setTodos((current) => [nextTodo, ...current])
    setDraft('')
    setQuery(`${trigger} `)
  }

  const filteredTodos = useMemo(() => {
    let nextTodos = todos

    if (searchQuery) {
      nextTodos = nextTodos.filter((todo) => todo.text.toLowerCase().includes(searchQuery.toLowerCase()))
    } else if (viewMode === 'today') {
      nextTodos = nextTodos.filter((todo) => todo.dueDate && isSameDay(todo.dueDate, new Date()))
    } else if (viewMode === 'upcoming') {
      const today = startOfDay(new Date())
      const nextWeek = new Date(today)
      nextWeek.setDate(nextWeek.getDate() + 7)
      nextTodos = nextTodos.filter(
        (todo) => todo.dueDate && todo.dueDate >= today.getTime() && todo.dueDate <= nextWeek.getTime()
      )
    } else if (viewMode === 'calendar') {
      nextTodos = nextTodos.filter((todo) => todo.dueDate && isSameDay(todo.dueDate, selectedDate))
    }

    return [...nextTodos].sort((left, right) => {
      if (left.completed !== right.completed) {
        return left.completed ? 1 : -1
      }

      if (left.priority !== right.priority) {
        return right.priority - left.priority
      }

      if (left.dueDate && right.dueDate) {
        return left.dueDate - right.dueDate
      }

      return right.createdAt - left.createdAt
    })
  }, [searchQuery, selectedDate, todos, viewMode])

  const viewTitle = useMemo(() => {
    if (searchQuery) return '搜索结果'
    if (viewMode === 'inbox') return '收集箱'
    if (viewMode === 'today') return '今天'
    if (viewMode === 'upcoming') return '最近7天'
    if (viewMode === 'calendar') return `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`
    return '待办事项'
  }, [searchQuery, selectedDate, viewMode])

  const defaultDateForNewTask = useMemo(() => {
    if (viewMode === 'today') return startOfDay(new Date()).getTime()
    if (viewMode === 'calendar') return startOfDay(selectedDate).getTime()
    return undefined
  }, [selectedDate, viewMode])

  const navItems = [
    { id: 'inbox' as const, label: '收集箱', icon: Inbox, color: 'text-blue-500' },
    { id: 'today' as const, label: '今天', icon: Sun, color: 'text-orange-500' },
    { id: 'upcoming' as const, label: '最近7天', icon: CalendarDays, color: 'text-violet-500' },
  ]

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-white text-slate-800">
      <aside
        className={`flex h-full flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50 transition-all duration-300 ${
          isSidebarOpen ? 'w-56' : 'w-0 overflow-hidden border-r-0'
        }`}
      >
        <div className="flex h-12 items-center justify-between border-b border-slate-200/60 px-5">
          <span className="text-base font-bold text-slate-800">待办清单</span>
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-200"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-3">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setViewMode(item.id)}
                className={`flex w-full items-center rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  viewMode === item.id
                    ? 'border-slate-100 bg-white text-slate-900 shadow-sm'
                    : 'border-transparent text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
                }`}
              >
                <item.icon className={`mr-3 size-5 ${item.color}`} />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="mt-7 px-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">日历</div>
          <MiniCalendar
            selectedDate={selectedDate}
            onSelectDate={(date) => {
              setSelectedDate(date)
              setViewMode('calendar')
            }}
            todos={todos}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex h-12 items-center justify-between border-b border-slate-100/80 px-4">
          <div className="flex items-center">
            {!isSidebarOpen ? (
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="mr-3 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100"
              >
                <Menu className="size-4" />
              </button>
            ) : null}
            <h1 className="text-lg font-bold text-slate-800">{viewTitle}</h1>
          </div>

          <div className="relative flex items-center">
            <Search className="absolute left-3 size-4 text-slate-400" />
            <input
              type="text"
              placeholder="搜索任务..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-44 rounded-full border border-transparent bg-slate-100 py-1.5 pl-9 pr-4 text-sm outline-none transition-all hover:bg-slate-200/80 focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {viewMode === 'calendar' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {!searchQuery ? (
                <TaskInput
                  draft={draft}
                  setDraft={setDraft}
                  onAdd={handleAddTodo}
                  defaultDate={defaultDateForNewTask}
                />
              ) : null}

              <CalendarView
                todos={todos}
                selectedDate={selectedDate}
                setSelectedDate={setSelectedDate}
                onToggleTodo={(todoId) =>
                  setTodos((current) =>
                    current.map((todo) => (todo.id === todoId ? { ...todo, completed: !todo.completed } : todo))
                  )
                }
              />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl">
              {!searchQuery ? (
                <TaskInput
                  draft={draft}
                  setDraft={setDraft}
                  onAdd={handleAddTodo}
                  defaultDate={defaultDateForNewTask}
                />
              ) : null}

              {filteredTodos.length ? (
                <div className="space-y-3">
                  {filteredTodos.map((todo) => (
                    <TaskItem
                      key={todo.id}
                      todo={todo}
                      onToggle={() =>
                        setTodos((current) =>
                          current.map((item) => (item.id === todo.id ? { ...item, completed: !item.completed } : item))
                        )
                      }
                      onDelete={() => setTodos((current) => current.filter((item) => item.id !== todo.id))}
                      onUpdate={(updates) =>
                        setTodos((current) =>
                          current.map((item) => (item.id === todo.id ? { ...item, ...updates } : item))
                        )
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center py-16 text-center">
                  <div className="mb-5 flex size-20 items-center justify-center rounded-full bg-slate-50">
                    <CheckCircle2 className="size-10 text-slate-300" />
                  </div>
                  <p className="text-base font-medium text-slate-600">
                    {searchQuery ? '没有找到匹配的任务' : '太棒了，所有任务都已完成！'}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">
                    {searchQuery ? '换个关键词试试看' : '享受你的空闲时间，或者添加新任务'}
                  </p>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
