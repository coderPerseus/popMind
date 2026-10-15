import { UPDATE_DOWNLOAD_STATE_CHANNEL, type UpdateDownloadState } from '@/lib/app/release'
import { ConveyorApi } from '@/lib/preload/shared'

export class AppApi extends ConveyorApi {
  version = () => this.invoke('version')
  latestRelease = () => this.invoke('latestRelease')
  downloadAndInstallUpdate = () => this.invoke('downloadAndInstallUpdate')
  getUpdateDownloadState = () => this.invoke('getUpdateDownloadState')
  onUpdateDownloadState = (handler: (state: UpdateDownloadState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateDownloadState) => handler(state)
    this.renderer.on(UPDATE_DOWNLOAD_STATE_CHANNEL, listener)
    return () => {
      this.renderer.removeListener(UPDATE_DOWNLOAD_STATE_CHANNEL, listener)
    }
  }
  checkAccessibility = () => this.invoke('checkAccessibility')
  openAccessibilitySettings = () => this.invoke('openAccessibilitySettings')
  checkScreenRecording = () => this.invoke('checkScreenRecording')
  openScreenRecordingSettings = () => this.invoke('openScreenRecordingSettings')
  exportLogs = () => this.invoke('exportLogs')
  getThemeMode = () => this.invoke('getThemeMode')
  setThemeMode = (mode: 'light' | 'dark' | 'system') => this.invoke('setThemeMode', mode)
  searchInstalledApps = (query: string, limit = 8) => this.invoke('searchInstalledApps', query, limit)
  openInstalledApp = (appPath: string) => this.invoke('openInstalledApp', appPath)
  getBlockedSelectionApps = () => this.invoke('getBlockedSelectionApps')
  removeBlockedSelectionApp = (bundleId: string) => this.invoke('removeBlockedSelectionApp', bundleId)
  getShortcutStatus = () => this.invoke('getShortcutStatus')
  setShortcutRecording = (recording: boolean) => this.invoke('setShortcutRecording', recording)
}
