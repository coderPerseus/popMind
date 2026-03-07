import { ConveyorApi } from '@/lib/preload/shared'

export class AppApi extends ConveyorApi {
  version = () => this.invoke('version')
  checkAccessibility = () => this.invoke('checkAccessibility')
  openAccessibilitySettings = () => this.invoke('openAccessibilitySettings')
}
