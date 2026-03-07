import { contextBridge, ipcRenderer } from 'electron'
import type { BubblePreloadApi, BubbleUpdatePayload } from '@/lib/text-picker/shared'

const bubbleApi: BubblePreloadApi = {
  onUpdate(handler) {
    const listener = (_event: Electron.IpcRendererEvent, payload: BubbleUpdatePayload) => {
      handler(payload)
    }

    ipcRenderer.on('bubble:update', listener)
    return () => ipcRenderer.removeListener('bubble:update', listener)
  },
  triggerCommand(commandId) {
    return ipcRenderer.invoke('textPicker:command', commandId)
  },
  hideBubble() {
    return ipcRenderer.invoke('textPicker:hideBubble')
  },
  getPickedInfo() {
    return ipcRenderer.invoke('textPicker:getPickedInfo')
  },
  getGlobalEnabled() {
    return ipcRenderer.invoke('textPicker:getGlobalEnabled')
  },
  setGlobalEnabled(enabled) {
    return ipcRenderer.invoke('textPicker:setGlobalEnabled', enabled)
  },
  getBlockApps() {
    return ipcRenderer.invoke('textPicker:getBlockApps')
  },
  addBlockApp(bundleId) {
    return ipcRenderer.invoke('textPicker:addBlockApp', bundleId)
  },
  removeBlockApp(bundleId) {
    return ipcRenderer.invoke('textPicker:removeBlockApp', bundleId)
  },
  getSkills() {
    return ipcRenderer.invoke('textPicker:getSkills')
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('textPicker', bubbleApi)
} else {
  window.textPicker = bubbleApi
}
