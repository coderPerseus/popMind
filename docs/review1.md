Code Review: Text Picker Feature Migration

1. Verdict: Request Changes

---

2. 需求一致性摘要

反推需求意图：将 open-doubao 独立 Electron 应用的全局划词取词功能，迁移集成到 popMind 桌面应用中，作为后台特性运行。

实际行为：代码完整迁移了 UserActionMonitor（全局鼠标/键盘监听）、AX 文本获取链、剪贴板回退策略、气泡窗口管理、Tray 菜单与 IPC 通信。TypeScript 化、分层合理。

漂移结论：

- 激活策略漂移：原项目是纯后台应用（无主窗口），默认 NSApplicationActivationPolicyAccessory 合理。popMind 有主窗口，但迁移后构造函数立即将整个 App 切为 Accessory
  策略，导致 Dock 图标消失、无法 Cmd+Tab 切换。这改变了主应用的行为语义。
- ShouldClipboardFallback 过于保守：对 Canvas 渲染类应用（VS Code 终端、PDF 查看器等）AX 无法获取文本时，剪贴板回退不触发。已在暂存区修复（return true）。

---

3. 关键问题清单

[S1 High] 激活策略与主窗口冲突

文件: text-picker-manager.ts:82 → applyActivationPolicy()

问题: TextPickerManager 构造时调用 applyActivationPolicy()，dockIconEnabled 默认 false，立即将整个进程设为
NSApplicationActivationPolicyAccessory。原项目是无主窗口的后台应用，但 popMind 有主窗口。

影响: 应用启动后 Dock 图标消失，用户无法通过 Dock 或 Cmd+Tab 切回应用。Tray 菜单虽有"显示底部应用图标"选项，但默认行为对已有主窗口的应用不合理。

修复建议: TextPickerFeature 初始化时传入 dockIconEnabled: true 作为默认值，或在 applyActivationPolicy
中判断当前是否存在可见的主窗口（BrowserWindow.getAllWindows().length > 0），有主窗口时默认使用 Regular 策略。

---

[S1 High] initialize() 的阻塞式 Dialog 影响启动流程

文件: text-picker-feature.ts:47-76

问题: initialize() 在平台不支持、权限缺失、启动失败时调用 await dialog.showMessageBox()。这些是模态阻塞对话框，在 main.ts:29 的 await textPickerFeature.initialize()
中执行，会阻塞后续的 optimizer.watchWindowShortcuts 注册和 activate 事件监听绑定。

影响: 如果用户在 Windows/Linux 上运行（平台不支持），或首次未授权辅助功能，主进程会被阻塞在 dialog 上。在此期间，app.on('browser-window-created') 和
app.on('activate') 的回调尚未注册。

修复建议: 将 textPickerFeature.initialize() 改为不阻塞主流程——要么不 await，要么将 dialog 改为非模态通知、日志输出或 Tray 状态提示，让主窗口流程正常完成后再处理。

---

[S2 Medium] showToolbar 中 position memory 分支为死代码

文件: text-picker-manager.ts:394-401

