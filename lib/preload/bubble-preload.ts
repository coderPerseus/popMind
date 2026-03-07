import { contextBridge, ipcRenderer } from 'electron'
import { TextPickerChannel } from '@/lib/text-picker/shared'
import type { BubblePreloadApi, BubbleUpdatePayload } from '@/lib/text-picker/shared'

const bubbleApi: BubblePreloadApi = {
  onUpdate(handler) {
    const listener = (_event: Electron.IpcRendererEvent, payload: BubbleUpdatePayload) => {
      handler(payload)
    }

    ipcRenderer.on(TextPickerChannel.BubbleUpdate, listener)
    return () => ipcRenderer.removeListener(TextPickerChannel.BubbleUpdate, listener)
  },
  triggerCommand(commandId) {
    return ipcRenderer.invoke(TextPickerChannel.Command, commandId)
  },
  hideBubble() {
    return ipcRenderer.invoke(TextPickerChannel.HideBubble)
  },
  getPickedInfo() {
    return ipcRenderer.invoke(TextPickerChannel.GetPickedInfo)
  },
  getGlobalEnabled() {
    return ipcRenderer.invoke(TextPickerChannel.GetGlobalEnabled)
  },
  setGlobalEnabled(enabled) {
    return ipcRenderer.invoke(TextPickerChannel.SetGlobalEnabled, enabled)
  },
  getBlockApps() {
    return ipcRenderer.invoke(TextPickerChannel.GetBlockApps)
  },
  addBlockApp(bundleId) {
    return ipcRenderer.invoke(TextPickerChannel.AddBlockApp, bundleId)
  },
  removeBlockApp(bundleId) {
    return ipcRenderer.invoke(TextPickerChannel.RemoveBlockApp, bundleId)
  },
  getSkills() {
    return ipcRenderer.invoke(TextPickerChannel.GetSkills)
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('textPicker', bubbleApi)
} else {
  window.textPicker = bubbleApi
}
