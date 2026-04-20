import { contextBridge } from 'electron'
import { translationWindowApi } from './translation-window-api'

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('translationWindow', translationWindowApi)
} else {
  window.translationWindow = translationWindowApi
}
