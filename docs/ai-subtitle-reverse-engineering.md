# AI 字幕翻译技术方案（基于 Immersive Translate 逆向分析）

> 逆向对象：Chrome 扩展 Immersive Translate `bpoadfkcbjbfhfodiogcnhhhpibjhbnh` v1.29.6
> 源码位置：`~/Library/Application Support/Google/Chrome/Default/Extensions/bpoadfkcbjbfhfodiogcnhhhpibjhbnh/1.29.6_0/`
> 关键文件：`video-subtitle/inject.js`、`content_main.js`、`default_config.json`、`background.js`

本文档的目的：把这套方案中可复用的工程决策提炼成可落地的实现指南，为自研插件提供参考。本文不涉及任何 UI 文案抄袭或商标，只讨论技术机制。

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│ Web Page (MAIN world)                                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ inject.js                                             │  │
│  │  - Hook XMLHttpRequest.open/send                      │  │
│  │  - Hook fetch                                         │  │
│  │  - Hook JSON.parse (Netflix/Udemy/Disney+/Hulu/Mubi)  │  │
│  │  - 解析 __NEXT_DATA__ (TED)                            │  │
│  │                                                       │  │
│  │  匹配 subtitleUrlRegExp → 触发 requestSubtitle()       │  │
│  └─────────────────────────┬─────────────────────────────┘  │
│                            │ window.postMessage             │
│                            │ eventType:"imt-subtitle-inject"│
│                            ▼                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ content_main.js (ISOLATED world)                      │  │
│  │  1. 解析 (VTT/SRT/TTML/JSON3/EBU-TT/…) → cue[]        │  │
│  │  2. 按 maxTextGroupLengthPerRequestForSubtitle 分批    │  │
│  │  3. YAML 装配 → LLM → YAML 解包 → 按 id 回填           │  │
│  │  4. 渲染：                                             │  │
│  │     A. 覆写 XHR 响应 (原生播放器渲染)                  │  │
│  │     B. 自渲染 overlay (.imt-caption-container)         │  │
│  └─────────────────────────┬─────────────────────────────┘  │
└────────────────────────────┼────────────────────────────────┘
                             │ chrome.runtime.sendMessage
                             ▼
                  ┌─────────────────────────┐
                  │ background.js / offscreen│
                  │ - 翻译服务调度            │
                  │ - 鉴权 / 计费             │
                  │ - 跨页缓存 (chrome.storage│
                  │   /IndexedDB)            │
                  └─────────────────────────┘
```

三个进程边界各司其职：

- **MAIN world（页面）**：必须在这里 hook，因为 XHR/fetch/JSON.parse 都是页面上下文的全局对象，content script 的 isolated world 改不了页面的全局。
- **content_main.js**：所有翻译编排、缓存、UI 决策。不直接调外部 API。
- **background/offscreen**：CORS 受限的请求、敏感凭据、持久化都放在这里。

---

## 2. 字幕捕获策略：三种 hook 模式

### 2.1 模式总览

| `hookType`          | 行为                                                                                                             | 适用场景                          | 实例                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| `"xhr"` / `"fetch"` | **覆写响应**：拦下原 XHR，先翻译再 `defineProperty` 改 `responseText`，原生播放器自己渲染                        | 字幕 URL 公开、原生播放器渲染稳定 | Prime Video、BBC、Mubi、Hulu、TED、Crunchyroll、Dailymotion、Udemy、Coursera、Vimeo、80+ 站点 |
| `"xhr_response"`    | **只读旁听**：原 XHR 正常完成，仅复制一份 `responseText` 给 content script；CSS 隐藏原生字幕，插件自渲染 overlay | 原生字幕样式复杂、覆写易冲突      | YouTube 全家（youtube/youtubekids/tvYoutube/yotube-embed/youtubeMobile）                      |
| 无 `hookType`       | **结构化拦截**：hook `JSON.parse` 拿 track 清单 / 读 `__NEXT_DATA__` / 调播放器 SDK                              | 字幕走 SPA 元数据，没有独立 XHR   | Netflix、Disney+、edX、Khan Academy、Bilibili、TikTok、Apple TV、Zoom/Teams/Meet（live）      |

### 2.2 关键代码：路由分支（inject.js）

```js
// 进入 hook 的核心分支：覆写 vs 只读
if (hookType.includes('xhr')) {
  XMLHttpRequest.prototype.send = async function () {
    const url = this._url
    if (!isSubtitleRequest(url)) return origSend.apply(this, arguments)

    if (await isOnlyResponse()) {
      // hookType==="xhr_response"
      startRequestSubtitle(url) // 通知 UI 进入 loading
      this.onreadystatechange = async () => {
        if (this.readyState === 4 && this.status === 200) {
          translateSubtitleWithResponse(url, this.responseText)
          // 不修改 this.response，原 XHR 正常完成
        }
      }
    } else {
      // hookType==="xhr"
      await translateSubtitle(this) // 阻塞等翻译，覆写 responseText
    }
    return origSend.apply(this, arguments)
  }
}
```

### 2.3 SPA 元数据拦截（Netflix 示例）

Netflix 的字幕清单藏在播放器 manifest API 的 JSON 里：

```js
const orig = JSON.parse
JSON.parse = (txt) => {
  const obj = orig(txt)
  if (obj?.result?.timedtexttracks && obj?.result?.movieId) {
    this.videoMeta[obj.result.movieId] = obj.result
    this.lastVideoMeta = obj.result
  }
  return obj
}
```

Udemy 看 `asset.captions`、Disney+ 看 `stream.sources[0].complete.url`、TED 直接解析 `#__NEXT_DATA__` 文本里的 JSON——每个站点一个轻量子类，共享基类的 RPC/缓存逻辑。

