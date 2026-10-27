# popMind

> 一个围绕划词、翻译、解释、基于上下文问 AI，以及工具跳转设计的桌面 AI 工作台。

[English](./README.md) | [简体中文](./README.zh-CN.md)

popMind 是一个 macOS 原生应用（Go + [myGo](https://github.com/egoist/mygo)），围绕两条主线工作：

1. **划词气泡**：在任意应用里选中文本后，直接翻译、解释、复制，或者基于这段内容打开内置的 `问 AI` 窗口。
2. **主窗口**：通过 slash command 和插件入口，快速做翻译、解释、计算、搜索本机应用、翻剪贴板历史，或者把问题交给 ChatGPT、Perplexity、Grok、Google Search 等工具。

当前产品重点面向 **macOS**，因为全局划词能力依赖原生的 macOS 选择桥接。

## 为什么是 popMind

- **划词优先**：先处理你正在看的文本，而不是先切换应用。
- **两层 AI 能力**：既有轻量翻译，也有可做解释或继续提问的独立对话窗口。
- **更贴上下文的解释**：解释和问 AI 会综合选中文本、对话历史、当前应用名、可选联网结果，以及在可用时附带源窗口截图。
- **可配置 AI 栈**：支持多个 AI Provider 配置，并选择一个当前生效的 Provider。
- **桌面原生体验**：状态栏、浮窗、快捷键、固定窗口、本地历史都在一个产品里完成。

## 当前支持的能力

### 1. 划词气泡

在 macOS 中选中文本后，popMind 可以弹出悬浮气泡，并支持：

- **翻译**：在选区附近打开内置翻译窗口
- **解释**：打开独立的 AI 解释对话窗口
- **复制**：立即复制当前选中文本
- **问 AI**：打开内置对话窗口，先带上当前选中文本，再由你补充 prompt 发问

相关能力目前包括：

- 贴近选区的浮动气泡
- 气泡 / 翻译窗 / 解释窗 / 主窗口的自动收起协调
- 翻译窗和解释窗的固定显示
- 截图翻译
- 截图搜索
- 状态栏菜单中的划词开关

### 2. 翻译窗口

翻译窗口是一个围绕“快速阅读辅助”设计的独立浮窗。

当前支持的翻译引擎：

- `Google`
- `DeepL`
- `Bing`
- `Youdao`
- `AI`

当前翻译行为：

- 普通文本翻译会使用你当前选中的翻译引擎
- 英文单词查询时，如果有道可用，会优先走 **Youdao** 返回更丰富的词条信息
- 如果你选择的是 **AI** 引擎，则会使用设置页里当前选中的 AI Provider

翻译窗口目前包含：

- 语言切换
- 引擎切换
- 复制 / 重新翻译
- 单词模式下的音标、释义、词形、短语、例句
- 可调整尺寸的浮动窗口

### 3. 划词解释 / 提问窗口

解释窗口是独立于翻译窗口的 AI 对话面板，用来理解当前选中的内容，或者围绕这段内容继续提问。

目前支持：

- **解释模式**：打开后直接基于选中文本生成首轮解释
- **问 AI 模式**：打开后先展示选中文本，等待你补充问题再发送
- 在同一会话里继续追问
- 注入当前应用名称等有效上下文
- 在可用时附带源窗口截图，帮助模型更准确理解当前界面环境
- 平滑流式输出
- Markdown 渲染与代码块展示
- 可选的联网搜索增强
- 复制与重新生成
- 每条回答附带来源列表
- 本地会话历史持久化

如果没有配置可用的 AI Provider，气泡里的 **解释** 会降级为打开外部搜索 / 回答页面，而不是进入内置对话窗口。**问 AI** 会保留在应用内，但需要先配置可用的 AI Provider 才能得到回答。

### 4. 主窗口

主窗口是一个更偏 launcher 的入口，适合键盘驱动和工具跳转。

当前内置命令：

- `/tr`
- `/翻译`
- `/ex`
- `/解释`

当前内置面板工具：

- `/cal` 计算器

当前内置外部插件：

- `/chatgpt`
- `/grok`
- `/perplexity`
- `/google`

主窗口目前支持：

- Slash command 解析
- `/tr` 的内联翻译卡片
- `/ex` 的内联解释卡片
- 主窗口内直接计算四则运算
- 主窗口内搜索应用
- 输入普通文本时搜索并启动本机已安装应用
- 插件列表与键盘上下选择
- 回车打开对应外部工具
- 搜索 / 插件执行历史记录

### 5. 设置页

设置页当前分为三个部分：

- **常规**
- **翻译**
- **历史记录**

目前支持的配置能力：

- 应用语言
- 主题模式
- 辅助功能权限状态
- 屏幕录制权限状态
- AI 服务配置与连接测试
- 网络搜索配置与逐项测试
- 翻译引擎开关
- 翻译语言偏好
- 搜索 / 解释历史导出与清理

支持的 AI Provider：

- `OpenAI`
- `Anthropic`
- `Google`
- `Kimi`
- `DeepSeek`

支持的网络搜索 Provider：

- `Tavily`
- `Serper`
- `Brave`
- `Jina`

一个重要行为说明：

- 你可以同时保存多个 AI Provider 的配置
- 但系统同一时间只会使用 **一个 active provider**
- 当前 active provider 会被以下能力共用：
  - 划词解释
  - AI 翻译引擎

## 项目结构

```text
main.go                 启动：托盘、快捷键、窗口
internal/
  views/                所有窗口，myGo 原生 UI（搜索框、划词气泡、翻译、解释、剪贴板面板、设置）
  textpicker/           全局划词识别与气泡逻辑
  translation/          翻译引擎（Google、Bing、DeepL、有道、AI）与 Markdown 翻译
  ai/ chat/ websearch/  AI 服务、解释对话、联网搜索
  clipboard/ clipsync/  剪贴板历史（SQLite）与端到端加密的 R2 同步
  settings/ i18n/       设置文件与文案
native/
  popmind_native.mm     macOS 原生桥（划词、剪贴板、窗口、截图）
packaging/              签名权限与安装脚本
```

## 技术栈

- Go
- [myGo](https://github.com/egoist/mygo)：原生 UI、窗口、托盘、快捷键、SQLite、打包
- 通过 purego 加载的 Objective-C++ 原生库

## 开发

### 环境要求

- macOS（Apple 芯片）
- Go 1.27.3（设置 `GOTOOLCHAIN=go1.27.3` 会自动下载）
- Xcode 命令行工具（编译原生库）

### 编译原生库

```bash
./native/build.sh
```

### 开发启动

```bash
GOTOOLCHAIN=go1.27.3 go tool mygo dev
```

开发版名为 “popMind Dev”，使用独立的数据目录。

### 检查

```bash
GOTOOLCHAIN=go1.27.3 go vet ./... && go test ./...
```

## 打包

```bash
./scripts/package-mac.sh
```

产出 `build/popMind-<版本>.pkg`（覆盖安装到 `/Applications/popMind.app`）、`.dmg` 和 `.zip`。设置 `POPMIND_MAC_SIGN_IDENTITY` 用 popMind 证书签名；不设置则为临时签名，仅供测试。

GitHub Actions（`Build Release Packages`）负责打包签名；推送与 `mygo.json` 版本一致的标签（如 `v0.5.0`）会发布到 Releases。

## 当前范围与说明

- 仅支持 macOS。
- 0.5 版取代 Electron 版：同样的标识、签名和数据目录，设置、剪贴板历史和系统权限都会保留。

## License

[GPL-3.0](./LICENSE)
