/// <reference types="electron-vite/node" />
import type { BubblePreloadApi } from '@/lib/text-picker/shared'
import type { SelectionChatWindowPreloadApi } from '@/lib/selection-chat/types'
import type { TranslationWindowPreloadApi } from '@/lib/translation/types'

declare module '*.css' {
  const content: string
  export default content
}

declare module '*.png' {
  const content: string
  export default content
}

declare module '*.jpg' {
  const content: string
  export default content
}

declare module '*.jpeg' {
  const content: string
  export default content
}

declare module '*.svg' {
  const content: string
  export default content
}

declare module '*.web' {
  const content: string
  export default content
}

declare global {
  interface Window {
    textPicker: BubblePreloadApi
    selectionChatWindow: SelectionChatWindowPreloadApi
    translationWindow: TranslationWindowPreloadApi
  }
}
