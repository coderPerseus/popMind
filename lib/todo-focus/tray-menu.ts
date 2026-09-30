// Focus section of the menu bar menu: start when idle; status + pause / resume / stop while running.
import type { MenuItemConstructorOptions } from 'electron'
import type { AppLanguage } from '@/lib/capability/types'
import { focusService } from '@/lib/todo-focus/focus-service'
import { todoT } from '@/lib/todo-focus/i18n'

const formatClock = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export const buildFocusTrayItems = (language: AppLanguage): MenuItemConstructorOptions[] => {
  const state = focusService.getState()

  if (state.phase === 'idle') {
    return [{ label: todoT(language, 'tray.startFocus'), click: () => void focusService.start() }]
  }

  const remaining = state.paused
    ? (state.pausedRemainingMs ?? 0)
    : Math.max(0, (state.endsAt ?? Date.now()) - Date.now())
  const phase = state.paused
    ? todoT(language, 'focus.paused')
    : todoT(
        language,
        state.phase === 'focus'
          ? 'focus.focusing'
          : state.phase === 'longBreak'
            ? 'focus.longBreak'
            : 'focus.shortBreak'
      )
  const status = [`${phase} ${formatClock(remaining)}`, state.taskTitle].filter(Boolean).join(' · ')
  const items: MenuItemConstructorOptions[] = [{ label: status, enabled: false }]

  if (state.phase === 'focus') {
    items.push(
      state.paused
        ? { label: todoT(language, 'tray.resumeFocus'), click: () => void focusService.resume() }
        : { label: todoT(language, 'tray.pauseFocus'), click: () => void focusService.pause() },
      { label: todoT(language, 'tray.stopFocus'), click: () => void focusService.stop() }
    )
  } else {
    items.push({ label: todoT(language, 'focus.skipBreak'), click: () => void focusService.skipBreak() })
  }
  return items
}
