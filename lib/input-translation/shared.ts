import type { TranslationEngineId, TranslationLanguageOption } from '@/lib/translation/types'

export const InputTranslationWindowChannel = {
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

export type InputTranslationStatus = 'idle' | 'loading' | 'success' | 'error'

export interface InputTranslationWindowState {
  status: InputTranslationStatus
  requestId: number
  value: string
  sourceText: string
  maxWindowHeight: number
  engineId: TranslationEngineId
  enabledEngineIds: TranslationEngineId[]
  targetLanguage: string
  languages: TranslationLanguageOption[]
  copied: boolean
  errorMessage?: string
}

export interface InputTranslationOptions {
  engineId: TranslationEngineId
  targetLanguage: string
}

export interface InputTranslationWindowPreloadApi {
  onState(handler: (state: InputTranslationWindowState) => void): () => void
  onFocus(handler: () => void): () => void
  getState(): Promise<InputTranslationWindowState | null>
  translate(payload: InputTranslationOptions & { text: string }): Promise<{ ok: boolean; error?: string }>
  updateOptions(payload: InputTranslationOptions): Promise<{ ok: boolean }>
  copyDraft(text: string): Promise<{ ok: boolean }>
  resizeWindow(height: number): void
  moveWindow(deltaX: number, deltaY: number): void
  closeWindow(): Promise<{ ok: boolean }>
}
