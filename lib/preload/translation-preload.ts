import { contextBridge, ipcRenderer } from 'electron'
import { TranslationWindowChannel } from '@/lib/translation/shared'
import type { TranslationWindowPreloadApi, TranslationWindowState } from '@/lib/translation/types'

const translationWindowApi: TranslationWindowPreloadApi = {
  onState(handler) {
    const listener = (_event: Electron.IpcRendererEvent, state: TranslationWindowState) => {
      handler(state)
    }

    ipcRenderer.on(TranslationWindowChannel.State, listener)
    return () => ipcRenderer.removeListener(TranslationWindowChannel.State, listener)
  },
  getState() {
    return ipcRenderer.invoke(TranslationWindowChannel.GetState)
  },
  retranslate(payload) {
    return ipcRenderer.invoke(TranslationWindowChannel.Retranslate, payload)
  },
  setPinned(pinned) {
    return ipcRenderer.invoke(TranslationWindowChannel.SetPinned, pinned)
  },
  setDragging(isDragging) {
    ipcRenderer.send(TranslationWindowChannel.SetDragging, isDragging)
  },
  notifyInteraction(durationMs) {
    ipcRenderer.send(TranslationWindowChannel.NotifyInteraction, durationMs)
  },
  moveWindow(deltaX, deltaY) {
    ipcRenderer.send(TranslationWindowChannel.Move, deltaX, deltaY)
  },
  resizeWindow(height) {
    ipcRenderer.send(TranslationWindowChannel.Resize, height)
  },
  copyTranslatedText() {
    return ipcRenderer.invoke(TranslationWindowChannel.Copy)
  },
  closeWindow() {
    return ipcRenderer.invoke(TranslationWindowChannel.Close)
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('translationWindow', translationWindowApi)
} else {
  window.translationWindow = translationWindowApi
}
