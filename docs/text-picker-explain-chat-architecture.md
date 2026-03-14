# popMind 划词解释对话化实施文档

## 1. 目标

本次要做的不是“解释结果卡片”。

本次目标是：

1. 划词后点击 `解释`
2. 未配置 AI 时，保持当前外跳浏览器逻辑
3. 已配置 AI 时，打开一个轻量对话窗
4. 第一轮围绕选中文本生成解释
5. 支持多轮追问
6. 支持流式输出
7. 支持 markdown 渲染
8. 如果开启网络搜索，则走 `搜索 + AI`
9. 记录每一次解释到 SQLite

核心定位：

1. `解释` 变成一个从选区启动的轻量 chat
2. 不是主页聊天
3. 不是翻译窗的 explain mode

## 2. 设计原则

### 2.1 不要过度设计

本次只做满足需求的最小实现，不做额外平台化。

明确边界：

1. 单窗口单会话
2. 不做标签页
3. 不做会话列表
4. 不做历史恢复到 UI
5. 不做模型自动切换
6. 不做复杂的 RAG 或向量索引
7. 不做 prompt 配置中心

### 2.2 复用已有链路

优先复用：

1. 现有设置页
2. 现有 typed IPC 模式
3. 现有 Electron 浮层窗口模式
4. 现有 AI SDK 依赖基础

## 3. 需求结论

### 3.1 已确认

我们要支持：

1. 设置页在 `常规 -> 辅助功能` 下新增 `AI 服务` 卡片
2. 设置页在 `常规 -> 辅助功能` 下新增 `网络搜索配置` 卡片
3. AI provider 支持：
   - OpenAI
   - Claude / Anthropic
   - Gemini / Google
   - Kimi / Moonshot AI
   - DeepSeek
4. 网络搜索 provider 支持：
   - Tavily
   - Serper
   - Brave
   - Jina
5. 网络搜索默认关闭
6. 搜索 provider 优先级固定为：
   - `tavily > serper > brave > jina`
7. `解释` 改为多轮对话
8. `解释` 支持流式输出
9. 解释内容支持 markdown 渲染
10. 网络请求阶段需要 loading
11. 多轮对话超过模型最大上下文时要提示用户
12. prompt 不能写死中文，后续要支持国际化
13. 每一个解释要记录到 SQLite
14. 历史默认保留半年

### 3.2 重要决定

#### AI provider 规则

AI provider 不做自动优先级推断，使用显式 `activeProvider`。

原因：

1. 搜索 provider 的优先级是产品明确要求
2. AI provider 没有被要求优先级
3. 多个 AI key 自动切换会让用户不清楚实际命中的 provider

#### 搜索 provider 规则

搜索 provider 不让用户再选一次，运行时自动按固定优先级命中。

#### 多轮范围

一期只做单窗口单会话。

规则：

1. 点击一次 `解释`，启动一个新 session
2. 这个 session 支持持续追问
3. 再次对新的选区点击 `解释`，直接替换当前 session
4. 一期不做多会话管理

#### 搜索触发规则

如果网络搜索开启，并且存在可用 key：

1. 首轮解释一定搜索
2. 后续追问默认也搜索
3. 查询词基于“最新用户问题 + 初始选区摘要”

#### fallback 规则

1. 没有 AI 配置：保持当前外跳
2. 有 AI，无搜索配置：AI-only
3. 有 AI，搜索开启但无可用 key：AI-only
4. 有 AI，搜索开启且有 key：Search + AI
5. 搜索失败：降级为 AI-only
6. AI 调用失败：在对话窗中展示错误

## 4. 当前代码基线

### 4.1 当前 `解释` 行为

当前 `解释` 仍然在主进程里直接拼 URL 然后外跳。

关键文件：

1. `lib/text-picker/main/text-picker-feature.ts`
2. `lib/text-picker/shared.ts`
3. `lib/text-picker/main/text-picker-manager.ts`

当前事实：

1. `Explain` 和 `Search` 都走外部网页
2. `Translate` 单独走 `translationWindow`

### 4.2 当前设置链路

当前已经存在完整的“设置 -> IPC -> store -> service”链路：

1. `app/components/settings/SettingsPage.tsx`
2. `lib/conveyor/schemas/translation-schema.ts`
3. `lib/conveyor/api/translation-api.ts`
4. `lib/conveyor/handlers/translation-handler.ts`
5. `lib/translation/store.ts`
6. `lib/translation/service.ts`

### 4.3 当前 AI SDK 基础

当前已经有：

1. `ai`
2. `@ai-sdk/deepseek`

这意味着我们不是从零接 AI。

## 5. 总体方案

