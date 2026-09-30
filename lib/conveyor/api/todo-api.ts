import { ConveyorApi } from '@/lib/preload/shared'
import type {
  FocusSettings,
  FocusCelebration,
  FocusState,
  LegacyTodo,
  TodoSnapshot,
  TodoTask,
  TodoTaskDraft,
} from '@/lib/todo-focus/types'

/** Kept in sync with TodoChannel in lib/todo-focus/store.ts (preload cannot import main-process modules). */
const TodoPushChannel = { State: 'todo:state', Focus: 'todo:focus', Celebrate: 'todo:celebrate' } as const

type TodoTaskUpdate = {
  title?: string
  notes?: string
  done?: boolean
  dueDate?: string | null
  dueTime?: string | null
  priority?: 0 | 1 | 2 | 3
  tags?: string[]
  estimate?: number | null
}

export class TodoApi extends ConveyorApi {
  list = () => this.invoke('todo-list')
  create = (draft: TodoTaskDraft) => this.invoke('todo-create', draft)
  update = (id: string, patch: TodoTaskUpdate) => this.invoke('todo-update', id, patch)
  remove = (id: string) => this.invoke('todo-delete', id)
  restore = (task: TodoTask) => this.invoke('todo-restore', task)
  importLegacy = (items: LegacyTodo[]) => this.invoke('todo-import-legacy', items)
  isLegacyImported = () => this.invoke('todo-legacy-imported')
  getFocus = () => this.invoke('focus-get')
  startFocus = (taskId?: string) => this.invoke('focus-start', taskId)
  pauseFocus = () => this.invoke('focus-pause')
  resumeFocus = () => this.invoke('focus-resume')
  stopFocus = () => this.invoke('focus-stop')
  skipBreak = () => this.invoke('focus-skip-break')
  completeFocusTask = () => this.invoke('focus-complete-task')
  updateFocusSettings = (patch: Partial<FocusSettings>) => this.invoke('focus-update-settings', patch)
  startBreak = () => this.invoke('focus-start-break')
  closeOverlay = (action: 'rest' | 'skipBreak') => this.invoke('focus-overlay-close', action)
  previewOverlay = () => this.invoke('focus-overlay-preview')
  onCelebrate = (handler: (payload: FocusCelebration) => void) => this.subscribe(TodoPushChannel.Celebrate, handler)

  onState = (handler: (snapshot: TodoSnapshot) => void) => this.subscribe(TodoPushChannel.State, handler)
  onFocus = (handler: (state: FocusState) => void) => this.subscribe(TodoPushChannel.Focus, handler)

  private subscribe<T>(channel: string, handler: (payload: T) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) => handler(payload)
    this.renderer.on(channel, listener)
    return () => {
      this.renderer.removeListener(channel, listener)
    }
  }
}
