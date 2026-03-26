import { clipboard, ipcMain, screen } from 'electron'
import type { ExplainImageContext } from '@/lib/explain/types'
import { autoDismissController } from '@/lib/windowing/auto-dismiss-controller'
import { selectionChatService } from '@/lib/selection-chat/service'
import type { SelectionChatWindowState } from '@/lib/selection-chat/types'
import type { SelectionBridge } from '@/lib/text-picker/shared'
import { SelectionChatWindow } from './selection-chat-window'
import { SelectionChatWindowChannel } from './shared'

const WINDOW_GAP = 14
const APP_ACTIVATE_SUPPRESS_MS = 700

export class SelectionChatWindowManager {
  private window: SelectionChatWindow | null = null
  private state: SelectionChatWindowState = { session: null }
  private unsubscribeService: (() => void) | null = null

  constructor(
    private readonly bridge: SelectionBridge,
    _logger: Console = console,
    private readonly floatingBridge?: {
      noteInteraction?: (durationMs?: number) => void
      setDragging?: (isDragging: boolean) => void
    }
  ) {
    this.setupIpc()
    this.unsubscribeService = selectionChatService.subscribe((session) => {
      this.state = { session }
      this.sendState()
    })
  }

  async open(payload: {
    text: string
    selectionId?: string
    sourceAppId?: string
    sourceAppName?: string
    contextImage?: ExplainImageContext
    anchor: { x: number; topY: number; bottomY: number } | null
  }) {
    autoDismissController.dispatch({
      reason: 'surface-opened',
      target: 'selection-chat',
    })

    this.ensureWindow()
    this.positionWindow(payload.anchor)
    this.showWindow()
    await selectionChatService.openSession({
      selectionText: payload.text,
      selectionId: payload.selectionId,
      sourceAppId: payload.sourceAppId,
      sourceAppName: payload.sourceAppName,
      contextImage: payload.contextImage,
    })
  }

  hide() {
    void selectionChatService.close()
    this.window?.hide()
  }

  isVisible() {
    return this.window?.isVisible() ?? false
  }

  isPinned() {
    return this.state.session?.pinned ?? false
  }

  containsPoint(x: number, y: number) {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) {
      return false
    }

    const bounds = this.window.getBounds()
    return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
  }

  dispose() {
    ipcMain.removeHandler(SelectionChatWindowChannel.GetState)
    ipcMain.removeHandler(SelectionChatWindowChannel.SubmitMessage)
    ipcMain.removeHandler(SelectionChatWindowChannel.Regenerate)
    ipcMain.removeHandler(SelectionChatWindowChannel.Stop)
    ipcMain.removeHandler(SelectionChatWindowChannel.SetPinned)
    ipcMain.removeHandler(SelectionChatWindowChannel.CopyMessage)
    ipcMain.removeHandler(SelectionChatWindowChannel.Close)
    ipcMain.removeHandler(SelectionChatWindowChannel.DismissTopmost)
    ipcMain.removeAllListeners(SelectionChatWindowChannel.NotifyInteraction)
    ipcMain.removeAllListeners(SelectionChatWindowChannel.SetDragging)
    ipcMain.removeAllListeners(SelectionChatWindowChannel.Move)
    this.unsubscribeService?.()
    this.window?.destroy()
    this.window = null
  }

  private ensureWindow() {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    this.window = new SelectionChatWindow(this.bridge)
    return this.window
  }

  private setupIpc() {
    ipcMain.handle(SelectionChatWindowChannel.GetState, async () => this.state)
    ipcMain.handle(SelectionChatWindowChannel.SubmitMessage, async (_event, message: string) => {
      this.noteInteraction()
      await selectionChatService.submitMessage(message)
      return { ok: true }
    })
    ipcMain.handle(SelectionChatWindowChannel.Regenerate, async () => {
      this.noteInteraction()
      await selectionChatService.regenerate()
      return { ok: true }
    })
    ipcMain.handle(SelectionChatWindowChannel.Stop, async () => {
      this.noteInteraction()
      await selectionChatService.stop()
      return { ok: true }
    })
    ipcMain.handle(SelectionChatWindowChannel.SetPinned, async (_event, pinned: boolean) => {
      this.noteInteraction()
      selectionChatService.setPinned(pinned)
      return { ok: true, pinned }
    })
    ipcMain.handle(SelectionChatWindowChannel.CopyMessage, async (_event, messageId: string) => {
      this.noteInteraction()
      const message = this.state.session?.messages.find((item) => item.id === messageId)
      if (message?.text) {
        clipboard.writeText(message.text)
      }
      return { ok: true }
    })
    ipcMain.handle(SelectionChatWindowChannel.Close, async () => {
      this.noteInteraction()
      await selectionChatService.close()
      this.window?.hide()
      return { ok: true }
    })
    ipcMain.handle(SelectionChatWindowChannel.DismissTopmost, async () => {
      this.noteInteraction()
      autoDismissController.dismissTopmost('escape')
      return { ok: true }
    })
    ipcMain.on(SelectionChatWindowChannel.NotifyInteraction, (_event, durationMs?: number) => {
      this.noteInteraction(typeof durationMs === 'number' ? durationMs : undefined)
    })
    ipcMain.on(SelectionChatWindowChannel.SetDragging, (_event, isDragging: boolean) => {
      this.floatingBridge?.setDragging?.(isDragging)
    })
    ipcMain.on(SelectionChatWindowChannel.Move, (_event, deltaX: number, deltaY: number) => {
      this.noteInteraction(1000)
      this.moveWindow(deltaX, deltaY)
    })
  }

  private noteInteraction(durationMs = APP_ACTIVATE_SUPPRESS_MS) {
    this.floatingBridge?.noteInteraction?.(durationMs)
  }

  private positionWindow(anchor: { x: number; topY: number; bottomY: number } | null) {
    const window = this.ensureWindow()
    const [width, height] = window.getSize()
    const cursorPoint = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(anchor ? { x: anchor.x, y: anchor.topY } : cursorPoint)
    const { workArea } = display

    let x = workArea.x + (workArea.width - width) / 2
    let y = workArea.y + (workArea.height - height) / 2

    if (anchor) {
      x = Math.max(workArea.x, Math.min(anchor.x - width / 2, workArea.x + workArea.width - width))
      y = anchor.topY - height - WINDOW_GAP
      if (y < workArea.y) {
        y = Math.min(anchor.bottomY + WINDOW_GAP, workArea.y + workArea.height - height)
      }
    }

    window.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width,
      height,
    })
  }

  private moveWindow(deltaX: number, deltaY: number) {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) {
      return
    }

    const bounds = this.window.getBounds()
    this.window.setBounds({
      ...bounds,
      x: Math.round(bounds.x + deltaX),
      y: Math.round(bounds.y + deltaY),
    })
  }

  private sendState() {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    this.window.sendState(this.state)
  }

  private showWindow() {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    this.window.showInactive()
    this.window.orderFront()
    this.sendState()
  }
}
