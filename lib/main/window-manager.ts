import { app, BrowserWindow } from 'electron'
import { createAppWindow } from './app'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

app.once('before-quit', () => {
  isQuitting = true
})

const presentMainWindow = (window: BrowserWindow) => {
  if (window.isDestroyed()) {
    return
  }

  if (process.platform === 'darwin') {
    // Switch to regular app activation before showing main window, so macOS
    // changes focus to popMind instead of rendering above a fullscreen app.
    app.setActivationPolicy('regular')
    app.focus({ steal: true })
  }

  if (window.isMinimized()) {
    window.restore()
  }

  window.show()
  if (process.platform !== 'darwin') {
    app.focus({ steal: true })
  }
  window.focus()
}

const attachMainWindowLifecycle = (window: BrowserWindow) => {
  window.on('close', (event) => {
    if (isQuitting) {
      return
    }

    event.preventDefault()
    window.hide()

    if (process.platform === 'darwin') {
      // Return to tray-style behavior after the main window is hidden.
      app.setActivationPolicy('accessory')
    }
  })

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })
}

export const getOrCreateMainWindow = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }

  const window = createAppWindow()
  attachMainWindowLifecycle(window)
  mainWindow = window
  return window
}

export const showMainWindow = async () => {
  const window = getOrCreateMainWindow()

  if (window.isVisible()) {
    presentMainWindow(window)
    return window
  }

  if (window.webContents.isLoadingMainFrame()) {
    window.once('ready-to-show', () => {
      presentMainWindow(window)
    })
    return window
  }

  presentMainWindow(window)
  return window
}
