import { type App, shell, systemPreferences } from 'electron'
import { installedAppService } from '@/lib/app/installed-app-service'
import { fetchLatestRelease } from '@/lib/app/latest-release'
import { compareReleaseVersions } from '@/lib/app/release'
import { getMacCodeSigningInfo } from '@/lib/main/macos-code-signing'
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
  handle('latestRelease', async () => {
    const currentVersion = app.getVersion()
    const latestRelease = await fetchLatestRelease()

    mainLogger.info('[app] latest release resolved', {
      currentVersion,
      latestVersion: latestRelease?.version ?? null,
      updateAvailable: latestRelease ? compareReleaseVersions(latestRelease.version, currentVersion) > 0 : false,
      url: latestRelease?.url ?? null,
      debugOverride: process.env.POPMIND_DEBUG_LATEST_RELEASE_VERSION ?? null,
    })

    return latestRelease
  })

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

  handle('getPermissionDiagnostics', async () => {
    if (process.platform !== 'darwin') {
      return {
        supported: false,
        isPackaged: app.isPackaged,
        issue: null,
        isAdhocSigned: null,
        appPath: null,
        identifier: null,
        signature: null,
        teamIdentifier: null,
      }
    }

    const signingInfo = app.isPackaged ? await getMacCodeSigningInfo() : null
    const status = {
      supported: true,
      isPackaged: app.isPackaged,
      issue: app.isPackaged && signingInfo?.isAdhoc ? 'adhoc_signature' : null,
      isAdhocSigned: signingInfo?.isAdhoc ?? null,
      appPath: signingInfo?.appPath ?? null,
      identifier: signingInfo?.identifier ?? null,
      signature: signingInfo?.signature ?? null,
      teamIdentifier: signingInfo?.teamIdentifier ?? null,
    } as const

    mainLogger.info('[permissions] diagnostics', status)

    return status
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
