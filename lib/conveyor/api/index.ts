import { electronAPI } from '@electron-toolkit/preload'
import { AppApi } from './app-api'
import { CapabilityApi } from './capability-api'
import { ClipboardApi } from './clipboard-api'
import { ExplainApi } from './explain-api'
import { SearchApi } from './search-api'
import { TranslationApi } from './translation-api'
import { WindowApi } from './window-api'

export const conveyor = {
  app: new AppApi(electronAPI),
  capability: new CapabilityApi(electronAPI),
  clipboard: new ClipboardApi(electronAPI),
  window: new WindowApi(electronAPI),
  translation: new TranslationApi(electronAPI),
  explain: new ExplainApi(electronAPI),
  search: new SearchApi(electronAPI),
}

export type ConveyorApi = typeof conveyor
