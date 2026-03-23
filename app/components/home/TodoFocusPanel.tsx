import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Calendar as CalendarIcon,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Flag,
  Inbox,
  Menu,
  Plus,
  Search,
  Sun,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type TodoFocusPanelProps = {
  query: string
  trigger: string
  setQuery: (nextQuery: string) => void
}

type Priority = 0 | 1 | 2 | 3
type ViewMode = 'inbox' | 'today' | 'upcoming' | 'calendar'
type TodoTagColor = 'rose' | 'amber' | 'emerald' | 'sky' | 'blue' | 'violet' | 'pink' | 'slate'

type TodoTag = {
  label: string
  color: TodoTagColor
}

type Todo = {
  id: string
  text: string
  completed: boolean
  createdAt: number
  dueDate?: number
  priority: Priority
  tags: TodoTag[]
}

const STORAGE_KEY = 'popmind.todo.minimalist.v1'

const priorityColors: Record<Priority, string> = {
  0: 'text-slate-400',
  1: 'text-blue-500',
  2: 'text-orange-500',
  3: 'text-red-500',
}

const priorityOptions: Array<{ value: Priority; label: string; shortLabel: string }> = [
  { value: 0, label: '无优先级', shortLabel: '无' },
  { value: 1, label: '低优先级', shortLabel: '低' },
  { value: 2, label: '中优先级', shortLabel: '中' },
  { value: 3, label: '高优先级', shortLabel: '高' },
]

const tagColorPalette: TodoTagColor[] = ['rose', 'amber', 'emerald', 'sky', 'blue', 'violet', 'pink', 'slate']

const tagColorStyles: Record<
  TodoTagColor,
  {
    chip: string
    button: string
    dot: string
  }
> = {
  rose: {
    chip: 'border-rose-200 bg-rose-50 text-rose-700',
    button: 'hover:bg-rose-100/80 hover:text-rose-800',
    dot: 'bg-rose-400',
  },
  amber: {
    chip: 'border-amber-200 bg-amber-50 text-amber-700',
    button: 'hover:bg-amber-100/80 hover:text-amber-800',
    dot: 'bg-amber-400',
  },
  emerald: {
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    button: 'hover:bg-emerald-100/80 hover:text-emerald-800',
    dot: 'bg-emerald-400',
  },
  sky: {
    chip: 'border-sky-200 bg-sky-50 text-sky-700',
    button: 'hover:bg-sky-100/80 hover:text-sky-800',
    dot: 'bg-sky-400',
  },
  blue: {
    chip: 'border-blue-200 bg-blue-50 text-blue-700',
    button: 'hover:bg-blue-100/80 hover:text-blue-800',
    dot: 'bg-blue-400',
  },
  violet: {
    chip: 'border-violet-200 bg-violet-50 text-violet-700',
    button: 'hover:bg-violet-100/80 hover:text-violet-800',
    dot: 'bg-violet-400',
  },
  pink: {
    chip: 'border-pink-200 bg-pink-50 text-pink-700',
    button: 'hover:bg-pink-100/80 hover:text-pink-800',
    dot: 'bg-pink-400',
  },
  slate: {
    chip: 'border-slate-200 bg-slate-100 text-slate-700',
    button: 'hover:bg-slate-200 hover:text-slate-800',
    dot: 'bg-slate-400',
  },
}

const createTodoId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const hashString = (value: string) => {
  let hash = 0

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0
  }

  return Math.abs(hash)
}

const normalizeTagLabel = (value: string) => value.trim().replace(/\s+/g, ' ')

const getTagColor = (label: string): TodoTagColor =>
  tagColorPalette[hashString(label.toLowerCase()) % tagColorPalette.length]

const createTodoTag = (label: string): TodoTag | null => {
  const normalizedLabel = normalizeTagLabel(label)

  if (!normalizedLabel) {
    return null
  }

  return {
    label: normalizedLabel,
    color: getTagColor(normalizedLabel),
  }
}

