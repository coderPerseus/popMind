# popMind Translation MVP Design

## 1. Goal

This design is intentionally simplified.

The target is not to build a large generic translation platform first. The target is:

1. satisfy the current product requirement
2. run Google translation first
3. keep a clean extension point for DeepL, Bing, Youdao, and DeepSeek later

So the architecture should be "simple but extensible", not "fully abstract from day one".

## 2. Requirement Review

The requirement is mostly clear, but there are a few points that should be fixed in the design now.

### 2.1 Confirmed understanding

We will support:

1. a translation settings page
2. enable / disable translation engines
3. first language and second language settings
4. source language default = auto detect
5. AI engine API key input and local persistent storage
6. clicking `Translate` in the selection bubble hides the bubble
7. then a translation result window appears above the selected text
8. the result window must show loading before the result arrives
9. result UI should be close to mature translation tools
10. it should support copy, re-translate, drag, and pin

### 2.2 Important requirement decisions

These rules should be fixed and used consistently:

#### Language rule

Use this target language rule:

1. source selector default = `auto`
2. target selector initial value = `first language`
3. after source language is detected:
   - if source == first language, target = second language
   - if source == second language, target = first language
   - if source is neither, target stays first language

This matches your current description and the UI example.

#### Re-translate rule

For MVP, `re-translate` means:

1. re-run the current request
2. use the same engine
3. use the current source/target language selectors

It does not mean multi-engine comparison yet.

#### Pin rule

For MVP, pin means:

1. the translation window stays visible
2. new selection actions do not auto-close it
3. user closes it manually or unpins it

#### Local storage rule

For MVP, user translation config is persisted locally under Electron `userData`.

This includes:

1. enabled engines
2. first language
3. second language
4. AI provider API key

If later we need stronger secret protection, we can switch AI keys to system keychain, but it is not required for phase 1.

## 3. What We Need From Easydict

We do not need to copy Easydict's whole service architecture.

We only need to borrow the useful part: each engine keeps its own protocol details inside its own module.

### 3.1 Google logic we should reuse in spirit

From Easydict, Google translation is not just a single URL:

1. it has a web translation path
2. it has a fallback path
3. it has language detection ability
4. some signing / token logic is engine-specific

Design conclusion:

`popMind` should put all Google request details inside `google-provider.ts`, not inside UI code or a shared switch statement.

### 3.2 Why we are not implementing all Easydict logic first

Because the current requirement is narrower:

1. we only need translation first
2. we only need Google first
3. we do not need dictionary detail, OCR, TTS, or compare mode now
4. we only need enough abstraction to add the next engines later

So the design should stay small.

## 4. Simplified Architecture

Keep only four parts:

1. translation service
2. translation providers
3. translation settings store
4. translation window

Recommended structure:

```text
lib/
  translation/
    types.ts
    store.ts
    service.ts
    shared.ts
    providers/
      index.ts
      google-provider.ts
      deepl-provider.ts
      bing-provider.ts
      youdao-provider.ts
      deepseek-provider.ts
    window/
      translation-window.ts
      translation-window-manager.ts
  conveyor/
    schemas/
      translation-schema.ts
    api/
      translation-api.ts
    handlers/
      translation-handler.ts
app/
  translate.tsx
  translate.html
  components/translation/
    TranslationPanel.tsx
    TranslationToolbar.tsx
    TranslationResult.tsx
    TranslationLoading.tsx
lib/preload/
  translate-preload.ts
```

This is enough for MVP and still easy to extend.

## 5. Core Data Model

### 5.1 Translation engine

```ts
export type TranslationEngineId = 'google' | 'deepl' | 'bing' | 'youdao' | 'deepseek'
```

### 5.2 User settings

```ts
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
```

Default values:

```ts
{
  enabledEngines: {
    google: true,
    deepl: false,
    bing: false,
    youdao: false,
    deepseek: false,
  },
  firstLanguage: 'en',
  secondLanguage: 'zh-CN',
  defaultSourceLanguage: 'auto',
  ai: {
    deepseekApiKey: '',
    deepseekBaseUrl: '',
    deepseekModel: '',
  },
}
```

### 5.3 Translation request

```ts
export interface TranslationRequest {
  text: string
  sourceLanguage: string
  targetLanguage: string
  engineId?: TranslationEngineId
  selectionId?: string
  sourceAppId?: string
  selectionRect?: { x: number; y: number; width: number; height: number } | null
}
```

### 5.4 Translation result

```ts
export interface TranslationResult {
  engineId: TranslationEngineId
  sourceLanguage: string
  targetLanguage: string
  sourceText: string
  translatedText: string
  detectedSourceLanguage?: string
}
```

## 6. Minimal Provider Contract

We only need one simple interface for now:

