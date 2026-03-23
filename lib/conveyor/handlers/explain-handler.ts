import { BrowserWindow } from 'electron'
import { mainExplainSessionService } from '@/lib/explain/main-session-service'
import { MainExplainChannel } from '@/lib/explain/shared'
import { handle } from '@/lib/main/shared'

const emitState = () => {
  const state = { session: mainExplainSessionService.getState() }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(MainExplainChannel.State, state)
    }
  }
}

export const registerExplainHandlers = () => {
  mainExplainSessionService.subscribe(() => {
    emitState()
  })

  handle('explain-get-state', () => ({ session: mainExplainSessionService.getState() }))
  handle('explain-start', async (selectionText: string) => {
    await mainExplainSessionService.startSession(selectionText)
    return { ok: true }
  })
  handle('explain-submit', async (message: string) => {
    await mainExplainSessionService.submitMessage(message)
    return { ok: true }
  })
  handle('explain-regenerate', async () => {
    await mainExplainSessionService.regenerate()
    return { ok: true }
  })
  handle('explain-stop', async () => {
    await mainExplainSessionService.stop()
    return { ok: true }
  })
  handle('explain-reset', async () => {
    await mainExplainSessionService.reset()
    return { ok: true }
  })
}
