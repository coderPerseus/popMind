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
  triggerCommand(commandId, selectionId) {
    return ipcRenderer.invoke(TextPickerChannel.Command, commandId, selectionId)
  },
  hideBubble() {
    return ipcRenderer.invoke(TextPickerChannel.HideBubble)
  },
  moveBubble(deltaX, deltaY) {
    ipcRenderer.send(TextPickerChannel.MoveBubble, deltaX, deltaY)
  },
  resizeBubble(width) {
    ipcRenderer.send(TextPickerChannel.ResizeBubble, width)
  },
  setBubbleDragging(isDragging) {
    ipcRenderer.send(TextPickerChannel.SetBubbleDragging, isDragging)
  },
  openMainWindow() {
    return ipcRenderer.invoke(TextPickerChannel.OpenMainWindow)
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