### 5.1 正确形态

本次推荐方案：

1. 保留当前 `Translate -> translationWindow`
2. 新增独立 `Explain -> selectionChatWindow`
3. AI 服务配置与网络搜索配置统一进入设置页
4. 历史记录进入 SQLite

### 5.2 为什么不复用翻译窗

旧建议“在翻译窗里加 explain mode”本次废弃。

原因：

1. 翻译窗是单轮结果面板
2. 解释现在需要输入框、消息流、流式输出、停止生成、markdown
3. 硬塞进翻译窗会让状态模型混乱

## 6. 设置与命名

### 6.1 文件命名优化

当前的 `translation-settings.json` 命名已经不合适。

推荐改为：

```text
capability-settings.json
```

原因：

1. 现在它不只存 translation
2. 还会存 AI 服务配置
3. 还会存网络搜索配置
4. 后续多语言相关配置也可能进入同一份设置

### 6.2 迁移规则

启动时做一次轻量迁移：

1. 如果 `capability-settings.json` 已存在，直接读取
2. 否则如果旧 `translation-settings.json` 存在，读取旧文件并迁移
3. 迁移成功后写入新文件
4. 旧文件是否删除可以后续再决定，一期不强制删

### 6.3 设置模型

推荐扩展为：

```ts
export type AiProviderId = 'openai' | 'anthropic' | 'google' | 'moonshot' | 'deepseek'
export type WebSearchProviderId = 'tavily' | 'serper' | 'brave' | 'jina'

export interface CapabilitySettings {
  enabledEngines: Record<TranslationEngineId, boolean>
  firstLanguage: string
  secondLanguage: string
  defaultSourceLanguage: 'auto' | string

  aiService: {
    activeProvider: AiProviderId | null
    providers: {
      openai: { apiKey: string; baseURL?: string; model?: string }
      anthropic: { apiKey: string; baseURL?: string; model?: string }
      google: { apiKey: string; baseURL?: string; model?: string }
      moonshot: { apiKey: string; baseURL?: string; model?: string }
      deepseek: { apiKey: string; baseURL?: string; model?: string }
    }
  }

  webSearch: {
    enabled: boolean
    providers: {
      tavily: { apiKey: string }
      serper: { apiKey: string }
      brave: { apiKey: string }
      jina: { apiKey: string }
    }
  }

  ui: {
    preferredLanguage?: string
  }
}
```

### 6.4 设置页调整

`SettingsPage` 调整为：

1. `常规`
   - 外观主题
   - 辅助功能权限
   - AI 服务
   - 网络搜索配置
2. `翻译`
   - 翻译引擎
   - 语言偏好
3. `历史记录`

当前单独的 `AI 配置` 分栏建议删除。

## 7. AI 服务设计

### 7.1 provider 接入方式

计划接入：

1. OpenAI：`@ai-sdk/openai`
2. Anthropic：`@ai-sdk/anthropic`
3. Google：`@ai-sdk/google`
4. DeepSeek：保留 `@ai-sdk/deepseek`
5. Moonshot：不依赖不存在的 `@ai-sdk/moonshotai`

### 7.2 Moonshot 兼容方式

Moonshot 使用 OpenAI 兼容模式接入：

```ts
import { createOpenAI } from '@ai-sdk/openai'
```

通过：

1. `baseURL`
2. `apiKey`
3. `model`

来兼容 Moonshot/Kimi。

这比等待一个不确定存在的独立 provider 包更稳妥。

### 7.3 输出语言不要写死

prompt 不能直接写死“用中文回答”。

必须通过一个统一的语言解析函数决定输出语言，例如：

1. 先看 `settings.ui.preferredLanguage`
2. 没有则回退到 app locale
3. prompt builder 根据该语言生成对应的 instruction

也就是说：

1. prompt 模板里不出现固定中文常量
2. 要由 `resolvePromptLanguage()` 动态注入

## 8. 网络搜索设计

### 8.1 provider 优先级

固定顺序：

```ts
const webSearchProviderOrder = ['tavily', 'serper', 'brave', 'jina'] as const
```

### 8.2 统一结果结构

```ts
export interface NormalizedSearchResult {
  title: string
  url: string
  snippet: string
  provider: WebSearchProviderId
}
```

### 8.3 Serper 说明

当前产品描述写的是 `Serper`，链接给的是 `SerpApi`。

这不是同一个产品。

本设计按 `Serper` 处理。

## 9. Selection Chat 设计

### 9.1 窗口定位

Selection Chat 是一个轻量浮层窗口。

特点：

1. 默认锚定在选区附近
2. 支持 pin
3. 支持关闭
4. 独立于翻译窗

