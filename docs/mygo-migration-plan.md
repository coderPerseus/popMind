# popMind → myGo 迁移计划

> 目标：用 [myGo](https://github.com/egoist/mygo)（v0.6.4，纯 Go、无 cgo 的桌面框架）重写 popMind 的核心能力。
> **原则：尽可能使用 myGo 的能力和原生开发**——界面全部用 myGo 原生 UI（Go `ui` 包，GPU 绘制，不用 WebView/React）；系统能力优先用 myGo API，只有 myGo 没有的才用自带原生库。
> 状态：2026-10-26 立项，计划文档定稿后直接开工。

## 1. 范围

### 1.1 本次要迁移的能力

| 模块 | 能力 | 现有实现 |
|---|---|---|
| 划词气泡 | 选中文字后弹出气泡；**翻译**（结果浮窗）、**解释**（AI 对话浮窗，流式 + 多轮 + 可选联网搜索）、复制、打开链接、屏蔽当前 App | `lib/text-picker/`、`lib/translation/`、`lib/selection-chat/`、`lib/explain/`、`native/selection_bridge.mm` |
| 搜索框 | 全局快捷键（默认 `Alt+Space`）唤出；**App 搜索**（含中文名/别名打分、图标）、**计算器**、**翻译** | `app/components/home/`、`app/plugins/main-search/`、`lib/app/installed-app-service.ts` |
| 剪切板 | 监听复制 → 归一化/分类/隐私过滤 → SQLite（FTS5 trigram）存储 → 面板（`Alt+V`）浏览/搜索/粘贴/置顶分组（pinboard） → 缩略图、来源 App、链接预览 | `lib/clipboard/`（约 1.1 万行） |
| 支撑 | 设置页（AI 服务、翻译引擎、快捷键、剪切板设置）、托盘、权限引导、日志 | `app/components/settings/`、`lib/capability/`、`lib/shortcuts/` |

### 1.2 本次不迁移（保留在 Electron 版，后续再说）

待办专注（todo-focus）、截图翻译/截图搜索/OCR 入口、输入框翻译（input-translation）、剪切板云同步（R2）、剪切板 AI 搜索（Jev）、Jev 语言检测、朗读（TTS）、自动更新、搜索历史、欢迎页。
迁移期间 Electron 版**不动**，两个版本并存，直到 myGo 版达到同等可用。

## 2. myGo 能力核对（已在本机验证可编译运行）

| popMind 需要 | Electron 现状 | myGo 对应 | 结论 |
|---|---|---|---|
| 无 Dock 图标的常驻应用 | `app.dock.hide` + 原生 `setActivationPolicy` | `App.SetActivationPolicy(ActivationPolicyAccessory)`、`LSUIElement` | ✅ 直接用 |
| 单实例 | `requestSingleInstanceLock` | `App.RequestSingleInstanceLock` | ✅ |
| 托盘菜单 | `Tray` | `mygo.NewTray` / menus | ✅ |
| 全局快捷键 | `globalShortcut` | `GlobalShortcut.Register`（Carbon 热键，语法同 Electron accelerator） | ✅ |
| 搜索框浮层（不抢前台 App） | `type: 'panel'` + 原生补丁 | `WindowOptions{Panel: true}`：非激活 NSPanel，覆盖全屏 App、所有 Space | ✅ 比现在更省事 |
| 划词气泡（不抢焦点、置顶） | panel + `configureBubbleWindow` 原生补丁 | `Panel` + `ShowInactive()`，必要时用 `NativeHandle()` 交给原生库补 level | ✅ + 少量原生 |
| 透明 / 毛玻璃 | `transparent` + `vibrancy` | `Transparent`、`Vibrancy`（Popover/HUD…） | ✅ |
| 已安装 App + 图标 | 自己扫 `lsregister` + 原生读 Info.plist / 画图标 | `Shell.InstalledApps()`（本地化名称）、`Shell.FileIcon()`、`Shell.LaunchApp()` | ✅ 别名（英文名、本地化名）用原生库读 Info.plist 补 |
| 剪切板读写（多表示、文件、图片） | 原生 `readPasteboard` / `writePasteboard` | `Clipboard.Read/Write`（`transfer` 包） | ⚠️ 不支持变更监听、不读 `org.nspasteboard.*` 隐私标记、不写自定义 marker → 继续用原生库 |
| SQLite + FTS5 | `node:sqlite` | `plugins/sqlite`（purego 加载预编译库，已开 `SQLITE_ENABLE_FTS5`） | ✅ |
| 界面 | React + shadcn/ui（Chromium） | 原生 UI（`ui` 包：布局、列表、文本输入、Markdown 流式、图标、弹层、主题跟随系统） | ✅ 重写，不需要 IPC |
| AI 流式输出 | Vercel AI SDK（Node） | Go 里直接调 OpenAI 兼容 / Anthropic / Gemini 的 SSE 接口，在 goroutine 里读流，`Window.Update` 刷新视图 | ✅ 需要重写 |
| 缩略图、图标显示 | `protocol.handle('popmind-clip')` | `ui.DecodeBitmap` + `ui.Image` 直接画 | ✅ |
| 打开链接 / Finder | `shell` | `Shell.OpenExternal / ShowItemInFolder` | ✅ |
| 选区读取、鼠标/键盘全局监听、模拟 ⌘C/⌘V、OCR、前台 App、窗口截图 | `native/selection_bridge.mm`（N-API，4467 行） | myGo 没有 | ❌ 必须自带原生库（见 §3.3） |

## 3. 架构

### 3.1 目录

新建 `（仓库根目录）/`，与现有 Electron 工程并存，**不依赖** `app/` 的 React 代码（只参考它的交互和视觉）：

```
（仓库根目录）/
├── go.mod                    module popmind（go 1.27.3；mygo v0.6.4；`go tool mygo` 作为工具依赖）
├── mygo.json                 name / identifier / macos.infoPlist(LSUIElement)；没有前端
├── main.go                   组装：日志、设置、原生库、托盘、窗口、快捷键
├── internal/
│   ├── native/               purego 加载 libpopmind_native.dylib（只放 myGo 没有的能力）
│   ├── settings/             JSON 设置（与 Electron 版同名同结构，首次启动导入）
│   ├── ai/                   OpenAI 兼容 / Anthropic / Gemini 流式客户端
│   ├── translation/          翻译服务 + 引擎（google / bing / deepl / youdao / ai / gemma）
│   ├── websearch/            tavily / serper / brave / jina
│   ├── apps/                 App 搜索（索引、别名、打分、图标缓存）
│   ├── calc/                 计算器表达式求值
│   ├── textpicker/           划词：事件 → 选区 → 气泡定位 → 命令分发
│   ├── clipboard/            capture / store(SQLite) / search / write
│   └── ui/                   各窗口的原生视图（launcher / bubble / translate / chat / clipboard / settings）+ 共用组件与样式
├── native/
│   ├── popmind_native.mm     由 selection_bridge.mm 改造：去掉 N-API，导出 C 接口
│   └── build.sh              clang 编成 resources/darwin-arm64/libpopmind_native.dylib
└── resources/                icon.png、原生库
```

### 3.2 界面层：myGo 原生 UI

- 每个窗口 `WindowOptions{Content: ui.View(view)}`，视图是“状态 → 界面”的 Go 函数，每帧重建；后台结果用 `Window.Update` 回到主线程
- 视觉对齐 AGENTS.md 的 macOS 原生规范：系统字体、13px 正文、hairline 分隔、强调色选中、隐藏滚动条、`Vibrancy` 毛玻璃、克制阴影；图标用 lucide 的 SVG（`ui.MustParseSVG` + `ui.Icon`）
- 组件优先用 myGo 自带：`TextInputBase`、`List`（虚拟化）、`markdown.Stream`（AI 流式回复）、`Select`、`Switch`、`Tooltip`、`ContextMenu`、`Popover`、`Toast`、`Sidebar`、`Form`
- 后端逻辑不经过 IPC，视图直接调用 Go 服务；不需要 TS 客户端、不需要前端构建

### 3.3 原生层：myGo 优先，缺的才自带

| 能力 | 用什么 |
|---|---|
| 全局快捷键、托盘、面板窗口、多屏、主题/强调色、打开链接、已安装 App 列表与图标、剪切板读写、SQLite、钥匙串 | **myGo** |
| 读取选中文字（AX）、全局鼠标/键盘监听、模拟 ⌘C/⌘V、剪切板变更计数与 nspasteboard 隐私标记、Vision OCR、前台 App 信息、气泡窗口 level 微调 | 自带 `libpopmind_native.dylib` |

原生库做法：保留 `selection_bridge.mm` 的业务逻辑（选区读取策略、手势判定、剪切板回退、菜单复制、OCR 合并），只把 N-API 外壳换成 `extern "C"` 的 `pm_*` 接口，JSON 进出；事件经 **一个** purego 回调送回 Go；构建产物放 `resources/darwin-arm64/`，`mygo build` 签名打包，运行时从 `App.Path(PathResources)` 加载。

### 3.4 后端服务

视图直接调用：`settings.Capabilities`（读/改/订阅设置）、`translation.Translate`、`ai.Stream`、`apps.Search/Open`、`calc.Eval`、`clipboard.Store/Search/Paste`、`textpicker.Manager`。

### 3.5 数据与兼容

- 数据目录：myGo 的 `PathUserData`。首次启动若为空，从 `~/Library/Application Support/popmind/` **只读导入** `capability-settings.json`、`theme-settings.json`、`text-picker-blocked-apps.json`、快捷键配置；剪切板库 schema 与 Electron 版保持一致，后续可直接拷贝 `clipboard/` 目录
- 开发版 bundle id 为 `<identifier>.dev`，辅助功能权限要**单独授权一次**

### 3.6 窗口对照（全部原生 UI）

| 窗口 | myGo |
|---|---|
| 搜索框（820×540） | `Panel + Frameless + Transparent + Vibrancy`，失焦隐藏，隐藏而不销毁；搜索框 + 结果列表（App / 插件 / 命令）+ 计算器 / 翻译 / 解释卡片 |
| 划词气泡 | `Panel + Frameless + Transparent`，`ShowInactive` 不抢键盘，原生库补窗口 level；一排图标按钮 |
| 翻译浮窗 | `Panel`，出现在选区上方，可拖动、可固定；语言/引擎下拉、重翻、复制、单词释义 |
| 解释对话浮窗 | `Panel`，`markdown.Stream` 流式回复 + 多轮输入框 + 停止 / 重新生成 / 联网开关 |
| 剪切板面板 | `Panel`，宽=工作区宽，贴底；横向卡片列表 + 搜索 + pinboard 标签 |
| 设置 | 普通窗口，`TitleBarHidden`，左侧 `Sidebar` + 右侧 `Form`，`StateKey` 记住位置 |

## 4. 分阶段计划与完成标准

每个阶段结束都要：`go build` / `go vet` 通过、视图用 `ui.Tester` 做无窗口测试、启动开发实例（`go tool mygo dev`）看日志无报错；涉及界面的操作按协作模式交给开发者点，我分析日志。

### P0 骨架
- `（仓库根目录）/` 工程、myGo 依赖、`go tool mygo dev`
- 托盘（打开搜索框 / 剪切板 / 设置 / 退出）、无 Dock、单实例、日志写文件
- 原生库改造 + 构建脚本 + Go 封装，启动时打印辅助功能权限状态
- **完成标准**：`go tool mygo dev` 能起来，托盘可见，日志里有 `native loaded`、`accessibility=<bool>`（已完成）

### P1 搜索框
- `Alt+Space` 唤出 / 隐藏，显示在鼠标所在屏幕 1/3 高度处，失焦隐藏
- App 搜索：`Shell.InstalledApps` + 别名（英文名、本地化名、bundleId 片段）+ 原打分规则；图标 PNG 缓存后经自定义协议给页面；回车启动
- 计算器：把 `CalculatorPanel` 的表达式求值移植到 Go（`internal/calc`），原生卡片展示
- 翻译卡片：`TranslationService.translate`，引擎先上 Google、Bing、AI，再补 DeepL、有道
- **完成标准**：搜 “微信 / wechat / wx” 都能命中并启动；`1+2*3` 出结果；输入英文出中文翻译

### P2 划词气泡
- 原生动作监听 → Go 去抖 → `GetSelectionSnapshot` → 计算气泡位置（沿用原常量与记忆偏移）→ 显示
- 各种消失场景（点别处、滚动、切 App、按键）沿用原生事件
- 翻译：气泡隐藏，翻译浮窗出现在选区上方，loading → 结果；重翻、换语言、复制、固定
- 解释：已配 AI → 对话浮窗，流式 markdown、多轮、停止、联网搜索开关；未配 AI → 外跳浏览器（与原逻辑一致）
- 复制、打开链接、屏蔽当前 App
- **完成标准**：Safari / 备忘录 / VS Code 里划词出气泡；翻译、解释各跑通一次；屏蔽后该 App 不再出气泡

### P3 剪切板
- 监听：原生 `changeCount` 轮询（250ms，复制时立即读），隐私标记（Concealed/Transient/AutoGenerated）、密码管理器黑名单、自己写入的 marker 跳过
- 存储：沿用 `schema.ts` 的表结构和 FTS5 trigram，图片/大文本进 blob 目录
- 搜索：query-parser + keyword-search + ranker 移植
- 写回与粘贴：写 pasteboard（带 marker）→ 隐藏面板 → 激活原 App → 模拟 ⌘V（安全输入时提示）
- 面板：`Alt+V` 唤出贴底面板（原生 UI 重写卡片列表、搜索、预览）；pinboard 增删改排序
- 富化：缩略图、来源 App 名称/图标、链接预览（标题/图标）
- **完成标准**：复制文字/图片/文件/链接后面板实时出现；搜索命中；回车粘贴到前一个 App；重启后历史还在

### P4 设置与收尾
- 设置窗口用原生 UI 重写，保留本次范围内的分区（通用、AI 服务、翻译、快捷键、剪切板）
- 快捷键修改即时生效；主题跟随系统 / 手动
- `mygo build` 出 `.app`，原生库签名打包；从 Electron 数据目录导入设置
- **完成标准**：打包版双击可用，权限引导正常，全部核心流程走一遍

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| 原生库体量大、改造易出错 | 业务函数不动，只换外壳；按调用点逐个导出，每导出一批就在 Go 里调用并打日志验证 |
| purego 回调数量有限且不释放 | 全进程只建 1 个事件回调，按 `kind` 分发 |
| 主线程死锁（原生代码里有 `dispatch_sync(main)`） | 会 `dispatch_sync` 主线程的函数一律在后台 goroutine 调；Go 侧回调只投递不等待 |
| 原生 UI 重写工作量大、视觉要与原版一致 | 先做高频浮层（搜索框、气泡、翻译），共用组件和样式集中在 `internal/ui`；用 `CapturePage` 截图对照原版 |
| 气泡点击会激活 App / 首次点击无效 | Panel 本身非激活；不够再用 `NativeHandle()` 交原生库设置 `becomesKeyOnlyIfNeeded`、level |
| AI SDK 换成手写客户端，行为差异 | 只实现用到的：文本流、system prompt、多轮消息、取消；三家协议各一个文件，带超时与错误信息透传 |
| 开发版与正式版权限分离 | 文档写明；日志首行打印 bundle id 与权限状态 |
| Go 1.27.3 依赖 | 用 `GOTOOLCHAIN=go1.27.3` 自动下载，已验证 |

## 6. 当前进度（2026-10-26）

| 阶段 | 状态 | 已验证（自动） | 待开发者 GUI 验证 |
|---|---|---|---|
| P0 骨架 | ✅ | 原生库加载、权限检测、托盘、单实例、设置导入 | — |
| P1 搜索框 | ✅ | App 搜索（中英文名 / 图标）、计算器（含直接输入算式）、`/tr` 翻译（多引擎降级 + 有道词典）、AI / 网页插件、真实窗口截图 | 快捷键唤出、键盘上下选择、回车启动 App |
| P2 划词 | ✅ 代码完成 | 气泡 / 翻译浮窗 / 解释对话（流式 Markdown）在真实窗口里打开并截图；选区逻辑单测 | 在 Safari / 备忘录 / VS Code 里真实划词、各种消失场景、屏蔽 App |
| P3 剪切板 | ✅ 核心完成 | 捕获文本 / 链接 / 颜色 / 代码入库、搜索、置顶分组、删除撤销、面板截图 | 图片 / 文件复制、回车粘贴到前一个 App、⌘1–9、右键菜单 |
| P4 设置与收尾 | ✅ | 6 个设置分区渲染、`mygo build` 出 14.3 MB 的 .app + dmg | 快捷键录制、各项设置即时生效 |

后续：剪切板 OCR / 链接预览 / 云同步、朗读、自动更新、从 Electron 数据目录导入剪切板历史。

开发自检：`POPMIND_SELFTEST='launcher:wechat|/tr hello' POPMIND_SELFTEST_DIR=<dir> go tool mygo dev`（另有 `popups:<text>`、`clipboard:<a>|<b>?<query>`），会自动操作窗口并保存屏幕截图。

## 7. 变更记录

- 2026-10-26：最初方案是 React 界面跑在 WKWebView + IPC 适配层（已验证可行）。按“尽可能用 myGo 能力和原生开发”的原则改为全部原生 UI，适配层与前端构建移除；Go 后端（设置、应用索引、原生库、窗口、快捷键）保留。
- 2026-10-26 对齐 Electron 版交互：解释窗口打字不再被关闭（所有 popMind 窗口登记为自有界面）；气泡按下即触发、屏蔽按钮放到分隔线后、提示文案/延迟与原版一致；解释窗口抽成共享会话组件（标题+模型信息、联网开关、停止提示、来源折叠）；翻译浮窗按内容自动调整高度，底部加朗读/复制/重新翻译；搜索框尺寸、结果行、底栏与原版一致。
- 2026-10-27 剪切板面板按 Electron 版重写：顶部栏（搜索框+筛选标签、类型菜单、⌘F 时间/应用筛选行、收藏夹标签及右键菜单、暂停记录、更多菜单）、卡片（与原版同尺寸配色，选中/悬停/密钥样式，⌘ 数字角标）、多选（⌘/⇧ 点击、⇧方向键、⌘A）、拖卡片到收藏夹、右键菜单、重命名/编辑/新建文本/新建收藏夹/删除收藏夹对话框、预览窗（正文+信息栏）、撤销提示条、拖动顶边调整高度并记住。链接预览改为读取网页自身的标题和 og:image（无需浏览器截图）。未做：AI 智能排序、云同步、连续粘贴。
- 2026-10-27 Markdown 翻译：识别 Markdown 内容；机器翻译引擎（Google/Bing/DeepL/有道）只翻译文字，标题/列表/引用/表格/代码块/行内代码/链接地址/图片原样保留（用 {{n}} 占位，三家实测均保留）；AI 引擎通过提示词保持结构；译文用 Markdown 渲染（含表格、代码高亮、可点链接、网络图片）。
- 2026-10-27 视觉统一：所有窗口改为白色底（深色模式 #1e1e20），统一悬停/选中/分隔线颜色和按键标签样式；搜索框底栏改白底细线、计算器改为“算式 → 结果”双栏；翻译译文 15px 中粗；设置页分组说明移到卡片下方。
- 2026-10-27 下拉框选项过多时可滚动（高度随窗口自适应）。解释支持“截图辅助解释”：静默截取划词所在窗口（无屏幕录制权限时直接跳过、不弹窗），缩到 1568px 后随问题发给支持图片的模型，提示词要求结合截图上下文精准解释所选文字；解释窗口显示是否用了截图；设置 → 划词 → 解释 可关闭，并显示屏幕录制权限状态和授权入口。
- 2026-10-27 动效：窗口原生淡入（剪切板面板从底部滑上），悬停/选中颜色渐变，命令卡片、翻译结果、聊天消息淡入，剪切板卡片悬停抬起、删除时折叠、新卡片放大淡入，筛选行展开收起，提示条/弹窗/预览/下拉框弹出，设置页切换淡入；均 ≤150ms，跟随系统“减弱动态效果”。AI 服务：填写 API Key/接口地址后自动获取模型列表（OpenAI 兼容 /models、Anthropic、Gemini），模型栏可下拉选择、按输入筛选，也可手动输入。
- 2026-10-27 模型能力按模型名判断（看图、上下文长度、推理模型温度），与接入的服务商无关，模型拒收图片会被记住；新增“自定义”服务商（中转站）：名称、接口格式（OpenAI 兼容 / Anthropic / Gemini）、必填接口地址，Claude/Gemini 格式自动补 /v1、/v1beta，模型列表同样自动获取。
- 2026-10-27 剪贴板同步（internal/clipsync）：移植 Electron 的 Cloudflare R2 端到端加密同步（同步密钥、对象名、AES-GCM、负载格式、SigV4 签名与旧版逐字节一致，已用旧版 TS 代码交叉验证，可共用一个存储桶）；连接/首次创建/断开/复制密钥（不进历史）/从旧版钥匙串导入密钥；面板同步按钮、打开面板时（≥5 分钟）与每 30 分钟自动同步、右键“同步到远程”；密钥存 macOS 钥匙串。旧版配置：每次启动三方合并（只在旧版改的带入、只在新版改的保留、两边都改以最近保存为准、列表合并），设置 → 通用可立即合并；剪贴板历史不复制，靠同步获取。发布版数据目录改为 ~/Library/Application Support/app.popmind.mygo，避免与旧版（popmind）共用目录。
- 2026-10-27 正式替换：Electron 项目移到 archive/electron（本地保留、不提交），Go 项目移到仓库根目录；发布版沿用旧版标识 com.popmind.app、签名证书和数据目录（已用本机旧数据副本验证兼容：2083 条历史、收藏夹、同步记录、设置均可直接使用）；新增 packaging/ 与 scripts/package-mac.sh（pkg/dmg/zip），重写 release-packages.yml；版本 0.5.0。

## 8. 开工顺序

P0 → P1 → P2 → P3 → P4，严格按顺序；每一阶段先打通最短路径，再补细节。Electron 版代码在 myGo 版完全替代前不删除。