问题:
const memorizedPosition = memPos as (ToolbarPositionMemory & { x?: number | null; y?: number | null }) | undefined
if (memorizedPosition && memorizedPosition.x != null && memorizedPosition.y != null) {
ToolbarPositionMemory 接口只有 offsetX 和 offsetY，不存在 x 和 y 属性。类型断言添加了永远为 undefined 的属性检查，这个分支永远不会进入。

影响: 位置记忆功能完全失效——memorizePosition() 虽然正确写入了 positionMemory，但读取时永远走默认位置。

修复建议: 移除类型断言，直接检查 memPos:
if (memPos) {
x = anchor.x + memPos.offsetX
y = anchor.y + memPos.offsetY
}

---

[S2 Medium] GetTextByClipboard 同步阻塞主线程最长 600ms

文件: native/selection_bridge.mm:413 — [NSThread sleepForTimeInterval:0.025] × 24 次

问题: 剪贴板回退策略在原生代码中同步轮询最多 600ms。此代码在 Node.js 主线程上执行（通过 napi 同步调用），期间 Electron 事件循环完全阻塞。

影响: 原项目无主窗口影响不大。popMind 有主窗口，600ms 阻塞会导致 UI 卡顿（动画卡帧、输入延迟）。修复 ShouldClipboardFallback 为更宽松的 return true
后，此路径触发频率会更高。

修复建议: 当前可作为已知技术债保留（原始架构限制），但应记录此风险。长期应考虑将 getSelectionSnapshot 改为异步（使用
Napi::AsyncWorker），或将剪贴板轮询移到后台线程。

---

[S2 Medium] IPC channel 名称分散在三处无单一数据源

文件: text-picker-feature.ts:13-23, bubble-preload.ts, shared.ts

问题: IPC channel 名称（如 'textPicker:command'）以字符串字面量分别硬编码在 handler 注册（feature）、invoke 调用（preload）和 IPC_CHANNELS 数组中。没有共享的
channel 名称常量。

影响: 新增或重命名 channel 时容易遗漏某一侧，导致 IPC 断联但无编译期报错。

修复建议: 在 shared.ts 中定义 channel 名称常量对象，三处引用同一来源。

---

[S2 Medium] Tray 菜单静态构建导致 checkbox 状态不同步

文件: text-picker-feature.ts:109 — this.tray.setContextMenu(this.buildTrayMenu())

问题: Tray 菜单在 createStatusTray() 时一次性构建。checked 值在构建时求值，之后 click 回调虽然修改了 manager 状态，但如果用户再次打开 Tray 菜单，显示的仍是旧的
checkbox 状态（Electron 不会自动刷新 Menu）。

影响: 用户通过 Tray 切换"划词开关"或"选择模式"后，再次查看菜单时 checkbox 状态不一致。

修复建议: 在每次 Tray 菜单打开时重建菜单（监听 tray.on('click') 或在每次状态变更后调用 tray.setContextMenu(this.buildTrayMenu())）。原项目也有同样问题。

---

[S3 Low] skillsContainer.innerHTML = '' 可替换为更安全的 DOM API

文件: bubble.ts:43

问题: 使用 innerHTML = '' 清空子元素。虽然当前 skill labels 是硬编码字符串不存在 XSS 风险，但 replaceChildren() 是更安全且语义更清晰的替代。

---

[S3 Low] Bubble CSS 硬编码 color-scheme: light

文件: text-picker-bubble.css:2

问题: 气泡始终为亮色主题，在系统暗色模式下视觉不协调。

---

[S3 Low] onUpdate 返回的 unsubscribe 函数未使用

文件: bubble.ts:80

问题: window.textPicker.onUpdate(...) 返回一个清理函数但被丢弃。虽然气泡窗口生命周期与 listener 一致不会泄漏，但不够规范。

---

4. 测试评审摘要

已覆盖: 无测试。

缺失: 整个 text-picker 功能没有任何测试。

最小新增测试建议:

- TextPickerManager 单元测试：mock SelectionBridge 和 BubbleWindowPort，验证 onActionEvent 的 scene 路由（dismiss 场景→hideBubble、selection
  场景→scheduleSelectionCheck）。
- ShouldClipboardFallback 逻辑的 native 层测试较难，但 JS 侧的 refreshSelectionWithRetries 的重试/token 取消逻辑可测。
- TextPickerFeature.dispose() 验证所有 IPC handler 和 globalShortcut 被正确清理。

---

5. 资源与架构评估

架构:

- 分层清晰：shared.ts（类型/常量）→ selection-bridge.ts（native 桥接）→ text-picker-manager.ts（核心逻辑）→ bubble-window.ts（UI 抽象）→
  text-picker-feature.ts（集成编排）。BubbleWindowPort 接口是正确的抽象，利于测试。
- 原始架构的 native 同步阻塞设计是主要技术债。

资源风险:

- 全局事件监听持续消耗 CPU（轻微，NSEvent monitor 是 macOS 原生机制）。
- 剪贴板回退可阻塞主线程 600ms（已标注为 S2）。
- 无内存泄漏风险：dispose() 正确清理所有资源。

---

6. 合并建议与修复优先级

┌────────┬────────────────────────────┬──────────────────────────────────────┐
│ 优先级 │ 问题 │ 建议 │
├────────┼────────────────────────────┼──────────────────────────────────────┤
│ 1 │ S1: 激活策略冲突 │ 合并前修复，否则主窗口 Dock 图标消失 │
├────────┼────────────────────────────┼──────────────────────────────────────┤
│ 2 │ S1: initialize() 阻塞启动 │ 合并前修复，改为非阻塞 │
├────────┼────────────────────────────┼──────────────────────────────────────┤
│ 3 │ S2: position memory 死代码 │ 合并前修复，一行改动 │
├────────┼────────────────────────────┼──────────────────────────────────────┤
│ 4 │ S2: IPC channel 常量化 │ 可合并后跟进 │
├────────┼────────────────────────────┼──────────────────────────────────────┤
│ 5 │ S2: Tray 菜单状态不同步 │ 可合并后跟进 │
├────────┼────────────────────────────┼──────────────────────────────────────┤
│ 6 │ S2: 600ms 阻塞 │ 记录为技术债 │
├────────┼────────────────────────────┼──────────────────────────────────────┤
│ 7 │ S3: 其余项 │ 可选优化 │
└────────┴────────────────────────────┴──────────────────────────────────────┘
