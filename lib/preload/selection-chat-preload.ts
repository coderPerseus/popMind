import { contextBridge, ipcRenderer } from 'electron'
import { SelectionChatWindowChannel } from '@/lib/selection-chat/window/shared'
import type { SelectionChatWindowPreloadApi, SelectionChatWindowState } from '@/lib/selection-chat/types'

const api: SelectionChatWindowPreloadApi = {
  onState(handler) {
    const listener = (_event: Electron.IpcRendererEvent, state: SelectionChatWindowState) => handler(state)
    ipcRenderer.on(SelectionChatWindowChannel.State, listener)
    return () => ipcRenderer.removeListener(SelectionChatWindowChannel.State, listener)
  },
  getState() {
    return ipcRenderer.invoke(SelectionChatWindowChannel.GetState)
  },
  submitMessage(message) {
    return ipcRenderer.invoke(SelectionChatWindowChannel.SubmitMessage, message)
  },
  regenerate() {
    return ipcRenderer.invoke(SelectionChatWindowChannel.Regenerate)
  },
  stop() {
    return ipcRenderer.invoke(SelectionChatWindowChannel.Stop)
  },
  setPinned(pinned) {
    return ipcRenderer.invoke(SelectionChatWindowChannel.SetPinned, pinned)
  },
  setDragging(isDragging) {
    ipcRenderer.send(SelectionChatWindowChannel.SetDragging, isDragging)
  },
  closeWindow() {
    return ipcRenderer.invoke(SelectionChatWindowChannel.Close)
  },
  copyMessage(messageId) {
    return ipcRenderer.invoke(SelectionChatWindowChannel.CopyMessage, messageId)
  },
  dismissTopmost() {
    return ipcRenderer.invoke(SelectionChatWindowChannel.DismissTopmost)
  },
  notifyInteraction(durationMs) {
    ipcRenderer.send(SelectionChatWindowChannel.NotifyInteraction, durationMs)
  },
  moveWindow(deltaX, deltaY) {
    ipcRenderer.send(SelectionChatWindowChannel.Move, deltaX, deltaY)
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('selectionChatWindow', api)
} else {
  ;(window as Window & { selectionChatWindow: SelectionChatWindowPreloadApi }).selectionChatWindow = api
}
