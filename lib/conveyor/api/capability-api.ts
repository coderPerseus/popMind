import { CapabilityChannel } from '@/lib/capability/store'
import type { CapabilitySettings, CapabilitySettingsPatch } from '@/lib/capability/types'
import { ConveyorApi } from '@/lib/preload/shared'

export class CapabilityApi extends ConveyorApi {
  getSettings = () => this.invoke('capability-get-settings')
  updateSettings = (patch: CapabilitySettingsPatch) => this.invoke('capability-update-settings', patch)
  testAiService = (settings: CapabilitySettings) => this.invoke('capability-test-ai-service', settings)
  onState = (handler: (settings: CapabilitySettings) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: CapabilitySettings) => handler(settings)
    this.renderer.on(CapabilityChannel.State, listener)
    return () => {
      this.renderer.removeListener(CapabilityChannel.State, listener)
    }
  }
}