### 9.2 UI 结构

建议结构：

1. Header
   - 选中文本摘要
   - AI provider badge
   - Web Search badge
   - Pin
   - Close
2. Message List
   - 第一条 user message 为选中文本
   - assistant message 支持 streaming
   - assistant message 支持 markdown 渲染
   - 有搜索时在消息底部展示 sources
3. Composer
   - 输入框
   - 发送按钮
   - 停止按钮

### 9.3 markdown 渲染

一期直接采用成熟方案，不自己写 parser。

推荐：

1. `react-markdown`
2. `remark-gfm`

范围控制：

1. 支持标题、列表、代码块、链接、引用
2. 不做复杂 HTML 白名单扩展
3. 不做自定义 markdown DSL

### 9.4 loading 表现

有网络请求时必须有明确 loading。

规则：

1. 首轮请求时立即插入一条空 assistant message
2. 状态为 `isLoading = true`
3. 在消息区显示 loading skeleton 或 typing indicator
4. 一旦首个 chunk 到达，转为 streaming

## 10. 会话与流式设计

### 10.1 状态模型

```ts
export interface SelectionChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  sources?: NormalizedSearchResult[]
  isLoading?: boolean
  isStreaming?: boolean
  createdAt: number
}

export interface SelectionChatState {
  sessionId: string
  selectionText: string
  selectionId?: string
  sourceAppId?: string
  pinned: boolean
  status: 'idle' | 'loading' | 'streaming' | 'error'
  aiProvider: AiProviderId | null
  webSearchProvider?: WebSearchProviderId
  messages: SelectionChatMessage[]
  errorMessage?: string
}
```

### 10.2 流式策略

流式在主进程执行，renderer 只负责展示。

原因：

1. API key 留在主进程
2. 取消生成更容易做
3. 搜索 + AI 的编排也在主进程更清晰

### 10.3 stop 机制

每个 in-flight generation 绑定一个 `AbortController`。

用户点击 stop 时：

1. main abort
2. 当前 assistant message 停止追加
3. 状态从 `streaming` 变成 `idle`

## 11. Token 与上下文限制

### 11.1 目标

多轮后不能无限堆消息。

必须在接近模型上下文上限时给用户提示。

### 11.2 实现原则

不要做复杂 tokenizer 平台。

采用最小实现：

1. 针对每个 provider 维护一个 `maxContextTokens` 常量表
2. 对消息做近似 token 估算
3. 优先保留：
   - system prompt
   - 当前用户问题
   - 最近几轮对话
   - 当前轮搜索结果
4. 超出预算时，先裁掉最早的历史轮次
5. 如果裁剪后仍超出，则阻止发送并提示用户“请开始新的解释会话”

### 11.3 用户提示

提示内容不要写死中文，必须走国际化文本资源。

提示语义：

1. 当前会话已超过模型最大上下文
2. 请关闭当前解释并重新开始

## 12. 历史记录设计

### 12.1 存储方式

每一个解释都保存到 SQLite。

为了不做过度设计，一期只加一张表：

```sql
CREATE TABLE IF NOT EXISTS explanation_history (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  selection_text TEXT NOT NULL,
  user_message TEXT NOT NULL,
  assistant_markdown TEXT NOT NULL,
  ai_provider TEXT NOT NULL,
  search_provider TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

说明：

1. 一条 assistant 回复对应一条历史记录
2. `session_id` 用来标记它来自哪次对话
3. 不额外拆分多表

### 12.2 清理策略

默认保留半年：

```ts
const EXPLANATION_RETENTION_DAYS = 180
```

同时增加数量上限保护，避免无限增长：

```ts
const EXPLANATION_MAX_ROWS = 5000
```

每次写入后执行清理：

1. 先删掉 `created_at < now - 180 days` 的记录
2. 如果总量仍超过 `5000`
3. 继续按 `created_at ASC` 删除最早的数据

### 12.3 为什么不复用现有 search-history

一期不直接塞进现有 `search-history`。

原因：

1. 搜索历史和解释历史语义不同
2. 解释有 markdown、provider、session 信息
3. 强塞会让现有表结构变脏

但实现方式可以复用现有 SQLite service 风格。

## 13. Prompt 设计

### 13.1 首轮解释

首轮 prompt 要求：

1. 围绕选中文本解释
2. 若内容较短，偏重含义和语境
3. 若内容较长，偏重总结、背景、关键点
4. 若有搜索结果，优先结合搜索上下文
5. 输出适合继续追问

### 13.2 语言动态化

prompt builder 接收 `outputLanguage`。

例如：

1. `zh-CN`
2. `en`
3. `ja`

由 `resolvePromptLanguage()` 统一解析。

不允许：

1. 在 prompt 字符串里直接写死“请用中文回答”
2. 在错误提示里写死中文
3. 在 loading 文案里写死中文

## 14. 推荐结构

保持最小目录新增：

```text
lib/
  ai-service/
    provider-factory.ts
  web-search/
    service.ts
    providers/
      tavily-provider.ts
      serper-provider.ts
      brave-provider.ts
      jina-provider.ts
  selection-chat/
    service.ts
    prompt.ts
    shared.ts
    window/
      selection-chat-window.ts
      selection-chat-window-manager.ts
  explanation-history/
    service.ts
