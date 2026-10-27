# popMind

> A desktop AI workspace for selection-first translation, explanation, asking AI from context, and fast handoff to web copilots.

[English](./README.md) | [简体中文](./README.zh-CN.md)

popMind is a native macOS app (Go + [myGo](https://github.com/egoist/mygo)) built around two core flows:

1. **Selection bubble**: select text anywhere, then translate, explain it, copy it, or open an in-app Ask AI window grounded on that selection.
2. **Main window**: use slash commands and plugin shortcuts to translate text, explain text, calculate, search installed apps, browse clipboard history, or jump into tools like ChatGPT, Perplexity, Grok, and Google Search.

The current product is optimized for **macOS**, because the global text-selection capability depends on a native macOS bridge.

## Why popMind

- **Selection-first UX**: trigger actions directly from the text you are reading, without switching context first.
- **Two levels of AI help**: lightweight translation for fast reading, plus a dedicated explain / ask chat window for deeper follow-up.
- **Context-aware explanation**: explanation and Ask AI can include the selected text, conversation history, the current app name, optional web-search results, and when available a screenshot of the source window.
- **Configurable AI stack**: choose one active AI provider for explanation and AI translation, and configure optional web-search providers for grounded answers.
- **Desktop-native flow**: tray menu, floating windows, keyboard shortcuts, window pinning, and local history.

## What It Can Do Today

### 1. Selection Bubble

When you select text on macOS, popMind can show a floating bubble with these actions:

- **Translate**: open the built-in translation window above the selected text.
- **Explain**: open a dedicated AI explanation panel with follow-up chat.
- **Copy**: copy the selected text immediately.
- **Ask AI**: open the in-app chat window with the selected text preloaded as context, then let you add your own prompt before sending.

Selection-related capabilities currently include:

- Floating bubble near the selection
- Auto-dismiss management for bubble / translation / explain / main window
- Pin-able translation and explain windows
- Screenshot translation
- Screenshot search
- Tray menu for enabling/disabling selection mode

### 2. Translation Window

The translation window is a dedicated floating panel for quick reading assistance.

Supported translation engines:

- `Google`
- `DeepL`
- `Bing`
- `Youdao`
- `AI`

Current translation behavior:

- For normal text, popMind uses the selected engine.
- For English word lookup, it can prefer **Youdao** to return richer word-level results.
- If you choose the **AI** engine, translation uses the currently selected AI provider from settings.

Translation window UX includes:

- Language switching
- Engine switching
- Copy / retranslate actions
- Word mode with phonetics, definitions, phrases, and examples
- Resizable floating window

### 3. Explain / Ask Window

The explain window is a separate AI chat surface for understanding selected text and asking follow-up questions against that selection.

It currently supports:

- **Explain mode**: generate an initial explanation directly from the selected text
- **Ask AI mode**: open the same window first, show the selected text as context, and wait for your prompt
- Follow-up questions in the same session
- Current-app context injection
- Optional source-window screenshot context when available
- Streaming output with smooth chunked rendering
- Markdown rendering with code blocks
- Optional web-search augmentation
- Copy and regenerate actions
- Source list per answer
- Local session history persistence

If no AI provider is configured, the bubble’s **Explain** action falls back to opening an external search/answer page instead of the in-app chat. The **Ask AI** action stays in-app and requires a configured AI provider to answer.

### 4. Main Window

The main window is a launcher-style entry point for commands and web handoff.

Current built-in slash command:

- `/tr`
- `/翻译`
- `/ex`
- `/解释`

Current built-in panel tools:

- `/cal` for calculator

Current built-in web plugins:

- `/chatgpt`
- `/grok`
- `/perplexity`
- `/google`

Main window behavior:

- Slash command parsing
- Inline translation card for `/tr`
- Inline explanation card for `/ex`
- Calculator panel for arithmetic expressions
- Installed app search
- Installed app search and launch when typing normal text
- Plugin launcher list with keyboard navigation
- Enter-to-open flow for supported external tools
- Search/plugin execution history recording

### 5. Settings

The settings app is split into three areas:

- **General**
- **Translation**
- **History**

Current settings capabilities:

- App language
- Theme mode
- Accessibility permission status
- Screen recording permission status
- AI provider configuration and connection test
- Web-search provider configuration and per-provider test
- Translation engine enable/disable
- Preferred translation languages
- Search/explain history export and cleanup

Supported AI providers:

- `OpenAI`
- `Anthropic`
- `Google`
- `Kimi`
- `DeepSeek`

Supported web-search providers:

- `Tavily`
- `Serper`
- `Brave`
- `Jina`

Important behavior:

- You can save configuration for multiple AI providers.
- popMind only uses **one active AI provider at a time**.
- The active provider is shared by:
  - in-app explanation
  - AI translation engine

## Product Structure

```text
main.go                 App start: tray, shortcuts, windows
internal/
  views/                Every window in myGo native UI (launcher, bubble, translation,
                        explain, clipboard panel, settings)
  textpicker/           Global selection detection and the bubble logic
  translation/          Translation engines (Google, Bing, DeepL, Youdao, AI) and Markdown
  ai/ chat/ websearch/  AI providers, the explain conversation, web search
  clipboard/ clipsync/  Clipboard history (SQLite) and end-to-end encrypted R2 sync
  settings/ i18n/       Settings files and strings
native/
  popmind_native.mm     macOS bridge (selection, pasteboard, windows, capture)
packaging/              Entitlements and installer scripts
```

## Tech Stack

- Go
- [myGo](https://github.com/egoist/mygo): native UI, windows, tray, shortcuts, SQLite, packaging
- A native Objective-C++ library loaded through purego

## Development

### Requirements

- macOS (Apple silicon)
- Go 1.27.3 (`GOTOOLCHAIN=go1.27.3` fetches it)
- Xcode command line tools (for the native library)

### Build the native library

```bash
./native/build.sh
```

### Start in development

```bash
GOTOOLCHAIN=go1.27.3 go tool mygo dev
```

The development app is "popMind Dev", with a data folder of its own.

### Check

```bash
GOTOOLCHAIN=go1.27.3 go vet ./... && go test ./...
```

## Packaging

```bash
./scripts/package-mac.sh
```

It builds `build/popMind-<version>.pkg` (installs over `/Applications/popMind.app`), a `.dmg` and a `.zip`. Set `POPMIND_MAC_SIGN_IDENTITY` to sign with the popMind certificate; without it the app is signed ad hoc, for testing.

GitHub Actions (`Build Release Packages`) builds and signs the packages; pushing a tag such as `v0.5.0` (matching `mygo.json`) publishes them as a release.

## Notes and Current Scope

- macOS only.
- Version 0.5 replaces the Electron app: same identifier, signature and data folder, so settings, clipboard history and permissions carry over.

## License

[GPL-3.0](./LICENSE)