### 2.4 决策依据：什么时候用哪种？

- **能不能拿到独立的字幕 URL？** 不能 → JSON.parse hook（模式 3）。
- **能拿到，原生播放器渲染是否稳定且样式简单？**
  - 是 → 覆写响应（模式 1），最省事，全屏/PIP/AirPlay 都不破坏。
  - 否（如 YouTube 复杂的 caption-window 样式 + 多次重发） → 只读旁听 + 自渲染（模式 2）。

---

## 3. **核心：YAML + id 批量翻译协议**

这是这套方案的灵魂。解决"一次给 LLM 喂 N 句话翻译，怎么保证 N 条结果一一对齐回原字幕"的问题。

### 3.1 为什么不能裸文本批译

最朴素的做法是把 N 条字幕用 `\n\n` 或 `%%` 分隔扔给 LLM，让它返回同样数量的段落。但这条路有三类高频翻车：

1. **行数不对**：模型把两句合译成一句（中文表达更紧凑时尤其常见），下游对不齐时间戳。
2. **顺序错位**：长字幕中模型偶尔重排。
3. **多译/漏行**：模型加一句"以下是翻译："、漏掉空行、把空字幕跳过。

一旦 N 条里有一条出问题，整批翻译都得废弃重来。

### 3.2 解决方案：带 id 的 YAML

把字幕装成显式 schema：

```yaml
- id: 1
  text: We're going to talk about transformers today.
- id: 2
  text: They're the backbone of modern LLMs.
- id: 3
  text: Attention is all you need.
- id: 4
  text: Let's start with the encoder.
- id: 5
  text: Each encoder has a self-attention layer.
```

要求 LLM 返回：

```yaml
- id: 1
  translation: 我们今天聊聊 transformer。
- id: 2
  translation: 它们是现代大语言模型的骨干。
- id: 3
  translation: 你只需要注意力机制。
- id: 4
  translation: 我们从编码器开始讲起。
- id: 5
  translation: 每个编码器都有一层自注意力。
```

下游用 `js-yaml` 解析回 `[{id, translation}]`，**按 id 取**而不是按数组下标。

### 3.3 收益

| 问题                  | YAML+id 的处理                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------- |
| 模型合译两行          | id=2 缺失 → 标记 `state:"error", needReTranslate:true`，**单独补译这一行**而不是整批重来 |
| 模型重排顺序          | 顺序无关，按 id 回填                                                                     |
| 模型多了一行废话      | 多余的 id 不存在 → 直接丢弃，不污染时间戳                                                |
| 模型漏一行            | 同合译情况，单条补译                                                                     |
| 模型在中间偷偷合并 id | 解析时发现某 id 翻译里塞了多句、或某 id 没出现 → 触发 needReTranslate                    |

