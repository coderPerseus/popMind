import type { CapabilitySettings, CapabilitySettingsPatch } from '@/lib/capability/types'

export type TranslationEngineId = 'google' | 'deepl' | 'bing' | 'youdao' | 'ai' | 'gemma'
export type TranslationQueryMode = 'text' | 'word'
export type TranslationSpeechRole = 'source' | 'translated' | 'headword'

export type TranslationSettings = CapabilitySettings

export interface TranslationRequest {
  text: string
  sourceLanguage: string
  targetLanguage: string
  queryMode?: TranslationQueryMode
  engineId?: TranslationEngineId
  selectionId?: string
  sourceAppId?: string
}

export interface TranslationWordPhonetic {
  label: string
  value: string
}

export interface TranslationWordDefinition {
  part?: string
  meaning: string
}

export interface TranslationWordForm {
  label: string
  value: string
}

export interface TranslationWordPhrase {
  text: string
  meaning: string
}

export interface TranslationWordExample {
  source: string
  translated: string
}

export interface TranslationWordEntry {
  headword: string
  phonetics: TranslationWordPhonetic[]
  definitions: TranslationWordDefinition[]
  forms: TranslationWordForm[]
  phrases: TranslationWordPhrase[]
  examples: TranslationWordExample[]
}

export interface TranslationResult {
  engineId: TranslationEngineId
  queryMode: TranslationQueryMode
  sourceLanguage: string
  targetLanguage: string
  sourceText: string
  translatedText: string
  detectedSourceLanguage?: string
  wordEntry?: TranslationWordEntry
}

export interface TranslateInput {
  text: string
  sourceLanguage?: string
  targetLanguage?: string
  queryMode?: TranslationQueryMode
  engineId?: TranslationEngineId
  selectionId?: string
  sourceAppId?: string
}

export interface TranslationProvider {
  id: TranslationEngineId
  isConfigured(settings: TranslationSettings): boolean
  detectLanguage?(text: string, settings: TranslationSettings): Promise<string>
  translate(request: TranslationRequest, settings: TranslationSettings): Promise<TranslationResult>
}

export type TranslationSettingsPatch = CapabilitySettingsPatch

export interface TranslationLanguageOption {
  code: string
  label: string
}

export interface TranslationWindowState {
  status: 'idle' | 'loading' | 'success' | 'error'
  pinned: boolean
  isSpeaking: boolean
  speakingRole?: TranslationSpeechRole
  queryMode: TranslationQueryMode
  engineId: TranslationEngineId
  enabledEngineIds: TranslationEngineId[]
  sourceLanguage: string
  targetLanguage: string
  sourceText: string
  translatedText: string
  detectedSourceLanguage?: string
  wordEntry?: TranslationWordEntry
  errorMessage?: string
  loadingTitle?: string
  loadingDescription?: string
  languages: TranslationLanguageOption[]
}

export interface TranslationAnchorPoint {
  x: number
  topY: number
  bottomY: number
}

export type TranslationWindowResizeEdge =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export interface TranslationWindowResizePayload {
  width?: number
  height?: number
  minHeight?: number
  source?: 'content' | 'manual'
  edge?: TranslationWindowResizeEdge
  deltaX?: number
  deltaY?: number
}

export interface TranslationWindowSpeakPayload {
  text: string
  lang: string
  role: TranslationSpeechRole
}

export interface TranslationWindowPreloadApi {
  onState(handler: (state: TranslationWindowState) => void): () => void
  getState(): Promise<TranslationWindowState | null>
  retranslate(payload: {
    sourceLanguage: string
    targetLanguage: string
    engineId: TranslationEngineId
  }): Promise<{ ok: boolean }>
  setPinned(pinned: boolean): Promise<{ ok: boolean; pinned: boolean }>
  setDragging(isDragging: boolean): void
  notifyInteraction(durationMs?: number): void
  moveWindow(deltaX: number, deltaY: number): void
  resizeWindow(payload: TranslationWindowResizePayload): void
  dismissTopmost(): Promise<{ ok: boolean }>
  copyTranslatedText(): Promise<{ ok: boolean }>
  speak(payload: TranslationWindowSpeakPayload): Promise<{ ok: boolean; active: boolean }>
  stopSpeaking(): Promise<{ ok: boolean; active: boolean }>
  closeWindow(): Promise<{ ok: boolean }>
}
