// Pomodoro timer (main process), so it keeps running while the launcher is hidden. Shows the countdown next to the
// menu bar icon, notifies at the end of each phase and credits finished focus time to the task.
import { BrowserWindow, Notification } from 'electron'
import { capabilityStore } from '@/lib/capability/store'
import { resolveAppLanguage } from '@/lib/i18n/shared'
import { mainLogger } from '@/lib/main/logger'
import { setStatusTrayTitle } from '@/lib/main/tray-icon'
import { showMainWindow } from '@/lib/main/window-manager'
import { todoT } from '@/lib/todo-focus/i18n'
import { focusOverlay } from '@/lib/todo-focus/overlay-window'
import { TodoChannel, todoStore } from '@/lib/todo-focus/store'
import type { FocusPhase, FocusSettings, FocusState } from '@/lib/todo-focus/types'

const MINUTE = 60_000
/** Abandoned focus shorter than this is not recorded. */
const MIN_RECORDED_MS = MINUTE

type Running = {
  phase: Exclude<FocusPhase, 'idle'>
  taskId?: string
  taskTitle?: string
  startedAt: number
  durationMs: number
  endsAt?: number
  pausedRemainingMs?: number
}

const formatClock = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

class FocusService {
  private running: Running | null = null
  private cycleCount = 0
  /** Task of the last finished focus run, for a break started later from the overlay. */
  private lastFocusTask: { id?: string; title?: string } | undefined
  private phaseTimer: NodeJS.Timeout | null = null
  private tickTimer: NodeJS.Timeout | null = null

  constructor() {
    // Task renames / deletions must reach the focus card.
    todoStore.onChange(() => {
      if (!this.running?.taskId) return
      const task = todoStore.getTask(this.running.taskId)
      const title = task?.title
      if (title !== this.running.taskTitle) {
        this.running.taskTitle = title
        if (!task) this.running.taskId = undefined
        this.broadcast()
      }
    })
  }

  private get settings(): FocusSettings {
    return todoStore.getSettings()
  }

  getState(): FocusState {
    const running = this.running
    return {
      phase: running?.phase ?? 'idle',
      taskId: running?.taskId,
      taskTitle: running?.taskTitle,
      startedAt: running?.startedAt,
      endsAt: running?.endsAt,
      pausedRemainingMs: running?.pausedRemainingMs,
      paused: Boolean(running && running.pausedRemainingMs !== undefined),
      durationMs: running?.durationMs,
      cycleCount: this.cycleCount,
      today: todoStore.todayStats(),
      settings: this.settings,
    }
  }

