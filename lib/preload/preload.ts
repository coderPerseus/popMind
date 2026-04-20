import { contextBridge } from 'electron'
import { conveyor } from '@/lib/conveyor/api'
import { translationWindowApi } from './translation-window-api'

// Use `contextBridge` APIs to expose APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('conveyor', conveyor)
    contextBridge.exposeInMainWorld('translationWindow', translationWindowApi)
  } catch (error) {
    console.error(error)
  }
} else {
  window.conveyor = conveyor
  window.translationWindow = translationWindowApi
}
