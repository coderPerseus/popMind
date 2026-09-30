import { handle } from '@/lib/main/shared'
import { focusService } from '@/lib/todo-focus/focus-service'
import { focusOverlay } from '@/lib/todo-focus/overlay-window'
import { todoStore } from '@/lib/todo-focus/store'
import type { TodoTaskPatch } from '@/lib/todo-focus/types'

export const registerTodoHandlers = () => {
  handle('todo-list', () => todoStore.snapshot())
  handle('todo-create', (draft) => todoStore.create(draft))
  handle('todo-update', (id, patch) => {
    // null in IPC means "clear"; the store treats a present-but-undefined key as clear.
    const normalized: TodoTaskPatch = {}
    for (const [key, value] of Object.entries(patch)) {
      ;(normalized as Record<string, unknown>)[key] = value === null ? undefined : value
    }
    return todoStore.update(id, normalized)
  })
  handle('todo-delete', (id) => {
    const removed = todoStore.remove(id)
    if (removed && focusService.getState().taskId === id) focusService.stop()
    return removed
  })
  handle('todo-restore', (task) => todoStore.restore(task))
  handle('todo-import-legacy', (items) => todoStore.importLegacy(items))
  handle('todo-legacy-imported', () => todoStore.isLegacyImported())
  handle('focus-get', () => focusService.getState())
  handle('focus-start', (taskId) => focusService.start(taskId))
  handle('focus-pause', () => focusService.pause())
  handle('focus-resume', () => focusService.resume())
  handle('focus-stop', () => focusService.stop())
  handle('focus-skip-break', () => focusService.skipBreak())
  handle('focus-complete-task', () => focusService.completeTask())
  handle('focus-update-settings', (patch) => focusService.updateSettings(patch))
  handle('focus-start-break', () => focusService.startBreak())
  handle('focus-overlay-preview', async () => {
    await focusService.previewCelebration()
    return { ok: true }
  })
  handle('focus-overlay-close', (action) => {
    focusOverlay.hide(action)
    if (action === 'skipBreak') focusService.skipBreak()
    return { ok: true }
  })
}
