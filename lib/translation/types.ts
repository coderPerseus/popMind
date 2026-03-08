export type TranslationEngineId = 'google' | 'deepl' | 'bing' | 'youdao' | 'deepseek'

export interface TranslationSettings {
  enabledEngines: Record<TranslationEngineId, boolean>
  firstLanguage: string
  secondLanguage: string
  defaultSourceLanguage: 'auto' | string
  ai: {
    deepseekApiKey: string
    deepseekBaseUrl?: string
    deepseekModel?: string
  }
}

export interface TranslationRequest {
  text: string
  sourceLanguage: string
  targetLanguage: string
  engineId?: TranslationEngineId
  selectionId?: string
  sourceAppId?: string
}

export interface TranslationResult {
  engineId: TranslationEngineId
  sourceLanguage: string
  targetLanguage: string
  sourceText: string
  translatedText: string
  detectedSourceLanguage?: string
}

export interface TranslateInput {
  text: string
  sourceLanguage?: string
  targetLanguage?: string
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

export interface TranslationSettingsPatch {
  enabledEngines?: Partial<Record<TranslationEngineId, boolean>>
  firstLanguage?: string
  secondLanguage?: string
  defaultSourceLanguage?: 'auto' | string
  ai?: Partial<TranslationSettings['ai']>
}

export interface TranslationLanguageOption {
  code: string
  label: string
}

export interface TranslationWindowState {
  status: 'idle' | 'loading' | 'success' | 'error'
  pinned: boolean
  engineId: TranslationEngineId
  enabledEngineIds: TranslationEngineId[]
  sourceLanguage: string
  targetLanguage: string
  sourceText: string
  translatedText: string
  detectedSourceLanguage?: string
  errorMessage?: string
  languages: TranslationLanguageOption[]
}

export interface TranslationAnchorPoint {
  x: number
  topY: number
  bottomY: number
}

export interface TranslationWindowPreloadApi {
  onState(handler: (state: TranslationWindowState) => void): () => void
  getState(): Promise<TranslationWindowState | null>
  retranslate(payload: { sourceLanguage: string; targetLanguage: string; engineId: TranslationEngineId }): Promise<{ ok: boolean }>
  setPinned(pinned: boolean): Promise<{ ok: boolean; pinned: boolean }>
  moveWindow(deltaX: number, deltaY: number): void
  resizeWindow(height: number): void
  copyTranslatedText(): Promise<{ ok: boolean }>
  closeWindow(): Promise<{ ok: boolean }>
}
