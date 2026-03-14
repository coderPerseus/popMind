import { contextBridge, ipcRenderer } from 'electron'
import { TextPickerChannel } from '@/lib/text-picker/shared'
import type { BubblePreloadApi, BubbleUpdatePayload } from '@/lib/text-picker/shared'

const preloadLog = (...args: unknown[]) => {
  console.info('[bubble-preload]', new Date().toISOString(), ...args)
}

const bubbleApi: BubblePreloadApi = {
  onUpdate(handler) {
    const listener = (_event: Electron.IpcRendererEvent, payload: BubbleUpdatePayload) => {
      preloadLog('onUpdate', payload)
      handler(payload)
    }

    ipcRenderer.on(TextPickerChannel.BubbleUpdate, listener)
    return () => ipcRenderer.removeListener(TextPickerChannel.BubbleUpdate, listener)
  },
  triggerCommand(commandId, selectionId) {
    preloadLog('triggerCommand:invoke', { commandId, selectionId })
    return ipcRenderer.invoke(TextPickerChannel.Command, commandId, selectionId).then((result) => {
      preloadLog('triggerCommand:result', { commandId, selectionId, result })
      return result
    })
  },
  openMainWindow(query) {
    preloadLog('openMainWindow:invoke', { query })
    return ipcRenderer.invoke(TextPickerChannel.OpenMainWindow, query).then((result) => {
      preloadLog('openMainWindow:result', { query, result })
      return result
    })
  },
  hideBubble() {
    preloadLog('hideBubble:invoke')
    return ipcRenderer.invoke(TextPickerChannel.HideBubble).then((result) => {
      preloadLog('hideBubble:result', result)
      return result
    })
  },
  dismissTopmost() {
    preloadLog('dismissTopmost:invoke')
    return ipcRenderer.invoke(TextPickerChannel.DismissTopmost).then((result) => {
      preloadLog('dismissTopmost:result', result)
      return result
    })
  },
  moveBubble(deltaX, deltaY) {
    preloadLog('moveBubble', { deltaX, deltaY })
    ipcRenderer.send(TextPickerChannel.MoveBubble, deltaX, deltaY)
  },
  resizeBubble(width) {
    preloadLog('resizeBubble', { width })
    ipcRenderer.send(TextPickerChannel.ResizeBubble, width)
  },
  setBubbleDragging(isDragging) {
    preloadLog('setBubbleDragging', { isDragging })
    ipcRenderer.send(TextPickerChannel.SetBubbleDragging, isDragging)
  },
  notifyBubbleInteraction() {
    preloadLog('notifyBubbleInteraction')
    ipcRenderer.send(TextPickerChannel.NotifyBubbleInteraction)
  },
  getPickedInfo() {
    preloadLog('getPickedInfo:invoke')
    return ipcRenderer.invoke(TextPickerChannel.GetPickedInfo).then((result) => {
      preloadLog('getPickedInfo:result', result)
      return result
    })
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
    preloadLog('getSkills:invoke')
    return ipcRenderer.invoke(TextPickerChannel.GetSkills).then((result) => {
      preloadLog('getSkills:result', result)
      return result
    })
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('textPicker', bubbleApi)
} else {
  window.textPicker = bubbleApi
}