**关键性质：故障是单条粒度的，不是批粒度的。** 这才让 batch=5 成为可能。

### 3.4 模板与组装（content_main.js）

```js
async _translate(t) {
  const { text, options } = t;
  const isSubtitle = ["subtitle_video", "subtitle_file"].includes(options?.usageScene);

  // 1. 选 prompt（subtitlePrompt 优先于 multiplePrompt 优先于 prompt）
  let prompt = this.prompt;
  if (texts.length > 1 && this.multiplePrompt) prompt = this.multiplePrompt;
  if (isSubtitle && this.subtitlePrompt) prompt = this.subtitlePrompt;

  // 2. 判定是否走 YAML 模式
  const useYaml = prompt.includes("{{yaml}}");
  if (!useYaml) { /* fallback：%% 分隔的旧路径 */ }

  // 3. 组装 YAML
  let itemTpl = env.imt_yaml_item || "";
  if (isSubtitle) itemTpl = env.imt_subtitle_yaml_item || itemTpl;
  //   imt_subtitle_yaml_item = "- id: {{id}}\n  text: {{text}}"

  const items = texts.map((txt, i) =>
    itemTpl.replace(/{{id}}/g, i + 1).replace(/{{text}}/g, txt)
  );
  const yamlPayload = items.join("\n");

  // 4. 把 yamlPayload 填进 prompt 的 {{yaml}} 占位
  // 5. systemPrompt 注入 few-shot 示例（subtitle_result_yaml_example）
  //    可选注入 sub_summary_prompt（视频摘要）、sub_terms_prompt（术语表）
}
```

实际发给 LLM 的样子（系统提示 + 用户提示拼合后）：

```
System:
You are a professional Simplified Chinese native translator…

<example>
Input:
  - id: 1
    text: ...
  - id: 2
    text: ...
Output:
  - id: 1
    translation: ...
  - id: 2
    translation: ...
</example>

## Context Awareness
Type: Subtitle
Summary: 本视频介绍 transformer 架构的核心思想…

Required Terminology:
  attention -> 注意力
  encoder -> 编码器

User:
Translate to Simplified Chinese:

- id: 1
  text: We're going to talk about transformers today.
- id: 2
  text: ...
```

### 3.5 字段名是可配置的（重要！）

注意 `env` 里有这四个字段：

```json
"imt_sub_source_field": "text",       // 输入字段名
"imt_sub_trans_field":  "translation" // 输出字段名
"imt_source_field":     "text",       // 非字幕场景
"imt_trans_field":      "text"        // 非字幕场景同名
```

**字幕场景输入 `text`、输出 `translation` 是故意不同名的**——这样 LLM 不容易把原文 echo 出来（"text 字段不变只填 translation 字段"是更自然的指令），同时下游解析也能严格校验"出现 translation 字段才算翻译完成"。

### 3.6 批大小的工程选择

`maxTextGroupLengthPerRequestForSubtitle` 的取值规律：

| 模型类别                                                    | 取值 | 理由                                                                       |
| ----------------------------------------------------------- | ---- | -------------------------------------------------------------------------- |
| OpenAI / Claude / Gemini / Grok / 智谱 Pro/Max              | 5    | 结构化输出能力强，YAML 指令跟得住，吞吐换延迟                              |
| 豆包 / 通义千问 / Ollama / Groq / Azure-OpenAI / 智谱基础版 | 1    | 中等模型对 YAML 不稳，多条容易串行、丢 id 或合并；一行一请求，靠并发拉吞吐 |

**实操建议**：自研时给每个支持的模型都跑一遍"100 行字幕翻译，比对回包 id 完整率"，命中率 <95% 的就降到 1。

---

## 4. 渲染：两条回吐路径

### 4.1 覆写原生轨道（适合 DRM 流媒体）

翻译完成后，content script 把双语字幕**重新拼回原格式**（VTT/SRT/TTML）回传给 inject.js：

```js
// VTT 拼装伪代码
let out = 'WEBVTT\n\n'
for (const cue of cues) {
  out += `${cue.id || i + 1}\n`
  out += `${toVttTime(cue.start)} --> ${toVttTime(cue.end)}\n`
  out += `${cue.text}\n${cue.translation}\n\n` // 双语：源文 \n 译文
}
return out
```

