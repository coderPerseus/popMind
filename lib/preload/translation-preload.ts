import { contextBridge, ipcRenderer } from 'electron'
import type {
  TranslationSpeechState,
  TranslationWindowPreloadApi,
  TranslationWindowResizePayload,
  TranslationWindowState,
} from '@/lib/translation/types'

// Keep the translation window preload self-contained because Electron sandboxed
// preloads can fail to resolve sibling chunk files in development.
const TranslationWindowChannel = {
  State: 'translationWindow:state',
  SpeechState: 'translationWindow:speechState',
  GetState: 'translationWindow:getState',
  GetSpeechState: 'translationWindow:getSpeechState',
  Retranslate: 'translationWindow:retranslate',
  SetPinned: 'translationWindow:setPinned',
  SetDragging: 'translationWindow:setDragging',
  NotifyInteraction: 'translationWindow:notifyInteraction',
  Move: 'translationWindow:move',
  Resize: 'translationWindow:resize',
  Copy: 'translationWindow:copy',
  Speak: 'translationWindow:speak',
  StopSpeaking: 'translationWindow:stopSpeaking',
  Close: 'translationWindow:close',
  DismissTopmost: 'translationWindow:dismissTopmost',
} as const

const translationWindowApi: TranslationWindowPreloadApi = {
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

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('translationWindow', translationWindowApi)
    console.info('[translation-preload] translationWindow exposed')
  } catch (error) {
    console.error('[translation-preload] expose failed', error)
  }
} else {
  window.translationWindow = translationWindowApi
  console.info('[translation-preload] translationWindow assigned on window')
}