const normalizeTodoTags = (tags: TodoTag[]) => {
  const seenLabels = new Set<string>()

  return tags.flatMap((tag) => {
    const normalizedLabel = normalizeTagLabel(tag.label)

    if (!normalizedLabel) {
      return []
    }

    const key = normalizedLabel.toLowerCase()
    if (seenLabels.has(key)) {
      return []
    }

    seenLabels.add(key)
    return [
      {
        label: normalizedLabel,
        color: getTagColor(normalizedLabel),
      },
    ]
  })
}

const normalizeSearchValue = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim()

const normalizeFuzzyValue = (value: string) => value.toLowerCase().replace(/[\s\-_/\\.]+/g, '')

const isSubsequenceMatch = (needle: string, haystack: string) => {
  if (!needle) {
    return true
  }

  let pointer = 0

  for (const character of haystack) {
    if (character === needle[pointer]) {
      pointer += 1
      if (pointer === needle.length) {
        return true
      }
    }
  }

  return false
}

const isFuzzyTextMatch = (needle: string, haystack: string) => {
  const normalizedNeedle = normalizeSearchValue(needle)
  if (!normalizedNeedle) {
    return true
  }

  const normalizedHaystack = normalizeSearchValue(haystack)
  if (normalizedHaystack.includes(normalizedNeedle)) {
    return true
  }

  const condensedNeedle = normalizeFuzzyValue(normalizedNeedle)
  const condensedHaystack = normalizeFuzzyValue(normalizedHaystack)

  return condensedNeedle.length > 1 && isSubsequenceMatch(condensedNeedle, condensedHaystack)
}

const parseDateSearch = (value: string) => {
  const matcher = /(?<!\d)(?:(\d{4})\s*[-/.]\s*)?(\d{1,2})\s*[-/.]\s*(\d{1,2})(?!\d)/.exec(value)

  if (!matcher) {
    return null
  }

  const currentYear = new Date().getFullYear()
  const year = matcher[1] ? Number(matcher[1]) : currentYear
  const month = Number(matcher[2])
  const day = Number(matcher[3])
  const parsedDate = new Date(year, month - 1, day)

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null
  }

  const remainingText = value
    .slice(0, matcher.index)
    .concat(value.slice(matcher.index + matcher[0].length))
    .trim()

  return {
    date: parsedDate,
    remainingText,
  }
}

const matchesSearchQuery = (todo: Todo, rawQuery: string) => {
  const trimmedQuery = rawQuery.trim()

  if (!trimmedQuery) {
    return true
  }

  const parsedDateQuery = parseDateSearch(trimmedQuery)
  const queryText = parsedDateQuery?.remainingText ?? trimmedQuery
  const searchPool = [todo.text, ...todo.tags.map((tag) => tag.label)].join(' ')
  const matchesText = !queryText || isFuzzyTextMatch(queryText, searchPool)
  const matchesDate = parsedDateQuery ? Boolean(todo.dueDate && isSameDay(todo.dueDate, parsedDateQuery.date)) : true

  return matchesText && matchesDate
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
        {
          id: '1',
          text: '欢迎使用极简风格待办',
          completed: false,
          createdAt: now,
          priority: 3,
          dueDate: now,
          tags: normalizeTodoTags([createTodoTag('重要')!, createTodoTag('产品')!]),
        },
        {
          id: '2',
          text: '点击左侧日历查看特定日期的任务',
          completed: false,
          createdAt: now - 1000,
          priority: 2,
          dueDate: now + 86400000,
          tags: normalizeTodoTags([createTodoTag('日程')!, createTodoTag('指引')!]),
        },
        {
          id: '3',
          text: '在输入框下方可以设置日期、优先级和标签',
          completed: false,
          createdAt: now - 2000,
          priority: 1,
          tags: normalizeTodoTags([createTodoTag('体验')!, createTodoTag('整理')!]),
        },
        {
          id: '4',
          text: '点击任务下方的标签可以直接修改属性',
          completed: true,
          createdAt: now - 3000,
          priority: 0,
          tags: normalizeTodoTags([createTodoTag('完成')!, createTodoTag('技巧')!]),
        },
      ]
    }

    const parsed = JSON.parse(rawValue)
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (todo): todo is Omit<Todo, 'tags'> & { tags?: TodoTag[] } =>
              typeof todo?.id === 'string' &&
              typeof todo?.text === 'string' &&
              typeof todo?.completed === 'boolean' &&
              typeof todo?.createdAt === 'number' &&
              typeof todo?.priority === 'number'
          )
          .map((todo) => ({
            ...todo,
            tags: normalizeTodoTags(
              Array.isArray(todo.tags) ? todo.tags.filter((tag) => typeof tag?.label === 'string') : []
            ),
          }))
      : []
  } catch {
    return []
  }
}