inject.js 用 `Object.defineProperty` 把这段塞进原 XHR：

```js
Object.defineProperty(xhr, 'responseText', { value: translatedVtt, writable: false })
Object.defineProperty(xhr, 'response', { value: translatedVtt, writable: false })
// arraybuffer 模式额外做 TextEncoder().encode().buffer
```

播放器拿到的就是"原始字幕"，自己渲染。这条路最省事，但要求：

- 拿得到字幕 URL（必须有 XHR/fetch）
- 原生播放器渲染 cue 时不依赖额外的 metadata（YouTube 的 srv3 就依赖很多额外标签）

### 4.2 自渲染 overlay（适合 YouTube/Netflix 等）

content script 维护自己的 cue 数组 + 渲染 DOM：

```html
<div id="immersive-translate-caption-window" class="imt-caption-container imt-caption-window">
  <div class="source-cue">We're going to talk about transformers today.</div>
  <div class="target-cue">我们今天聊聊 transformer。</div>
</div>
```

挂载位置由站点规则的 `attachRule.appendSelector` 指定（如 YouTube 的 `#player-container-id`）；原生字幕被 `injectedGlobalCSS` 里的 `.caption-window { display: none; }` 隐藏掉。

同步靠 `requestAnimationFrame` 或 `timeupdate` 事件轮询 `video.currentTime`，二分查找当前 cue 区间。

### 4.3 选哪条？

| 因素                                                     | 倾向                                          |
| -------------------------------------------------------- | --------------------------------------------- |
| 字幕走 XHR 且原生播放器渲染简单                          | 覆写                                          |
| 原生字幕样式跟用户配置耦合深（YouTube 字号、位置、轮廓） | 自渲染                                        |
| 需要支持"只看译文"模式                                   | 自渲染（覆写也能做但 cue 重新分组麻烦）       |
| 需要支持点词查询、悬停翻译、字幕复制                     | 自渲染（DOM 自己控）                          |
| 全屏、PIP、AirPlay 必须工作                              | 覆写（自渲染需要 fullscreen-change 重新挂载） |
| 实时字幕（live）/ 无 XHR                                 | 必须自渲染（数据走 WebSocket / 播放器事件）   |

---

## 5. 站点适配的最小配置面

每个站点的接入配置（精简）：

```yaml
id: someSite
matches: ['www.example.com']
subtitleRule:
  type: webvtt # 解析器：vtt/srt/ttml/json/ebutt/srv3/...
  hookType: xhr # xhr / fetch / xhr_response / xhr|fetch / 留空
  subtitleUrlRegExp: '\.vtt$'
  videoPlayerSelector: 'video.main-player'
  subtitleButtonSelector: '.cc-button' # 用于触发原生开字幕（先开才发字幕请求）
  captionContainerSelector: '#captions' # 自渲染时挂载点
  attachRule: # 自渲染时的样式 + 全局 CSS
    appendSelector: '#player'
    injectedGlobalCSS:
      - '.native-caption { display: none; }'
```

整套规则插件里有 810 条，覆盖 80+ 平台。对自研项目的启示：**把站点适配做成数据驱动，而不是 if/else 嵌套**，新增一个平台只是加一个 YAML/JSON 块。

---

## 6. 服务端 + 缓存层

### 6.1 双轨翻译

- **优先**：用户自配的 LLM key（OpenAI / Claude / Gemini / 豆包 / 通义 / 智谱 / 自定义 OpenAI 兼容 endpoint）
- **兜底**：插件自家后端 `api.immersivetranslate.com` / `ai.immersivetranslate.com`（免费额度有时限，配置里有 `freeAiSubtitleCacheEndTime: "2025-09-30"`）

### 6.2 缓存

- **内存缓存**：content_main.js 里 `wt.memoryCacheMap` 当页 cue 翻译缓存
- **持久缓存**：background 维护 `chrome.storage` / IndexedDB，按 `(videoId | url-hash, sourceLang, targetLang, model, promptVersion)` 做 key
- **服务端缓存**：付费用户的字幕翻译有云端缓存（配置里 `freeAiSubtitleCacheNewUserLimitDay: 10`，免费新用户也给 10 天缓存）

