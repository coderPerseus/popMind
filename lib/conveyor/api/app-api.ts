import { ConveyorApi } from '@/lib/preload/shared'

export class AppApi extends ConveyorApi {
  version = () => this.invoke('version')
  latestRelease = () => this.invoke('latestRelease')
  checkAccessibility = () => this.invoke('checkAccessibility')
  openAccessibilitySettings = () => this.invoke('openAccessibilitySettings')
  getThemeMode = () => this.invoke('getThemeMode')
  setThemeMode = (mode: 'light' | 'dark' | 'system') => this.invoke('setThemeMode', mode)
}
