import { app, dialog, globalShortcut, nativeImage } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerExplainHandlers } from '@/lib/conveyor/handlers/explain-handler'
import { resolveAppLanguage, translateMessage } from '@/lib/i18n/shared'
import { initializeAppLogging, mainLogger } from '@/lib/main/logger'
import { registerSearchHandlers } from '@/lib/conveyor/handlers/search-handler'
import { registerTranslationHandlers } from '@/lib/conveyor/handlers/translation-handler'
import { clipboardHistoryService } from '@/lib/clipboard/service'
import { themeStore } from '@/lib/main/theme-store'
import { TextPickerFeature } from '@/lib/text-picker/main/text-picker-feature'
import appIcon from '@/resources/build/icon.png?asset'
import { setupApplicationMenu } from './application-menu'
import { isMainWindowVisible, primeMainWindow, showMainWindow, toggleMainWindow } from './window-manager'

let textPickerFeature: TextPickerFeature | null = null
let disposeApplicationMenu: (() => void) | null = null

const ensureMacAppInstalledInApplications = async () => {
  if (process.platform !== 'darwin' || !app.isPackaged || app.isInApplicationsFolder()) {
    return true
  }

  const language = resolveAppLanguage(app.getLocale())
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: [
      translateMessage(language, 'install.moveToApplications.notNow'),
      translateMessage(language, 'install.moveToApplications.move'),
    ],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    message: translateMessage(language, 'install.moveToApplications.title'),
    detail: translateMessage(language, 'install.moveToApplications.desc'),
  })

  if (response !== 1) {
    mainLogger.info('[app] user declined move to Applications')
    return true
  }

  try {
    const moved = app.moveToApplicationsFolder()

    mainLogger.info('[app] move to Applications result', { moved })

    // Electron quits and relaunches automatically when the move succeeds.
    return !moved
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    mainLogger.error('[app] move to Applications failed', { message })

    await dialog.showMessageBox({
      type: 'error',
      buttons: [translateMessage(language, 'common.close')],
      defaultId: 0,
      message: translateMessage(language, 'install.moveToApplications.failedTitle'),
      detail: translateMessage(language, 'install.moveToApplications.failedDesc', { message }),
    })

    return true
  }
}

const registerGlobalShortcutWithLogging = (accelerator: string, label: string, handler: () => void) => {
  globalShortcut.unregister(accelerator)

  const registered = globalShortcut.register(accelerator, () => {
    mainLogger.info('[shortcut] triggered', {
      accelerator,
      label,
    })
    handler()
  })

  mainLogger.info('[shortcut] register', {
    accelerator,
    label,
    registered,
  })

  if (!registered) {
    mainLogger.warn('[shortcut] registration failed', {
      accelerator,
      label,
    })
  }

  return registered
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  initializeAppLogging()

  mainLogger.info('[app] ready', {
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
  })

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(appIcon))
  }

  const shouldContinue = await ensureMacAppInstalledInApplications()
  if (!shouldContinue) {
    return
  }

  await themeStore.initialize()
  disposeApplicationMenu = await setupApplicationMenu()
  registerExplainHandlers()
  registerTranslationHandlers()
  registerSearchHandlers()
  clipboardHistoryService.initialize()

  // Initialize text picker feature (non-blocking)
  textPickerFeature = new TextPickerFeature()
  void textPickerFeature
    .initialize()
    .then((enabled) => {
      mainLogger.info('[app] text picker initialize completed', { enabled })
    })
    .catch((error) => {
      mainLogger.error('[app] text picker initialize failed', error)
    })

  // Preload the hidden home route so the first shortcut show is instant.
  void primeMainWindow('home')

  // Register global shortcut Option+Space to toggle the main search window
  registerGlobalShortcutWithLogging('Alt+Space', 'toggle-home', () => {
    void toggleMainWindow('home')
  })

  registerGlobalShortcutWithLogging('Alt+V', 'clipboard-history', () => {
    void showMainWindow('home', { searchQuery: '/clip ' })
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  mainLogger.info('[app] activate', {
    mainWindowVisible: isMainWindowVisible(),
  })

  if (!isMainWindowVisible()) {
    void showMainWindow('home')
  }
})

// In this file, you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
app.on('will-quit', () => {
  disposeApplicationMenu?.()
  disposeApplicationMenu = null
  globalShortcut.unregisterAll()
  clipboardHistoryService.dispose()
  textPickerFeature?.dispose()
  textPickerFeature = null
})
