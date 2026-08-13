import { contextBridge, ipcRenderer } from 'electron'
import type {
  InputTranslationOptions,
  InputTranslationWindowPreloadApi,
  InputTranslationWindowState,
} from '@/lib/input-translation/shared'

// Keep this preload self-contained so it also works in Electron's sandboxed
// development renderer, where resolving shared runtime chunks can be flaky.
const InputTranslationWindowChannel = {
  State: 'inputTranslationWindow:state',
  Focus: 'inputTranslationWindow:focus',
  GetState: 'inputTranslationWindow:getState',
  Translate: 'inputTranslationWindow:translate',
  UpdateOptions: 'inputTranslationWindow:updateOptions',
  CopyDraft: 'inputTranslationWindow:copyDraft',
  Resize: 'inputTranslationWindow:resize',
  Move: 'inputTranslationWindow:move',
  Close: 'inputTranslationWindow:close',
} as const

const inputTranslationWindowApi: InputTranslationWindowPreloadApi = {
  onState(handler) {
    const listener = (_event: Electron.IpcRendererEvent, state: InputTranslationWindowState) => handler(state)
    ipcRenderer.on(InputTranslationWindowChannel.State, listener)
    return () => ipcRenderer.removeListener(InputTranslationWindowChannel.State, listener)
  },
  onFocus(handler) {
    const listener = () => handler()
    ipcRenderer.on(InputTranslationWindowChannel.Focus, listener)
    return () => ipcRenderer.removeListener(InputTranslationWindowChannel.Focus, listener)
  },
  getState() {
    return ipcRenderer.invoke(InputTranslationWindowChannel.GetState)
  },
  translate(payload: InputTranslationOptions & { text: string }) {
    return ipcRenderer.invoke(InputTranslationWindowChannel.Translate, payload)
  },
  updateOptions(payload: InputTranslationOptions) {
    return ipcRenderer.invoke(InputTranslationWindowChannel.UpdateOptions, payload)
  },
  copyDraft(text: string) {
    return ipcRenderer.invoke(InputTranslationWindowChannel.CopyDraft, text)
  },
  resizeWindow(height: number) {
    ipcRenderer.send(InputTranslationWindowChannel.Resize, height)
  },
  moveWindow(deltaX: number, deltaY: number) {
    ipcRenderer.send(InputTranslationWindowChannel.Move, deltaX, deltaY)
  },
  closeWindow() {
    return ipcRenderer.invoke(InputTranslationWindowChannel.Close)
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('inputTranslationWindow', inputTranslationWindowApi)
} else {
  window.inputTranslationWindow = inputTranslationWindowApi
}
