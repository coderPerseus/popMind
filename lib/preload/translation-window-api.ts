import { ipcRenderer } from 'electron'
import { TranslationWindowChannel } from '@/lib/translation/shared'
import type {
  TranslationSpeechState,
  TranslationWindowPreloadApi,
  TranslationWindowResizePayload,
  TranslationWindowState,
} from '@/lib/translation/types'

export const translationWindowApi: TranslationWindowPreloadApi = {
  onState(handler) {
    const listener = (_event: Electron.IpcRendererEvent, state: TranslationWindowState) => {
      handler(state)
    }

    ipcRenderer.on(TranslationWindowChannel.State, listener)
    return () => ipcRenderer.removeListener(TranslationWindowChannel.State, listener)
  },
  onSpeechState(handler) {
    const listener = (_event: Electron.IpcRendererEvent, state: TranslationSpeechState) => {
      handler(state)
    }

    ipcRenderer.on(TranslationWindowChannel.SpeechState, listener)
    return () => ipcRenderer.removeListener(TranslationWindowChannel.SpeechState, listener)
  },
  getState() {
    return ipcRenderer.invoke(TranslationWindowChannel.GetState)
  },
  getSpeechState() {
    return ipcRenderer.invoke(TranslationWindowChannel.GetSpeechState)
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
  resizeWindow(payload: TranslationWindowResizePayload) {
    ipcRenderer.send(TranslationWindowChannel.Resize, payload)
  },
  dismissTopmost() {
    return ipcRenderer.invoke(TranslationWindowChannel.DismissTopmost)
  },
  copyTranslatedText() {
    return ipcRenderer.invoke(TranslationWindowChannel.Copy)
  },
  speak(payload) {
    return ipcRenderer.invoke(TranslationWindowChannel.Speak, payload)
  },
  stopSpeaking() {
    return ipcRenderer.invoke(TranslationWindowChannel.StopSpeaking)
  },
  closeWindow() {
    return ipcRenderer.invoke(TranslationWindowChannel.Close)
  },
}