```ts
export interface TranslationProvider {
  id: TranslationEngineId
  isConfigured(settings: TranslationSettings): boolean
  translate(request: TranslationRequest, settings: TranslationSettings): Promise<TranslationResult>
}
```

This is enough.

No separate registry layer, no strategy layer, no capability matrix for MVP.

Use a simple provider map:

```ts
export const translationProviders = {
  google: googleProvider,
  deepl: deeplProvider,
  bing: bingProvider,
  youdao: youdaoProvider,
  deepseek: deepseekProvider,
}
```

## 7. Translation Service

`service.ts` should be the only orchestrator.

Responsibilities:

1. read settings
2. resolve which engine to use
3. resolve source / target language
4. call the provider
5. return normalized result

That is all.

### 7.1 Engine selection rule

For MVP:

1. if request explicitly passes `engineId`, use it
2. otherwise use the first enabled engine in this order:
   - google
   - deepl
   - bing
   - youdao
   - deepseek

This keeps behavior deterministic and simple.

### 7.2 Language resolution rule

`service.ts` should expose a helper:

```ts
resolveTargetLanguage({
  requestedSourceLanguage,
  detectedSourceLanguage,
  firstLanguage,
  secondLanguage,
})
```

Rules:

1. if requested source is not `auto`, use it directly
2. if source is `auto`, provider may detect source language
3. if detected source == first language, target = second language
4. if detected source == second language, target = first language
5. otherwise target = first language

This rule must be shared by settings page, translate window initial state, and runtime translation.

## 8. UI and Interaction Design

## 8.1 Window model

Keep the current selection bubble.

Add one new lightweight window: `translation-window`.

Flow:

1. user selects text
2. bubble appears
3. user clicks `Translate`
4. bubble hides immediately
5. translation window appears above the selected text
6. loading state shows
7. result replaces loading

This is simpler than trying to reuse the main window.

## 8.2 Translation window states

Only three states are needed:

1. `loading`
2. `success`
3. `error`

No extra state machine is necessary for MVP.

## 8.3 Translation window layout

Follow the image direction:

1. title area
   - left: app mark / title
   - center or left: drag area
   - right: pin button
2. language selector area
   - source selector, default `auto`
   - swap arrow
   - target selector, initial `first language`
3. content area
   - loading skeleton or spinner
   - source text
   - translated text
4. action area
   - copy
   - re-translate

Recommended additions for MVP:

1. source text should remain visible
2. translated text should be selectable
3. long text should scroll

## 8.4 Position rule

The translation window should appear above the selected text region when possible.

Fallback order:

1. above selection
2. below selection
3. clamp inside current display work area

This should reuse the same positioning style already used by the bubble window manager.

## 9. Settings Page Design

Extend the current settings page into a translation settings page.

Required sections:

### 9.1 Engine switches

Show a switch for:

1. Google
2. DeepL
3. Bing
4. Youdao
5. DeepSeek

### 9.2 Language settings

Show:

1. first language selector, default `English`
2. second language selector, default `Chinese`
3. source language selector, default `Auto Detect`

### 9.3 AI settings

For now, only DeepSeek needs input fields:

1. API key
2. optional base URL
3. optional model

These values are stored locally.

## 10. IPC Design

Keep it simple.

Use `conveyor` for main window settings access and shared translation actions.

Recommended channels:

```ts
'translation-get-settings'
'translation-update-settings'
'translation-translate'
```

Optional later:

```ts
'translation-get-engines'
```

### 10.1 Why still use `conveyor`

Because the project already has a typed IPC pattern.

Using it keeps the codebase consistent, but we should only add the small set of channels we actually need.

## 11. Google First Implementation Plan

For phase 1, only implement Google provider.

### 11.1 Google provider scope

Only support:

1. translate text
2. auto detect source language
3. return plain translated text

Do not implement yet:

1. dictionary data
2. phonetics
3. TTS
4. compare mode

### 11.2 Google provider structure

Keep it in one file first:

```text
lib/translation/providers/google-provider.ts
```

Responsibilities:

1. build Google request
2. send request
3. parse response
4. return normalized `TranslationResult`

If later the file becomes too large, then split it.

### 11.3 Why this is enough

Because the real requirement is "run the translation flow first", not "perfectly model every Google endpoint variant first".

## 12. Future Extension Path

When adding the next engines, the extension cost should stay low:

1. create a new provider file
2. implement `TranslationProvider`
3. add its settings fields if needed
4. register it in `providers/index.ts`

That is enough.

No additional architecture layer should be introduced unless real complexity appears.

## 13. Final Recommendation

The MVP should be built with this mindset:

1. one simple translation service
2. one simple provider interface
3. one local settings store
4. one dedicated translation window
5. Google first
6. other engines later by adding provider files

This design is smaller than the previous version, but it still gives us enough room to add DeepL, Bing, Youdao, and DeepSeek without rewriting the whole flow.
