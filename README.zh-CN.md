# popMind

> 一个围绕划词、翻译、解释和 AI 工具跳转设计的桌面 AI 工作台。

[English](./README.md) | [简体中文](./README.zh-CN.md)

popMind 当前围绕两条主线工作：

1. **划词气泡**：在任意应用里选中文本后，直接翻译、解释、复制，或者发送到外部 AI / 搜索工具。
2. **主窗口**：通过 slash command 和插件入口，快速做翻译或把问题交给 ChatGPT、Perplexity、Grok、Google Search 等工具。

当前产品重点面向 **macOS**，因为全局划词能力依赖原生的 macOS 选择桥接。

## 为什么是 popMind

- **划词优先**：先处理你正在看的文本，而不是先切换应用。
- **两层 AI 能力**：既有轻量翻译，也有可继续追问的解释对话窗口。
- **可配置 AI 栈**：支持多个 AI Provider 配置，并选择一个当前生效的 Provider。
- **桌面原生体验**：状态栏、浮窗、快捷键、固定窗口、本地历史都在一个产品里完成。

## 当前支持的能力

### 1. 划词气泡

在 macOS 中选中文本后，popMind 可以弹出悬浮气泡，并支持：

- **翻译**：在选区附近打开内置翻译窗口
- **解释**：打开独立的 AI 解释对话窗口
- **复制**：立即复制当前选中文本
- **AI 搜**：把当前文本交给外部搜索 / 回答工具

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

### 3. 划词解释窗口

解释窗口是独立于翻译窗口的 AI 对话面板，用来理解当前选中的内容。

目前支持：

- 基于选中文本的首轮解释
- 在同一会话里继续追问
- 平滑流式输出
- Markdown 渲染与代码块展示
- 可选的联网搜索增强
- 复制与重新生成
- 每条回答附带来源列表
- 本地解释历史持久化

如果没有配置可用的 AI Provider，气泡里的 **解释** 会降级为打开外部搜索 / 回答页面，而不是进入内置解释窗口。

### 4. 主窗口

主窗口是一个更偏 launcher 的入口，适合键盘驱动和工具跳转。

当前内置命令：

- `/tr`
- `/翻译`

当前内置插件：

- `/chatgpt`
- `/grok`
- `/perplexity`
- `/google`

主窗口目前支持：

- Slash command 解析
- `/tr` 的内联翻译卡片
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
app/
  components/
    home/              主窗口 UI
    settings/          设置页 UI
    selection-chat/    划词解释窗口 UI
    translation/       翻译窗口 UI
lib/
  main/                Electron 主进程
  text-picker/         划词气泡与全局划词能力
  translation/         翻译引擎与翻译浮窗逻辑
  selection-chat/      解释对话服务与浮窗逻辑
  ai-service/          当前 AI Provider 解析
  web-search/          联网搜索 Provider 解析
  conveyor/            类型安全 IPC schema / API / handlers
native/
  selection_bridge.mm  macOS 原生划词桥接
```

## 技术栈

- Electron
- React
- TypeScript
- Vite / electron-vite
- Tailwind CSS
- shadcn/ui
- Zod
- Vercel AI SDK
- electron-builder

## 开发

### 环境要求

- Node.js 20+
- pnpm 9+
- macOS（如果你需要完整体验划词能力）

### 安装依赖

```bash
pnpm install
```

### 开发启动

```bash
pnpm dev
```

### 构建原生划词桥

在 macOS 上它会在安装阶段自动处理，你也可以手动执行：

```bash
pnpm run build-native
```

## 打包

本地打包命令：

```bash
pnpm run build:mac
pnpm run build:win
pnpm run build:linux
```

GitHub Actions 也已经支持 CI 打包：

- 手动触发：`Build Release Packages`
- 打 tag 触发：例如 `v0.1.0`

当前 CI 会生成：

- macOS 安装包
- Windows 安装包

在推送 `v*` tag 时，CI 还会把构建产物自动挂到 GitHub Release。

## 当前范围与说明

- 全局划词能力当前是 **macOS 优先**
- 主窗口不只是搜索框，它本质上也是 launcher + 翻译入口
- 内部命令枚举里不是每个命令都已经作为正式用户功能开放
- 有些外部插件因为 URL 参数流转不稳定，目前是刻意下线状态
- 当前 README 的打包部分只覆盖“生成安装包”，不包含代码签名和 notarization 细节

## License

[MIT](./LICENSE)
