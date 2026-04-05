import { ConveyorApi } from '@/lib/preload/shared'

export class AppApi extends ConveyorApi {
  version = () => this.invoke('version')
  latestRelease = () => this.invoke('latestRelease')
  checkAccessibility = () => this.invoke('checkAccessibility')
  openAccessibilitySettings = () => this.invoke('openAccessibilitySettings')
  checkScreenRecording = () => this.invoke('checkScreenRecording')
  openScreenRecordingSettings = () => this.invoke('openScreenRecordingSettings')
  resetMacPermissionHistory = () => this.invoke('resetMacPermissionHistory')
  getPermissionDiagnostics = () => this.invoke('getPermissionDiagnostics')
  getThemeMode = () => this.invoke('getThemeMode')
  setThemeMode = (mode: 'light' | 'dark' | 'system') => this.invoke('setThemeMode', mode)
  searchInstalledApps = (query: string, limit = 8) => this.invoke('searchInstalledApps', query, limit)
  openInstalledApp = (appPath: string) => this.invoke('openInstalledApp', appPath)
}