const TagChip = ({ tag, onRemove, compact = false }: { tag: TodoTag; onRemove?: () => void; compact?: boolean }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full border font-medium transition-colors',
      compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]',
      tagColorStyles[tag.color].chip
    )}
  >
    <span className={cn('size-1.5 rounded-full', tagColorStyles[tag.color].dot)} />
    <span className="max-w-[112px] truncate">{tag.label}</span>
    {onRemove ? (
      <button
        type="button"
        onClick={onRemove}
        className={cn('rounded-full p-0.5 text-current/70 transition-colors', tagColorStyles[tag.color].button)}
        aria-label={`移除标签 ${tag.label}`}
      >
        <X className={compact ? 'size-2.5' : 'size-3'} />
      </button>
    ) : null}
  </span>
)

const TagEditor = ({
  tags,
  onChange,
  compact = false,
  placeholder,
  className,
  suggestions = [],
}: {
  tags: TodoTag[]
  onChange: (tags: TodoTag[]) => void
  compact?: boolean
  placeholder?: string
  className?: string
  suggestions?: string[]
}) => {
  const [draft, setDraft] = useState('')
  const [isEditing, setIsEditing] = useState(!compact)
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    if (!compact) {
      setIsEditing(true)
    }
  }, [compact])

  const commitDraft = () => {
    const nextTag = createTodoTag(draft)
    if (!nextTag) {
      setDraft('')
      setIsEditing(!compact)
      return
    }

    onChange(normalizeTodoTags([...tags, nextTag]))
    setDraft('')
    setIsEditing(!compact)
  }

  const availableSuggestions = suggestions.filter((label) => {
    const normalizedLabel = label.toLowerCase()
    if (tags.some((tag) => tag.label.toLowerCase() === normalizedLabel)) {
      return false
    }

    return draft.trim() ? isFuzzyTextMatch(draft, label) : true
  })

  const visibleSuggestions = availableSuggestions.slice(0, compact ? 4 : 6)
  const shouldShowSuggestions = isEditing && isFocused && visibleSuggestions.length > 0

  const applySuggestion = (label: string) => {
    const nextTag = createTodoTag(label)
    if (!nextTag) {
      return
    }

    onChange(normalizeTodoTags([...tags, nextTag]))
    setDraft('')
    setIsEditing(!compact)
    setIsFocused(false)
  }

  return (
    <div className={cn('relative flex flex-wrap items-center gap-2', compact ? 'mt-2' : 'mt-3', className)}>
      {tags.map((tag) => (
        <TagChip
          key={`${tag.label}-${tag.color}`}
          tag={tag}
          compact={compact}
          onRemove={() => onChange(tags.filter((item) => item.label.toLowerCase() !== tag.label.toLowerCase()))}
        />
      ))}

      {isEditing ? (
        <div
          className={cn(
            'flex items-center rounded-full border border-dashed border-slate-200 bg-slate-50 text-slate-500 transition-colors focus-within:border-blue-300 focus-within:bg-white focus-within:text-slate-700',
            compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1'
          )}
        >
          <TagIcon className={compact ? 'mr-1 size-3' : 'mr-1.5 size-3.5'} />
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              if (draft.trim()) {
                commitDraft()
                return
              }

              setIsFocused(false)
              setIsEditing(!compact)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                event.preventDefault()
                commitDraft()
              }

              if (event.key === 'Escape') {
                setDraft('')
                setIsFocused(false)
                setIsEditing(!compact)
              }
            }}
            placeholder={placeholder ?? '输入标签后回车'}
            className={cn(
              'min-w-[88px] bg-transparent outline-none placeholder:text-slate-400',
              compact ? 'w-24' : 'w-32 text-[13px]'
            )}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className={cn(
            'inline-flex items-center rounded-full border border-dashed border-slate-200 bg-slate-50 font-medium text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700',
            compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
          )}
        >
          <Plus className={compact ? 'mr-1 size-2.5' : 'mr-1 size-3'} />
          标签
        </button>
      )}

      {shouldShowSuggestions ? (
        <div
          className={cn(
            'absolute left-0 top-[calc(100%+8px)] z-30 min-w-[180px] rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_40px_rgba(15,23,42,0.12)]',
            compact ? 'max-w-[220px]' : 'max-w-[280px]'
          )}
        >
          <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">已有标签</div>
          <div className="flex flex-wrap gap-1.5">
            {visibleSuggestions.map((label) => {
              const previewTag = createTodoTag(label)
              if (!previewTag) {
                return null
              }

              return (
                <button
                  key={label}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    applySuggestion(label)
                  }}
                  className="text-left"
                >
                  <TagChip tag={previewTag} compact={compact} />
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

const TaskInput = ({
  draft,
  setDraft,
  onAdd,
  defaultDate,
  availableTags,
}: {
  draft: string
  setDraft: (nextDraft: string) => void
  onAdd: (priority: Priority, date: number | undefined, tags: TodoTag[]) => void
  defaultDate?: number
  availableTags: string[]
}) => {
  const [priority, setPriority] = useState<Priority>(0)
  const [date, setDate] = useState<number | undefined>(defaultDate)
  const [tags, setTags] = useState<TodoTag[]>([])
  const [showDateControl, setShowDateControl] = useState(Boolean(defaultDate))
  const [showPriorityControl, setShowPriorityControl] = useState(false)
  const [showTagEditor, setShowTagEditor] = useState(false)

  useEffect(() => {
    setDate(defaultDate)
    setShowDateControl(Boolean(defaultDate))
  }, [defaultDate])

  const submitTask = () => {
    if (!draft.trim()) {
      return
    }

    onAdd(priority, date, tags)
    setPriority(0)
    setDate(defaultDate)
    setTags([])
    setShowDateControl(Boolean(defaultDate))
    setShowPriorityControl(false)
    setShowTagEditor(false)
  }

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
            submitTask()
          }
        }}
      />

      <div className="mt-3 flex items-center justify-between px-2">
        <div className="flex flex-wrap items-center gap-2">
          {showDateControl || date ? (
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
                  setShowDateControl(false)
                }}
              />
            </label>
          ) : (
            <button
              type="button"
              onClick={() => setShowDateControl(true)}
              className="rounded-lg bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
              aria-label="设置日期"
            >
              <CalendarIcon className="size-4" />
            </button>
          )}

          {showTagEditor || tags.length ? (
            <TagEditor
              tags={tags}
              onChange={setTags}
              placeholder="补充标签"
              className="mt-0"
              suggestions={availableTags}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowTagEditor(true)}
              className="rounded-lg bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
              aria-label="添加标签"
            >
              <TagIcon className="size-4" />
            </button>
          )}

          {showPriorityControl || priority !== 0 ? (
            <PrioritySelect value={priority} onChange={setPriority} />
          ) : (
            <button
              type="button"
              onClick={() => setShowPriorityControl(true)}
              className="rounded-lg bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-700"
              aria-label="设置优先级"
            >
              <Flag className="size-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={submitTask}
          disabled={!draft.trim()}
          className="rounded-md bg-blue-500 p-1.5 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="添加任务"
        >
          <Plus className="size-4" />
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
  availableTags,
}: {
  todo: Todo
  onToggle: () => void
  onDelete: () => void
  onUpdate: (updates: Partial<Todo>) => void
  availableTags: string[]
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

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
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

            <TagEditor
              tags={todo.tags}
              onChange={(tags) => onUpdate({ tags })}
              compact
              placeholder="添加标签"
              className="mt-0"
              suggestions={availableTags}
            />

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

  useEffect(() => {
    setCurrentMonth(new Date(selectedDate))
  }, [selectedDate])

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

  useEffect(() => {
    if (viewMode === 'calendar' && searchQuery) {
      setSearchQuery('')
    }
  }, [searchQuery, viewMode])

  const handleAddTodo = (priority: Priority, date: number | undefined, tags: TodoTag[]) => {
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
      tags: normalizeTodoTags(tags),
    }

    setTodos((current) => [nextTodo, ...current])
    setDraft('')
    setQuery(`${trigger} `)
  }

  const filteredTodos = useMemo(() => {
    let nextTodos = todos

    if (searchQuery) {
      nextTodos = nextTodos.filter((todo) => matchesSearchQuery(todo, searchQuery))
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

  const availableTags = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>()

    for (const todo of todos) {
      for (const tag of todo.tags) {
        const key = tag.label.toLowerCase()
        const current = counts.get(key)

        if (current) {
          current.count += 1
        } else {
          counts.set(key, { label: tag.label, count: 1 })
        }
      }
    }

    return [...counts.values()]
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'))
      .map((item) => item.label)
  }, [todos])

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

  const handleExportTodos = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      total: todos.length,
      todos,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const exportDate = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')

    anchor.href = objectUrl
    anchor.download = `popmind-todos-${exportDate.getFullYear()}${pad(exportDate.getMonth() + 1)}${pad(exportDate.getDate())}-${pad(exportDate.getHours())}${pad(exportDate.getMinutes())}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(objectUrl)
  }

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

          <div className="mt-7 flex items-center justify-between px-4">
            <div className="px-2 text-sm font-semibold tracking-[0.08em] text-slate-600">日历</div>
            <button
              type="button"
              onClick={handleExportTodos}
              className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <Download className="mr-1.5 size-3.5" />
              导出数据
            </button>
          </div>
          <MiniCalendar
            selectedDate={selectedDate}
            onSelectDate={(date) => {
              setSelectedDate(date)
              setSearchQuery('')
              setViewMode('calendar')
            }}
            todos={todos}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-white">
        {viewMode === 'calendar' ? null : (
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
                placeholder="搜索任务、标签或日期..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-44 rounded-full border border-transparent bg-slate-100 py-1.5 pl-9 pr-4 text-sm outline-none transition-all hover:bg-slate-200/80 focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </header>
        )}

        <main className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto', viewMode === 'calendar' ? 'p-4' : 'p-4')}>
          {viewMode === 'calendar' ? (
            <div className="relative mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
              {!isSidebarOpen ? (
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(true)}
                  className="absolute left-0 top-0 z-20 rounded-xl border border-slate-200 bg-white/90 p-2 text-slate-500 shadow-sm backdrop-blur transition-colors hover:bg-white hover:text-slate-700"
                  aria-label="展开侧边栏"
                >
                  <Menu className="size-4" />
                </button>
              ) : null}

              <div className={cn('mb-5 flex items-center', isSidebarOpen ? 'justify-between' : 'justify-end pl-12')}>
                <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
                  <CalendarIcon className="mr-2 size-4 text-blue-500" />
                  {viewTitle}
                </div>
              </div>

              {filteredTodos.length ? (
                <div className="space-y-3">
                  {filteredTodos.map((todo) => (
                    <TaskItem
                      key={todo.id}
                      todo={todo}
                      availableTags={availableTags}
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
                <div className="flex flex-1 flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 py-16 text-center">
                  <div className="mb-5 flex size-20 items-center justify-center rounded-full bg-white shadow-sm">
                    <CalendarIcon className="size-10 text-slate-300" />
                  </div>
                  <p className="text-base font-medium text-slate-600">这一天没有安排任务</p>
                  <p className="mt-2 text-sm text-slate-400">在左侧继续切换日期，或回到其他视图添加任务</p>
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-3xl">
              {!searchQuery ? (
                <TaskInput
                  draft={draft}
                  setDraft={setDraft}
                  onAdd={handleAddTodo}
                  defaultDate={defaultDateForNewTask}
                  availableTags={availableTags}
                />
              ) : null}

              {filteredTodos.length ? (
                <div className="space-y-3">
                  {filteredTodos.map((todo) => (
                    <TaskItem
                      key={todo.id}
                      todo={todo}
                      availableTags={availableTags}
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
                    {searchQuery ? '试试任务名称、标签或 3/12 这样的日期' : '享受你的空闲时间，或者添加新任务'}
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
