# popMind

> A desktop AI workspace for selection-first translation, explanation, and fast handoff to web copilots.

[English](./README.md) | [简体中文](./README.zh-CN.md)

popMind is an Electron desktop app built around two core flows:

1. **Selection bubble**: select text anywhere, then translate, explain, copy, or send it to external AI/search tools.
2. **Main window**: use slash commands and plugin shortcuts to translate text or jump into tools like ChatGPT, Perplexity, Grok, and Google Search.

The current product is optimized for **macOS**, because the global text-selection capability depends on a native macOS bridge.

## Why popMind

- **Selection-first UX**: trigger actions directly from the text you are reading, without switching context first.
- **Two levels of AI help**: lightweight translation for fast reading, and a dedicated explanation chat window for follow-up questions.
- **Configurable AI stack**: choose one active AI provider for explanation and AI translation, and configure optional web-search providers for grounded answers.
- **Desktop-native flow**: tray menu, floating windows, keyboard shortcuts, window pinning, and local history.

## What It Can Do Today

### 1. Selection Bubble

When you select text on macOS, popMind can show a floating bubble with these actions:

- **Translate**: open the built-in translation window above the selected text.
- **Explain**: open a dedicated AI explanation panel with follow-up chat.
- **Copy**: copy the selected text immediately.
- **AI Search**: open an external search/answer tool with the selected text.

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

### 3. Explain Window

The explain window is a separate AI chat surface for understanding selected text.

It currently supports:

- Initial explanation based on the selected text
- Follow-up questions in the same session
- Streaming output with smooth chunked rendering
- Markdown rendering with code blocks
- Optional web-search augmentation
- Copy and regenerate actions
- Source list per answer
- Local explanation history persistence

If no AI provider is configured, the bubble’s **Explain** action falls back to opening an external search/answer page instead of the in-app explanation chat.

### 4. Main Window

The main window is a launcher-style entry point for commands and web handoff.

Current built-in slash command:

- `/tr`
- `/翻译`

Current built-in web plugins:

- `/chatgpt`
- `/grok`
- `/perplexity`
- `/google`

Main window behavior:

- Slash command parsing
- Inline translation card for `/tr`
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
app/
  components/
    home/              Main window UI
    settings/          Settings UI
    selection-chat/    Explain window UI
    translation/       Translation window UI
lib/
  main/                Electron main process
  text-picker/         Selection bubble + global selection feature
  translation/         Translation providers and floating window logic
  selection-chat/      Explain chat service and window logic
  ai-service/          Active AI provider resolution
  web-search/          Search provider resolution
  conveyor/            Typed IPC schema / API / handlers
native/
  selection_bridge.mm  macOS native selection bridge
```

## Tech Stack

- Electron
- React
- TypeScript
- Vite / electron-vite
- Tailwind CSS
- shadcn/ui
- Zod
- Vercel AI SDK
- electron-builder

## Development

### Requirements

- Node.js 20+
- pnpm 9+
- macOS for full selection-bubble capability

### Install

```bash
pnpm install
```

### Start in Development

```bash
pnpm dev
```

### Build Native Selection Bridge

This is handled automatically during install on macOS, but the script is also available:

```bash
pnpm run build-native
```

## Packaging

Local packaging commands:

```bash
pnpm run build:mac
pnpm run build:win
pnpm run build:linux
```

CI packaging is also set up through GitHub Actions:

- Manual trigger: `Build Release Packages`
- Tag trigger: push a tag like `v0.1.0`

The workflow builds release installers for:

- macOS
- Windows

On `v*` tags, CI also publishes the generated assets to GitHub Releases.

## Notes and Current Scope

- The global selection feature is currently **macOS-first**.
- The main window is broader than the selection bubble and acts as a launcher + translation surface.
- Not every command in the internal command enum is implemented as a user-facing action yet.
- Some external web plugins are intentionally disabled for now when URL parameter handoff is unreliable.
- Code signing / notarization is not part of the README scope; packaging support is focused on generating installable artifacts first.

## License

[GPL-3.0](./LICENSE)
