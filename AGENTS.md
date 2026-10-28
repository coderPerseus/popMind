# Repository Guidelines

## Project Structure & Module Organization

popMind is a Go app built with [myGo](https://github.com/egoist/mygo): native UI (myGo's `ui` package), no web frontend. `main.go` starts the app (tray, shortcuts, windows); `shortcuts.go` registers global shortcuts; `selftest.go` holds env-driven self tests. Packages live in `internal/`:

- `views/` every window and panel in myGo native UI (launcher, selection bubble, translation popup, explain chat, clipboard panel, settings); shared look in `style.go`, motion in `motion.go`
- `textpicker/` selection detection and the bubble logic; `windows/` dismiss rules of floating surfaces
- `translation/`, `ai/`, `chat/`, `websearch/`, `calc/`, `apps/` the features
- `clipboard/` history store (SQLite, the Electron app's schema), capture, search, paste; `clipsync/` Cloudflare R2 sync
- `settings/` settings files (same names and shapes as the Electron app's), `i18n/` strings (`extra.go` for new ones, `scripts/add-i18n.py` adds them), `native/` purego wrapper of the native library, `logx/`, `jsonx/`

The website (pm.luckysnail.cn) is `website/`: a static Void + Solid site in the hz design system, as Windeck's, in Chinese (`/`, `/zh`) and English (`/en`), with an install guide; its words are `website/lib/content.ts`, and its pictures (logo, icons, share card, the app's windows) are made by `TestRenderSiteAssets`. The native macOS bridge is `native/popmind_native.mm` (C ABI, built by `native/build.sh` into `resources/darwin-arm64/`). `packaging/` holds the entitlements and installer scripts. `docs/` is documentation. The Electron app this replaced is in `archive/electron/` locally (not committed; `scripts/gen-defaults.mjs` and `scripts/gen-icons.mjs` read from it). Generated output (`build/`, `.mygo/`, `resources/darwin-*/`) is never edited by hand.

## Build, Test, and Development Commands

- `./native/build.sh` builds the native library (once, and after changing `native/popmind_native.mm`)
- `GOTOOLCHAIN=go1.27.3 go tool mygo dev` runs the development app ("popMind Dev", its own data folder); it rebuilds on Go changes, and must be restarted after rebuilding the native library
- `GOTOOLCHAIN=go1.27.3 go vet ./... && go test ./...` checks; `POPMIND_RENDER_DIR=<dir> go test ./internal/views/` renders the windows to PNGs for review
- `cd website && bun install && bun run dev` runs the website; `bun run build` builds it into `website/dist/client`; `POPMIND_SITE_DIR=$PWD/website/public go test ./internal/views/ -run TestRenderSiteAssets` remakes its pictures
- `./scripts/package-mac.sh` builds the release (`build/`: .pkg, .dmg, .zip); `POPMIND_MAC_SIGN_IDENTITY` signs it. Releases are built by `.github/workflows/release-packages.yml` on a `v*` tag matching `mygo.json`'s version

## Coding Style & Naming Conventions

Go, formatted by `gofmt`. Comments say what the code is for, in plain sentences. New user-facing strings go through `i18n.T` (zh-CN and en). UI follows the rules below and uses the helpers of `internal/views/style.go` (`Look`, `Hairline`, `HoverFill`, `IconButton`, `Picker`, …) rather than new colors or sizes.

## Testing Guidelines

no need test

## Commit & Pull Request Guidelines

- ban auto use git modify code status

# 页面开发

界面一律用 myGo 原生 UI（`github.com/egoist/mygo/ui`）开发，不引入 WebView 页面。

## UI 规范（macOS 原生风格）

popMind 是 macOS 工具，所有窗口和浮层都要像系统原生界面，而不是网页。参考实现：设置窗口 `internal/views/settings_view.go`。

- 字体：系统字体栈 `-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif`；正文 13px，辅助信息 11–12px，不用大号粗体标题
- 滚动条：一律隐藏（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`），保留滚轮 / 触控板滚动
- 分隔与边框：用 0.5–1px 的淡色细线（hairline），不用粗边框和明显的卡片描边
- 选中态：系统强调色（macOS 蓝）2px 描边或浅色底，不用夸张的发光、渐变
- 控件尺寸：按钮、输入框高 22–28px，圆角 6–8px；图标 14–16px（lucide）
- 阴影克制：只在浮层（菜单、弹窗、面板）使用柔和阴影
- 颜色：跟随系统浅色 / 深色模式，使用 `internal/views/style.go` 中的颜色（窗口为白色 / 深灰底）
- 动画：默认不用；确需动画时必须流畅、短（≤150ms）、不能出现先显示空容器再出内容的闪烁
- 信息密度：辅助说明放 placeholder、tooltip 或浅灰小字，不额外占一行 / 一栏（例如不要底部状态栏）

# 仓库操作约束

- Go 工具链用 `GOTOOLCHAIN=go1.27.3`
- `archive/` 是旧的 Electron 项目，只在本地保留，不提交、不修改
- 构建产物（`build/`、`.mygo/`、`resources/darwin-*/`）不提交

## 重要

工作模式，遇到任何 GUI 相关的测试逻辑都停下来告诉我开发者要做什么，然后你自己启动服务，打好需要的日志，然后等待开发者完成 GUI 操作，你进行log 分析，然后继续下一步

- 在启动 `go tool mygo dev` 之前，必须先检测当前是否已经有运行中的开发实例；如果已经有，就复用现有实例，不要重复启动多个

When communicating your results back to me, explain what you did and what happened in plain, clear English. Avoid jargon, technical implementation details, and code-speak in your final responses. Write as if you're explaining to a smart person who isn't looking at the code. Your actual work (how you think, plan, write code, debug, and solve problems) should stay fully technical and rigorous. This only applies to how you talk to me about it.

Before reporting back to me, if at all possible, verify your own work. Don't just write code and assume it's done. Actually test it using the tools available to you. If possible, run it, check the output, and confirm it does what was asked. If you're building something visual like a web app, view the pages, click through the flows, and check that things render and behave correctly. If you're writing a script, run it against real or representative input and inspect the results. If there are edge cases you can simulate, try them.

Define finishing criteria for yourself before you start: what does "done" look like for this task? Use that as your checklist before you come back to me. If something fails or looks off, fix it and re-test. Don't just flag it and hand it back. The goal is to keep me out of the loop on iteration. I want to receive finished, working results, not a first draft that needs me to spot-check it. Only come back to me when you've confirmed things work, or when you've genuinely hit a wall that requires my input.

use simple Chinese reply

### 协作模式

AI：编写相关代码和日志 log ，然后启动后台项目，收集日志
开发者：进行对应功能的调试，给 AI 提供调试日志修复 bug