  private broadcast() {
    const state = this.getState()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(TodoChannel.Focus, state)
    }
    this.updateTrayTitle()
    return state
  }

  private remainingMs() {
    const running = this.running
    if (!running) return 0
    return running.pausedRemainingMs ?? Math.max(0, (running.endsAt ?? Date.now()) - Date.now())
  }

  private updateTrayTitle() {
    if (!this.running) {
      setStatusTrayTitle('')
      return
    }
    const clock = formatClock(this.remainingMs())
    setStatusTrayTitle(this.running.pausedRemainingMs !== undefined ? `⏸ ${clock}` : clock)
  }

  private clearTimers() {
    if (this.phaseTimer) clearTimeout(this.phaseTimer)
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.phaseTimer = null
    this.tickTimer = null
  }

  private armTimers() {
    this.clearTimers()
    const running = this.running
    if (!running || running.endsAt === undefined) return
    this.phaseTimer = setTimeout(() => void this.finishPhase(), Math.max(0, running.endsAt - Date.now()))
    this.tickTimer = setInterval(() => this.updateTrayTitle(), 1000)
  }

  private enter(phase: Running['phase'], minutes: number, task?: { id?: string; title?: string }) {
    const now = Date.now()
    const durationMs = minutes * MINUTE
    this.running = {
      phase,
      taskId: task?.id,
      taskTitle: task?.title,
      startedAt: now,
      durationMs,
      endsAt: now + durationMs,
    }
    this.armTimers()
    if (phase === 'focus' && this.settings.celebrate) focusOverlay.prewarm()
    mainLogger.info('[focus] phase started', { phase, minutes, taskId: task?.id })
    return this.broadcast()
  }

  /** Focus time of the current run so far (excluding pauses). */
  private focusedMs() {
    const running = this.running
    if (!running || running.phase !== 'focus') return 0
    return Math.max(0, running.durationMs - this.remainingMs())
  }

  /** Records the current focus run if long enough; `completed` = ran the full length. */
  private recordFocus(completed: boolean) {
    const running = this.running
    if (!running || running.phase !== 'focus') return
    const focusedMs = completed ? running.durationMs : this.focusedMs()
    if (!completed && focusedMs < MIN_RECORDED_MS) return
    todoStore.recordSession({
      taskId: running.taskId,
      startedAt: running.startedAt,
      endedAt: Date.now(),
      minutes: Math.round(focusedMs / MINUTE),
      completed,
    })
  }

  start(taskId?: string) {
    focusOverlay.hide('new-focus')
    if (this.running) this.stop()
    const task = taskId ? todoStore.getTask(taskId) : null
    return this.enter('focus', this.settings.focusMinutes, task ? { id: task.id, title: task.title } : undefined)
  }

  pause() {
    const running = this.running
    if (!running || running.pausedRemainingMs !== undefined) return this.getState()
    running.pausedRemainingMs = this.remainingMs()
    running.endsAt = undefined
    this.clearTimers()
    mainLogger.info('[focus] paused', { phase: running.phase, remainingMs: running.pausedRemainingMs })
    return this.broadcast()
  }

  resume() {
    const running = this.running
    if (!running || running.pausedRemainingMs === undefined) return this.getState()
    running.endsAt = Date.now() + running.pausedRemainingMs
    running.pausedRemainingMs = undefined
    this.armTimers()
    mainLogger.info('[focus] resumed', { phase: running.phase })
    return this.broadcast()
  }

  stop() {
    if (!this.running) return this.getState()
    this.recordFocus(false)
    mainLogger.info('[focus] stopped', { phase: this.running.phase, focusedMs: this.focusedMs() })
    this.clearTimers()
    this.running = null
    return this.broadcast()
  }

  skipBreak() {
    if (this.running && this.running.phase !== 'focus') {
      this.clearTimers()
      this.running = null
      mainLogger.info('[focus] break skipped')
    }
    return this.broadcast()
  }

  /** Marks the focused task done and ends the run, keeping the focus time. */
  completeTask() {
    const running = this.running
    if (!running) return this.getState()
    const taskId = running.taskId
    const fullLength = running.phase === 'focus' && this.remainingMs() === 0
    this.recordFocus(fullLength)
    this.clearTimers()
    this.running = null
    if (taskId) todoStore.update(taskId, { done: true })
    return this.broadcast()
  }

  private nextBreak() {
    const settings = this.settings
    const longBreak = this.cycleCount > 0 && this.cycleCount % settings.longBreakEvery === 0
    return { longBreak, minutes: longBreak ? settings.longBreakMinutes : settings.shortBreakMinutes }
  }

  /** Plays the end-of-pomodoro moment without touching the timer (settings "preview"). */
  async previewCelebration() {
    const settings = this.settings
    const today = todoStore.todayStats()
    const { longBreak, minutes } = this.nextBreak()
    await focusOverlay.show({
      language: await this.language(),
      taskTitle: this.running?.taskTitle ?? this.lastFocusTask?.title,
      todayPomodoros: Math.max(1, today.pomodoros),
      todayFocusMinutes: Math.max(settings.focusMinutes, today.focusMinutes),
      breakMinutes: minutes,
      longBreak,
      breakEndsAt: Date.now() + minutes * MINUTE,
      sound: settings.sound,
      preview: true,
    })
  }

  /** Break offered by the overlay when breaks do not start automatically. */
  startBreak() {
    if (this.running) return this.getState()
    const { longBreak, minutes } = this.nextBreak()
    return this.enter(longBreak ? 'longBreak' : 'shortBreak', minutes, this.lastFocusTask)
  }

  updateSettings(patch: Partial<FocusSettings>) {
    todoStore.updateSettings(patch)
    return this.broadcast()
  }

  private async language() {
    try {
      return resolveAppLanguage((await capabilityStore.getSettings()).appLanguage)
    } catch {
      return resolveAppLanguage(undefined)
    }
  }

  private notify(title: string, body: string) {
    if (!Notification.isSupported()) return
    const notification = new Notification({ title, body, silent: !this.settings.sound })
    notification.on('click', () => void showMainWindow('home', { searchQuery: '/todo ' }))
    notification.show()
  }

  private async finishPhase() {
    const running = this.running
    if (!running) return
    this.clearTimers()
    const language = await this.language()
    // A stop / restart during the await wins.
    if (this.running !== running) return
    const settings = this.settings

    if (running.phase === 'focus') {
      this.recordFocus(true)
      this.cycleCount += 1
      this.lastFocusTask = { id: running.taskId, title: running.taskTitle }
      const { longBreak, minutes: breakMinutes } = this.nextBreak()
      const task = running.taskTitle ?? todoT(language, 'focus.noTask')
      mainLogger.info('[focus] focus finished', { taskId: running.taskId, cycleCount: this.cycleCount })

      if (settings.autoStartBreak) {
        this.enter(longBreak ? 'longBreak' : 'shortBreak', breakMinutes, this.lastFocusTask)
      } else {
        this.running = null
        this.broadcast()
      }

      if (settings.celebrate) {
        const today = todoStore.todayStats()
        void focusOverlay.show({
          language,
          taskTitle: running.taskTitle,
          todayPomodoros: today.pomodoros,
          todayFocusMinutes: today.focusMinutes,
          breakMinutes,
          longBreak,
          breakEndsAt: this.running?.endsAt,
          sound: settings.sound,
        })
      } else {
        this.notify(
          todoT(language, 'notify.focusDone.title'),
          settings.autoStartBreak
            ? todoT(language, 'notify.focusDone.body', { task, minutes: breakMinutes })
            : todoT(language, 'notify.focusDone.bodyNoBreak', { task })
        )
      }
      return
    }

    if (running.phase === 'longBreak') this.cycleCount = 0
    mainLogger.info('[focus] break finished', { phase: running.phase })
    this.notify(todoT(language, 'notify.breakDone.title'), todoT(language, 'notify.breakDone.body'))
    this.running = null
    this.broadcast()
  }

  dispose() {
    // Credit a running focus before quitting.
    this.recordFocus(false)
    this.clearTimers()
    this.running = null
    focusOverlay.dispose()
    setStatusTrayTitle('')
    todoStore.flush()
  }
}

export const focusService = new FocusService()