**自研建议**：本地缓存至少做 `videoId + targetLang + model`，YouTube 一段视频用户反复看，缓存命中能省 90%+ 的 LLM 调用。

---

## 7. 上下文增强（让翻译质量上一个台阶）

字幕翻译质量主要被三件事拉低：

1. **缺少视频主题**：单条字幕脱离上下文容易直译走样。
2. **专有名词**：人名、产品名、技术术语需要一致性。
3. **代词消歧**：he/she/it/they 在中文里要展开。

Immersive Translate 的解法是在 system prompt 里**条件注入**三个上下文块：

```
{{title_prompt}}    →  ## Context Awareness
                       Document Metadata:
                       Title: 《视频标题》

{{sub_summary_prompt}} → ## Context Awareness
                         Document Metadata:
                         Type: Subtitle
                         Summary: 本视频讲述了…（首批翻译完后用 LLM 生成）

{{sub_terms_prompt}} → Required Terminology:
                       attention -> 注意力
                       encoder -> 编码器
                       （术语来自 aifw/ WASM 模块的 NER + 用户自定义词表）
```

**视频摘要怎么来**：第一批 cue 翻译完成后，把所有原文（或前 100 条）发一次给 LLM 让它出 200 字摘要，之后每批翻译都带上这个摘要。**这是这套方案最容易被忽视但效果最显著的优化点。**

---

## 8. 实时字幕（live）

实时场景没有 XHR 可 hook，只能：

1. **拿数据源**：
   - YouTube live：hook XHR 同样能拿到分片字幕，但要快速翻译
   - Zoom/Teams/Meet：调用平台的 closed-caption 事件 API
   - 浏览器原生：`SpeechRecognition` API 实时转写音频
2. **降延迟策略**：
   - batch=1
   - 流式 LLM 输出，逐 token 推到 UI
   - 切短句：用 punctuation/silence 切分而不是等完整句
   - 预翻译（pre-translation）：边播边译下一段
3. **服务选择**：DeepL Pro 这类同步翻译比 LLM 快得多，配置里 live 优先用 `proLiveSubtitleTranslateService: "deepl-pro"`，AI 字幕只在非 live 模式下用。

---

## 9. 对自研项目的实施清单

按这个顺序实现，每一步都能单独跑通：

- [ ] **Stage 1：单平台覆写**。挑一个简单平台（如直接发 `.vtt` 的 BBC），实现 inject.js 的 XHR hook + content script 的"原文返回"（不翻译）。验证能拿到字幕原文。
- [ ] **Stage 2：YAML 批量翻译**。接入一个 LLM，实现 YAML 装配 + js-yaml 解包 + id 回填 + needReTranslate 单条重试。跑 100 条字幕验证 id 完整率。
- [ ] **Stage 3：双语回吐**。把翻译结果拼回 VTT，覆写 XHR 响应，验证原生播放器显示双语。
- [ ] **Stage 4：缓存**。chrome.storage + IndexedDB，按 (url-hash, targetLang, model) 缓存翻译结果。
- [ ] **Stage 5：YouTube 适配**。第一个需要"只读 + 自渲染"的平台。实现 `hookType: "xhr_response"`、隐藏原生 caption、自己挂 overlay、`timeupdate` 同步。
- [ ] **Stage 6：上下文增强**。视频标题注入 + 摘要预生成 + 术语词表注入。比对翻译质量提升。
- [ ] **Stage 7：Netflix/Disney+ 类 SPA**。`JSON.parse` hook 抓 track 清单，配合 Stage 5 的自渲染。
- [ ] **Stage 8：站点规则数据化**。把所有站点 selector / regex / hookType 抽到 JSON 配置，新增平台不改代码。
- [ ] **Stage 9：实时字幕**。如果产品形态需要。
- [ ] **Stage 10：服务端缓存 + 兜底**。如果有自己的后端。

---

## 10. 注意事项与坑