app/
  selection-chat.tsx
  selection-chat.html
  components/selection-chat/
    SelectionChatPanel.tsx
    SelectionChatMessages.tsx
    SelectionChatComposer.tsx
lib/preload/
  selection-chat-preload.ts
```

## 15. 文件级改造范围

### 15.1 需要修改

1. `app/components/settings/SettingsPage.tsx`
2. `app/components/settings/styles.css`
3. `lib/conveyor/schemas/translation-schema.ts`
4. `lib/conveyor/api/translation-api.ts`
5. `lib/conveyor/handlers/translation-handler.ts`
6. `lib/translation/types.ts`
7. `lib/translation/shared.ts`
8. `lib/translation/store.ts`
9. `lib/translation/providers/deepseek-provider.ts`
10. `lib/text-picker/main/text-picker-feature.ts`
11. `package.json`

### 15.2 需要新增

1. `lib/ai-service/provider-factory.ts`
2. `lib/web-search/service.ts`
3. `lib/web-search/providers/tavily-provider.ts`
4. `lib/web-search/providers/serper-provider.ts`
5. `lib/web-search/providers/brave-provider.ts`
6. `lib/web-search/providers/jina-provider.ts`
7. `lib/selection-chat/service.ts`
8. `lib/selection-chat/prompt.ts`
9. `lib/selection-chat/shared.ts`
10. `lib/selection-chat/window/selection-chat-window.ts`
11. `lib/selection-chat/window/selection-chat-window-manager.ts`
12. `lib/explanation-history/service.ts`
13. `lib/preload/selection-chat-preload.ts`
14. `app/selection-chat.tsx`
15. `app/selection-chat.html`
16. `app/components/selection-chat/SelectionChatPanel.tsx`
17. `app/components/selection-chat/SelectionChatMessages.tsx`
18. `app/components/selection-chat/SelectionChatComposer.tsx`

## 16. 验收标准

### 16.1 配置

1. 配置文件命名从 `translation-settings.json` 迁移到 `capability-settings.json`
2. `常规` 页出现 `AI 服务` 和 `网络搜索配置`
3. 网络搜索默认关闭
4. 多个搜索 key 同时存在时，实际命中 Tavily

### 16.2 解释行为

1. 未配置 AI 时，点击 `解释` 仍外跳
2. 配置 AI 后，点击 `解释` 打开对话窗
3. 首轮消息基于选区内容生成
4. 用户可继续追问
5. assistant 支持 markdown 渲染
6. assistant 支持流式输出
7. 请求阶段有 loading
8. 支持停止生成

### 16.3 搜索

1. 开启搜索并配置 key 后，首轮回答带来源
2. 后续追问也能继续联网
3. 搜索失败时仍能继续 AI-only

### 16.4 上下文限制

1. 会话历史过长时，优先裁剪最老轮次
2. 如果仍超出上下文，阻止发送并提示用户开始新会话

### 16.5 历史

1. 每条 assistant 解释都写入 SQLite
2. 超过 180 天的数据会清理
3. 超过最大条数会继续删除最老记录

## 17. 需要你确认的点

1. 搜索 provider 是否确认是 `Serper`，不是 `SerpApi`
2. `EXPLANATION_MAX_ROWS` 是否接受先按 `5000` 实现
3. `AI 搜` 是否继续保持现状，不并入这个 selection chat

## 18. 最终结论

这次正确的实现形态是：

1. 设置层面：
   - `AI 服务`
   - `网络搜索配置`
   - 新配置文件名 `capability-settings.json`
2. 运行时层面：
   - `Explain` 进入独立 `selectionChatWindow`
   - 多轮追问
   - 流式输出
   - markdown 渲染
   - loading
3. 数据层面：
   - SQLite 记录每一个解释
   - 半年保留
   - 超量删除最早数据
4. 国际化层面：
   - prompt 和 UI 文案不写死中文

这套方案满足需求，同时控制了复杂度，没有把功能过度平台化。
