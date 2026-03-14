import type { ConveyorApi } from '@/lib/conveyor/api'

declare global {
  interface Window {
    conveyor: ConveyorApi
    selectionChatWindow: import('@/lib/selection-chat/types').SelectionChatWindowPreloadApi
    translationWindow: import('@/lib/translation/types').TranslationWindowPreloadApi
  }
}