- **MAIN world 注入时机**：必须 `run_at: document_start`，否则 `XMLHttpRequest.prototype.send` 已经被页面缓存了你 hook 不到。Manifest V3 用 `world: "MAIN"` 的 content script，或者 V2 的 `<script>` 注入 `web_accessible_resources` 里的脚本。
- **`Object.defineProperty` 覆写 responseText**：`writable: false` 必须设，否则有些播放器会再读 `this.response` 拿到原始 buffer。
- **XHR `responseType: "arraybuffer"`**：返回前要 `new TextEncoder().encode(translatedText).buffer`。
- **YAML 文本里有 `:` 或换行**：装配前 escape，建议用 `js-yaml.dump` 反向生成而不是字符串模板。
- **LLM 返回 markdown 代码块包裹的 YAML**：解析前去 \`\`\`yaml … \`\`\` 包装。
- **id 必须从 1 开始而不是 cue 原 id**：cue 原 id 可能不连续或太大，模型容易抄错；批内重新编号 1..N 最稳。
- **超长 cue**：单条 cue 超过 `aiSubtitleMaxTextLength: 500` 字符的，单独成批不要拼。
- **rate limit**：每个翻译服务有 `limit`（默认 5 req/s），需要本地令牌桶。
- **失败 1 条不能阻塞整批渲染**：cue 数组里某条 `state:"error"` 时，UI 显示原文 + 错误指示而不是空白。

---

## 11. 参考实现位置（逆向源码）

| 功能                                | 文件                       | 位置标记                                            |
| ----------------------------------- | -------------------------- | --------------------------------------------------- |
| MAIN world hook 路由                | `video-subtitle/inject.js` | 整个文件（约 350 行 minified）                      |
| 站点 hook 子类（YouTube/Netflix/…） | `video-subtitle/inject.js` | `class b extends o` / `class S extends o` 等        |
| postMessage RPC 协议                | `video-subtitle/inject.js` | `class p` + `Proxy(E)`                              |
| content script RPC 接收             | `content_main.js`          | `handleMessages` 调用 `this[type].apply`            |
| YAML 装配                           | `content_main.js`          | 搜 `imt_subtitle_yaml_item`                         |
| YAML 解析                           | `content_main.js`          | 搜 `js-yaml`                                        |
| 字幕格式解析器                      | `content_main.js`          | 搜 `Kpe={vtt:..., srt:..., ssa:...}`                |
| 双语 VTT 拼装                       | `content_main.js`          | 搜 `bm.toTimeString`                                |
| 自渲染 overlay 组件                 | `content_main.js`          | 搜 `imt-caption-container`                          |
| 全部站点规则                        | `default_config.json`      | `rules[]` 数组（810 条）                            |
| Prompt 模板                         | `default_config.json`      | `translationServices.ai.{subtitlePrompt,env.*}`     |
| AI 字幕全局配置                     | `default_config.json`      | `powerUser.aiSubtitle` / `generalRule.subtitleRule` |

---

## 附录 A：YAML+id 批量翻译参考实现（TypeScript）

下面是完整可运行的最小实现，只依赖 `js-yaml`。`translateBatch()` 输入 N 条 cue、输出 N 条带 `state` 的翻译结果，单条失败会自动重试，不阻塞其余条。

````ts
import yaml from 'js-yaml'

export interface Cue {
  id: number // 批内编号 1..N
  text: string // 原文
  translation?: string
  state: 'pending' | 'translated' | 'error'
  retried: number
}

export interface BatchOptions {
  targetLang: string
  batchSize: number // 5（GPT/Claude）或 1（豆包/Ollama）
  maxRetryPerCue: number // 推荐 2
  maxCharsPerCue: number // 500，超出单独成批
  videoSummary?: string // 可选：视频摘要
  terms?: Record<string, string> // 可选：术语表
  callLLM: (system: string, user: string) => Promise<string>
}

const SYSTEM_PROMPT = (lang: string, summary?: string, terms?: Record<string, string>) =>
  `
You are a professional ${lang} native translator who needs to fluently translate text into ${lang}.

## Translation Rules
1. Output only translated content under the "translation" field, no explanations.
2. Output MUST keep the same number of items and the same ids as input.
3. Do not merge, split, reorder or drop any item.
4. For untranslatable content (code, proper nouns), keep the original text.

## Output Format
Return YAML only, no markdown code fences:
- id: <number>
  translation: <translated text>

