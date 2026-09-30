import { memo, type ComponentType, type ReactNode } from 'react'
import { Check, MoreHorizontal, Play, Timer } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/app/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import { tagHue } from '@/app/components/todo-focus/todo-model'
import type { TodoTask } from '@/lib/todo-focus/types'
import { cn } from '@/lib/utils'

export type TaskMenuAction =
  | { type: 'separator' }
  | {
      type: 'item'
      label: string
      shortcut?: string
      destructive?: boolean
      onSelect: () => void
    }
  | {
      type: 'submenu'
      label: string
      items: Array<{ label: string; checked: boolean; onSelect: () => void; accent?: string }>
    }

type MenuKit = {
  Item: ComponentType<{ onSelect?: () => void; variant?: 'default' | 'destructive'; children: ReactNode }>
  CheckboxItem: ComponentType<{ checked?: boolean; onSelect?: (event: Event) => void; children: ReactNode }>
  Separator: ComponentType
  Shortcut: ComponentType<{ children: ReactNode }>
  Sub: ComponentType<{ children: ReactNode }>
  SubTrigger: ComponentType<{ children: ReactNode }>
  SubContent: ComponentType<{ className?: string; children: ReactNode }>
}

const dropdownKit: MenuKit = {
  Item: DropdownMenuItem,
  CheckboxItem: DropdownMenuCheckboxItem,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
}

const contextKit: MenuKit = {
  Item: ContextMenuItem,
  CheckboxItem: ContextMenuCheckboxItem,
  Separator: ContextMenuSeparator,
  Shortcut: ContextMenuShortcut,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
}

const renderActions = (actions: TaskMenuAction[], kit: MenuKit) =>
  actions.map((action, index) => {
    if (action.type === 'separator') return <kit.Separator key={`separator-${index}`} />
    if (action.type === 'submenu') {
      return (
        <kit.Sub key={action.label}>
          <kit.SubTrigger>{action.label}</kit.SubTrigger>
          <kit.SubContent className="tf-menu">
            {action.items.map((item) => (
              <kit.CheckboxItem key={item.label} checked={item.checked} onSelect={() => item.onSelect()}>
                {item.accent ? <span className="tf-menu-dot" style={{ background: item.accent }} /> : null}
                {item.label}
              </kit.CheckboxItem>
            ))}
          </kit.SubContent>
        </kit.Sub>
      )
    }
    return (
      <kit.Item key={action.label} onSelect={action.onSelect} variant={action.destructive ? 'destructive' : 'default'}>
        {action.label}
        {action.shortcut ? <kit.Shortcut>{action.shortcut}</kit.Shortcut> : null}
      </kit.Item>
    )
  })

type TaskRowProps = {
  task: TodoTask
  selected: boolean
  focused: boolean
  dueLabel: string
  overdue: boolean
  menuOpen: boolean
  actions: TaskMenuAction[]
  startFocusLabel: string
  moreLabel: string
  onSelect: (id: string) => void
  onToggle: (task: TodoTask) => void
  onStartFocus: (task: TodoTask) => void
  onEdit: (task: TodoTask) => void
  onMenuOpenChange: (id: string, open: boolean) => void
}

export const TaskRow = memo(function TaskRow({
  task,
  selected,
  focused,
  dueLabel,
  overdue,
  menuOpen,
  actions,
  startFocusLabel,
  moreLabel,
  onSelect,
  onToggle,
  onStartFocus,
  onEdit,
  onMenuOpenChange,
}: TaskRowProps) {
  const showPomodoros = task.pomodoros > 0 || Boolean(task.estimate)

  return (
    <ContextMenu onOpenChange={(open) => open && onSelect(task.id)}>
      <ContextMenuTrigger asChild>
        <div
          data-task-id={task.id}
          className={cn('tf-row', selected && 'is-selected', task.done && 'is-done', focused && 'is-focused')}
          onMouseDown={() => onSelect(task.id)}
          onDoubleClick={() => onEdit(task)}
        >
          <button
            type="button"
            className={cn('tf-check', `is-p${task.priority}`, task.done && 'is-checked')}
            onClick={(event) => {
              event.stopPropagation()
              onToggle(task)
            }}
            aria-label={task.title}
          >
            {task.done ? <Check size={12} strokeWidth={3} /> : null}
          </button>

          <div className="tf-row-title">{task.title}</div>

          <div className="tf-row-meta">
            {task.tags.map((tag) => (
              <span key={tag} className="tf-tag" style={{ '--tf-tag-hue': tagHue(tag) } as React.CSSProperties}>
                #{tag}
              </span>
            ))}
            {showPomodoros ? (
              <span className={cn('tf-pomo', focused && 'is-live')}>
                <Timer size={12} />
                {task.estimate ? `${task.pomodoros}/${task.estimate}` : task.pomodoros}
              </span>
            ) : null}
            {dueLabel ? <span className={cn('tf-due', overdue && 'is-overdue')}>{dueLabel}</span> : null}
          </div>

          <div className={cn('tf-row-actions', menuOpen && 'is-visible')}>
            {!task.done ? (
              <button
                type="button"
                className="tf-icon-button"
                title={startFocusLabel}
                onClick={(event) => {
                  event.stopPropagation()
                  onStartFocus(task)
                }}
              >
                <Play size={14} />
              </button>
            ) : null}
            <DropdownMenu open={menuOpen} onOpenChange={(open) => onMenuOpenChange(task.id, open)}>
              <DropdownMenuTrigger asChild>
                <button type="button" className="tf-icon-button" title={moreLabel}>
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="tf-menu"
                onCloseAutoFocus={(event) => event.preventDefault()}
                onEscapeKeyDown={(event) => event.stopPropagation()}
              >
                {renderActions(actions, dropdownKit)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        className="tf-menu"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        {renderActions(actions, contextKit)}
      </ContextMenuContent>
    </ContextMenu>
  )
})
