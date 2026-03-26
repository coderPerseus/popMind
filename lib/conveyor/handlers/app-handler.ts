import { type App, shell, systemPreferences } from 'electron'
import { installedAppService } from '@/lib/app/installed-app-service'
import { fetchLatestRelease } from '@/lib/app/latest-release'
import { mainLogger } from '@/lib/main/logger'
import { handle } from '@/lib/main/shared'
import { themeStore } from '@/lib/main/theme-store'
import { selectionBridge } from '@/lib/text-picker/native/selection-bridge'

export const registerAppHandlers = (app: App) => {
  const checkScreenRecording = () => {
    if (process.platform !== 'darwin') {
      return {
        granted: false,
        supported: false,
      }
    }

    try {
      return {
        granted: systemPreferences.getMediaAccessStatus('screen') === 'granted',
        supported: true,
      }
    } catch {
      return {
        granted: false,
        supported: false,
      }
    }
  }

  handle('version', () => app.getVersion())
  handle('latestRelease', () => fetchLatestRelease())

  handle('checkAccessibility', () => {
    const status = {
      granted: selectionBridge.isSupported ? selectionBridge.checkPermission(false) : false,
      supported: selectionBridge.isSupported,
    }

    mainLogger.info('[permissions] check accessibility', status)

    return status
  })

  handle('openAccessibilitySettings', async () => {
    mainLogger.info('[permissions] open accessibility settings')

    if (selectionBridge.isSupported) {
      selectionBridge.checkPermission(true)
    }
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    return true
  })

  handle('checkScreenRecording', () => {
    const status = checkScreenRecording()
    mainLogger.info('[permissions] check screen recording', status)
    return status
  })

  handle('openScreenRecordingSettings', async () => {
    mainLogger.info('[permissions] open screen recording settings')
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    return true
  })

  handle('getThemeMode', () => themeStore.getThemeMode())

  handle('setThemeMode', async (mode) => {
    return themeStore.setThemeMode(mode)
  })

  handle('searchInstalledApps', async (query, limit) => {
    return installedAppService.search(query, limit)
  })

  handle('openInstalledApp', async (appPath) => {
    const errorMessage = await shell.openPath(appPath)

    if (errorMessage) {
      throw new Error(errorMessage)
    }

    return true
  })
}