<example>
Input:
  - id: 1
    text: Hello world
  - id: 2
    text: Attention is all you need
Output:
  - id: 1
    translation: 你好，世界
  - id: 2
    translation: 注意力就是你所需要的一切
</example>

${summary ? `## Context Awareness\nType: Subtitle\nSummary: ${summary}\n` : ''}
${
  terms && Object.keys(terms).length
    ? `## Required Terminology\n${Object.entries(terms)
        .map(([k, v]) => `  ${k} -> ${v}`)
        .join('\n')}\n`
    : ''
}
`.trim()

const USER_PROMPT = (lang: string, items: Cue[]) =>
  `Translate to ${lang}:\n\n` + items.map((c) => `- id: ${c.id}\n  text: ${escapeYamlValue(c.text)}`).join('\n')

function escapeYamlValue(s: string): string {
  // 用 js-yaml 的 dump 拿到正确转义，再剥掉外层 "key:" 包装
  // 简化版：含特殊字符就用双引号包并转义
  if (/[\n:#&*!|>'"%@`]/.test(s)) {
    return JSON.stringify(s) // YAML 兼容 JSON 字符串
  }
  return s
}

function stripCodeFence(raw: string): string {
  return raw
    .replace(/^```(?:yaml|yml)?\s*\n?/i, '')
    .replace(/```\s*$/, '')
    .trim()
}

/**
 * 一次批翻译。返回的 cues 与输入同序，state 标注是否成功。
 */
export async function translateBatch(inputs: string[], opts: BatchOptions): Promise<Cue[]> {
  // 1. 切分：超长 cue 独立成批
  const groups: string[][] = []
  let buf: string[] = []
  for (const text of inputs) {
    if (text.length > opts.maxCharsPerCue) {
      if (buf.length) {
        groups.push(buf)
        buf = []
      }
      groups.push([text])
    } else {
      buf.push(text)
      if (buf.length >= opts.batchSize) {
        groups.push(buf)
        buf = []
      }
    }
  }
  if (buf.length) groups.push(buf)

  // 2. 并发翻译每个批（外层调用方控并发数 + 令牌桶）
  const results: Cue[][] = await Promise.all(groups.map((g) => translateOneGroup(g, opts)))

  // 3. 重新编号回原顺序
  const flat = results.flat()
  return flat.map((c, i) => ({ ...c, id: i + 1 }))
}

async function translateOneGroup(group: string[], opts: BatchOptions): Promise<Cue[]> {
  const cues: Cue[] = group.map((text, i) => ({
    id: i + 1,
    text,
    state: 'pending',
    retried: 0,
  }))

  await translateAndFill(cues, opts)

  // 单条补译
  while (cues.some((c) => c.state === 'error' && c.retried < opts.maxRetryPerCue)) {
    const retryList = cues.filter((c) => c.state === 'error' && c.retried < opts.maxRetryPerCue)
    for (const c of retryList) c.retried++
    await translateAndFill(retryList, opts)
  }
  return cues
}

async function translateAndFill(cues: Cue[], opts: BatchOptions): Promise<void> {
  const sys = SYSTEM_PROMPT(opts.targetLang, opts.videoSummary, opts.terms)
  const user = USER_PROMPT(opts.targetLang, cues)

  let raw: string
  try {
    raw = await opts.callLLM(sys, user)
  } catch (e) {
    for (const c of cues) c.state = 'error'
    return
  }

  let parsed: Array<{ id: number; translation: string }> = []
  try {
    parsed = yaml.load(stripCodeFence(raw)) as any
    if (!Array.isArray(parsed)) throw new Error('not array')
  } catch {
    for (const c of cues) c.state = 'error'
    return
  }

  const byId = new Map(parsed.filter((p) => p && typeof p.id === 'number').map((p) => [p.id, p.translation]))
  for (const c of cues) {
    const t = byId.get(c.id)
    if (typeof t === 'string' && t.trim().length > 0) {
      c.translation = t
      c.state = 'translated'
    } else {
      c.state = 'error'
    }
  }
}
````

**使用示例**：

