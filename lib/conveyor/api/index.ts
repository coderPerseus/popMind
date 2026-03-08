import { electronAPI } from '@electron-toolkit/preload'
import { AppApi } from './app-api'
import { TranslationApi } from './translation-api'
import { WindowApi } from './window-api'

export const conveyor = {
  app: new AppApi(electronAPI),
  window: new WindowApi(electronAPI),
  translation: new TranslationApi(electronAPI),
}

export type ConveyorApi = typeof conveyor