```ts
const cues = await translateBatch(
  rawSubtitles.map((s) => s.text),
  {
    targetLang: 'Simplified Chinese',
    batchSize: 5,
    maxRetryPerCue: 2,
    maxCharsPerCue: 500,
    videoSummary: '本视频介绍 transformer 架构的核心思想',
    terms: { attention: '注意力', encoder: '编码器' },
    callLLM: async (sys, user) => {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        temperature: 0,
      })
      return resp.choices[0].message.content!
    },
  }
)
```

---

## 附录 B：质量度量

跑回归测试时建议至少记录这四个指标：

| 指标           | 含义                                               | 目标                       |
| -------------- | -------------------------------------------------- | -------------------------- |
| **id 完整率**  | 一次请求返回的 id 集合 == 输入 id 集合的比例       | ≥ 95%，否则降 batch        |
| **首次成功率** | cue.state === "translated" 且 retried === 0 的占比 | ≥ 90%                      |
| **最终成功率** | 包含补译后 translated 的占比                       | ≥ 99%                      |
| **平均延迟**   | (总耗时) / (cue 总数)                              | YouTube 场景需 < 200ms/cue |

测试集建议覆盖：长字幕、含标点字幕、含 HTML 标签字幕（`<i>` 等）、纯数字时间戳、空字符串、emoji、跨语言混排（英中混排的英文字幕）。

---

## 附录 C：Manifest V3 下的 MAIN-world 注入配方

MV3 的 content script 默认跑在 ISOLATED world，碰不到页面的 `XMLHttpRequest.prototype`。三种实现方式：

### 方式 1：声明式 MAIN-world content script（Chrome 111+）

```json
// manifest.json
{
  "content_scripts": [
    {
      "matches": ["*://*.youtube.com/*", "*://*.bbc.com/*"],
      "js": ["video-subtitle/inject.js"],
      "world": "MAIN",
      "run_at": "document_start",
      "all_frames": true
    },
    {
      "matches": ["*://*.youtube.com/*", "*://*.bbc.com/*"],
      "js": ["content_main.js"],
      "world": "ISOLATED",
      "run_at": "document_idle"
    }
  ]
}
```

### 方式 2：programmatic `scripting.executeScript`

```ts
chrome.scripting.executeScript({
  target: { tabId, allFrames: true },
  world: 'MAIN',
  injectImmediately: true,
  files: ['video-subtitle/inject.js'],
})
```

### 方式 3：兜底（旧 Chrome 或 Firefox）

content script 创建 `<script>` 标签注入 web_accessible_resources：

```ts
const s = document.createElement('script')
s.src = chrome.runtime.getURL('video-subtitle/inject.js')
;(document.head || document.documentElement).prepend(s)
s.remove()
```

`web_accessible_resources` 要声明对应文件可被页面访问。

### MAIN ↔ ISOLATED 通信

两边只能用 `window.postMessage`。Immersive Translate 的 RPC 用了 Proxy 让远端调用看起来像本地方法：

```ts
// 简化版
class RpcChannel {
  constructor(
    public from: string,
    public to: string
  ) {}

  call(method: string, data: any): Promise<any> {
    return new Promise((resolve) => {
      const id = Math.random().toString(36)
      window.postMessage({ eventType: 'subtitle-rpc', from: this.from, to: this.to, method, data, id }, '*')
      const handler = (ev: MessageEvent) => {
        const m = ev.data
        if (m?.eventType === 'subtitle-rpc' && m.id === id && m.to === this.from) {
          window.removeEventListener('message', handler)
          resolve(m.data)
        }
      }
      window.addEventListener('message', handler)
    })
  }

  on(method: string, handler: (data: any) => any) {
    window.addEventListener('message', async (ev) => {
      const m = ev.data
      if (m?.eventType !== 'subtitle-rpc' || m.to !== this.from || m.method !== method) return
      const result = await handler(m.data)
      window.postMessage({ eventType: 'subtitle-rpc', from: this.from, to: m.from, id: m.id, data: result }, '*')
    })
  }
}

// 用 Proxy 让 ch.requestSubtitle({url}) 自动变成 RPC
const remote: any = new Proxy(new RpcChannel('inject', 'content-script'), {
  get(target, prop) {
    return (data: any) => target.call(prop as string, data)
  },
})

await remote.requestSubtitle({ url: 'https://...' })
```
