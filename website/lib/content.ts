// The site's words, in Simplified Chinese and English: the same pages in two languages. Facts only: every
// feature here is in the app as released, every number measured.

import { DOWNLOAD_SIZE, LICENSE, MIN_MACOS, SHORTCUTS, VERSION } from './facts';

export type Lang = 'zh' | 'en';

export const SITE_URL = 'https://pm.luckysnail.cn';
export const REPO_URL = 'https://github.com/coderPerseus/popMind';
// The latest release's disk image, under a name that does not change from version to version.
export const DOWNLOAD_URL = `${REPO_URL}/releases/latest/download/popMind-arm64.dmg`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const AUTHOR_URL = 'https://github.com/coderPerseus';

// Where each language lives: the home pages and the install guides.
export const paths = {
  zh: { home: '/zh', guide: '/zh/install-guide' },
  en: { home: '/en', guide: '/en/install-guide' },
} as const;

export const content = {
  zh: {
    nav: { how: '场景', features: '用法', models: '模型', faq: '常见问题', guide: '安装引导', download: '下载', other: 'English' },
    hero: {
      eyebrow: 'macOS 全局划词翻译 · AI 解释 · 剪贴板',
      title: '选中文本，AI 即刻响应。',
      lead: '浏览器、PDF、终端、微信……在任何应用里选中一段文字，旁边就弹出 popMind：翻译、解释、追问、复制、跳转 AI，一步到位。不用切换应用，不打断阅读。',
      download: '下载 macOS 版',
      how: '看看适合你的场景',
      note: `免费开源 · macOS ${MIN_MACOS} 及以上 · Apple 芯片`,
    },
    demo: {
      app: '阅读器',
      text: 'Retrieval-augmented generation grounds a model in your own documents, so its answers cite',
      picked: 'sources you can check',
      after: 'instead of guessing.',
      tip: '翻译',
      engine: 'Google',
      result: '你可以核实的来源',
      from: '自动检测',
      to: '简体中文',
      speak: '朗读',
      copy: '复制',
    },
    howTitle: '四种用法，随手就来。',
    how: [
      { keys: ['划词'], title: '选中即弹出', body: '在任何应用里选中文字，光标旁出现一排图标：翻译、解释、追问、复制，链接还能直接打开。' },
      { keys: ['⌥', 'Space'], title: '一个搜索框，什么都能做', body: '搜应用、算算式、/tr 翻译、-ai 提问、/ex 解释，或者一键交给 ChatGPT、Perplexity、Google。' },
      { keys: ['⌘', '⇧', 'I'], title: '写中文，发外文', body: '在输入框里按一下，写好中文回车，就换成译文并放进剪贴板。' },
      { keys: ['⌥', 'V'], title: '剪贴板，一直都在', body: '复制过的文字、链接、代码、图片和文件都留在历史里，搜一下就能再粘贴。' },
    ],
    places: {
      title: '不止浏览器，任何应用里都能用。',
      lead: 'popMind 是系统级的工具，不是某个网页上的插件：只要能选中文字，它就能出现。',
      apps: ['浏览器', 'PDF 阅读器', '终端', 'VS Code', '微信', '飞书 / Slack', '邮件', '备忘录'],
      more: '以及任何能选中文字的应用',
    },
    personasTitle: '为每天要读外文、用 AI 的人而做。',
    personas: [
      {
        key: 'dev',
        tag: '开发者',
        title: '文档、报错、AI 编程助手的回复，读起来不再卡。',
        lead: '英文文档、GitHub issue、终端里 Claude Code 这类工具的长篇输出，选中就有译文，格式原样保留。',
        points: [
          { title: '终端输出也能翻', body: '线条画的表格还原成真正的表格，Markdown 的标题、列表、代码不走样。' },
          { title: '报错直接问', body: '选中报错点“解释”，或在搜索框输入 /ex，AI 结合上下文讲清原因，可以一直追问。' },
          { title: '代码片段不丢', body: '复制过的命令、配置和代码都在剪贴板历史里，按类型筛一下就找到。' },
        ],
        shot: 'translate',
        alt: 'popMind 翻译一段从终端复制的回复，表格被还原成真正的表格',
      },
      {
        key: 'study',
        tag: '学生与科研',
        title: '读论文、查术语，读到哪问到哪。',
        lead: '在 PDF 阅读器、浏览器里划词，单词查释义，术语让 AI 讲明白，看不懂就接着问。',
        points: [
          { title: '查单词像查词典', body: '选中一个单词，给出音标、词性和释义，点一下就朗读。' },
          { title: 'AI 结合上下文解释', body: '可选附上所读窗口的截图，回答更贴合原文；接入联网搜索后带上参考来源。' },
          { title: '长段落整段翻', body: 'Google、DeepL、Bing、有道和你的 AI 模型随时切换，一个失败自动换下一个。' },
        ],
        shot: 'explain',
        alt: 'popMind 的 AI 解释窗口：解释一个术语，带代码块、参考来源和窗口截图',
      },
      {
        key: 'global',
        tag: '跨境与海外协作',
        title: '看懂外文消息，用中文写回去。',
        lead: '在微信、飞书、Slack、邮件里收到外文，选中就懂；回复时用中文写，⌘⇧I 一键换成外文。',
        points: [
          { title: '输入翻译', body: '光标旁弹出输入框，写好中文回车，译文替换原文并放进剪贴板，直接发送。' },
          { title: '目标语言随你选', body: '英语、日语、韩语等常用语言，引擎和语言会记住，下次不用再选。' },
          { title: '划词即懂', body: '收到的外文选中就翻，不用复制到网页翻译再切回来。' },
        ],
        shot: 'input',
        example: { from: '周五前我会把修复后的版本发给你，麻烦帮忙再测一下，有问题随时告诉我。', to: "I'll send you the fixed version by Friday. Could you test it again? Let me know if anything comes up." },
        alt: 'popMind 的输入翻译框：写好一段中文，目标语言为英语',
      },
      {
        key: 'create',
        tag: '内容创作者',
        title: '海外资讯读得快，素材收得住。',
        lead: '读推文、资讯和报告时，选中就能翻译、解释，想深挖就交给 Perplexity 或 ChatGPT；看到好内容随手存进剪贴板分组。',
        points: [
          { title: '一键交给外部 AI', body: '在搜索框把问题带进 ChatGPT、Grok、Perplexity 或 Google 搜索。' },
          { title: 'Pinboard 收集素材', body: '常用的文字、链接和图片收进自己的分组，不会被新内容挤掉。' },
          { title: '跨 Mac 同步', body: '可选：用你自己的 Cloudflare R2 存储桶，在几台 Mac 之间同步剪贴板历史。' },
        ],
        shot: 'clipboard',
        alt: 'popMind 的剪贴板历史：一排卡片，显示文字、链接、代码、颜色和文件',
      },
    ],
    privacy: {
      title: '安心用，数据在你手里。',
      lead: '你读的内容、写的内容和你的 API Key，都不经过我们的服务器。',
      items: [
        { title: '开源，代码可查', body: `全部源代码公开在 GitHub（${LICENSE}），每一行都可以自己检查。` },
        { title: '数据存在本机', body: '设置、剪贴板历史和 API Key 都保存在你的 Mac 上。' },
        { title: '直连你选的服务商', body: '划词内容只发给你选择的翻译引擎或 AI 服务商，不经过中转。' },
        { title: '更新有签名', body: '应用内更新会先校验签名，只安装 popMind 自己签名的版本。' },
      ],
    },
    models: {
      title: '用你自己的 Key，接你喜欢的模型。',
      lead: 'API Key 保存在本机，请求直接发给你选的服务商。',
      groups: [
        { name: 'AI 模型', items: ['OpenAI', 'Anthropic', 'Google Gemini', 'Kimi', 'DeepSeek', '自定义中转站', '本地 Gemma'] },
        { name: '翻译引擎', items: ['Google', 'DeepL', 'Bing', '有道', 'AI 翻译'] },
        { name: '联网搜索', items: ['Tavily', 'Serper', 'Brave', 'Jina'] },
      ],
    },
    facts: {
      title: '原生、轻巧、在本机。',
      items: [
        { value: DOWNLOAD_SIZE, label: '安装包大小' },
        { value: '原生', label: 'Go 编写的原生应用，不是网页套壳' },
        { value: '6', label: '个翻译引擎可选' },
        { value: '2', label: '种界面语言：简体中文、English' },
      ],
    },
    specs: {
      title: '规格与快捷键',
      lead: '版本号、系统要求和默认快捷键都直接取自应用本身。',
      specsCaption: '规格一览',
      specs: [
        ['当前版本', VERSION],
        ['系统要求', `macOS ${MIN_MACOS} 及以上，Apple 芯片（M 系列）`],
        ['安装包', `${DOWNLOAD_SIZE}，DMG 拖拽安装`],
        ['价格与许可证', `免费，开源（${LICENSE}）`],
        ['界面语言', '简体中文、English'],
        ['翻译引擎', 'Google、DeepL、Bing、有道、AI 翻译、本地 Gemma'],
        ['AI 服务商', 'OpenAI、Anthropic、Google Gemini、Kimi、DeepSeek、自定义中转站'],
        ['联网搜索', 'Tavily、Serper、Brave、Jina'],
        ['更新方式', '应用内更新，安装前校验签名'],
        ['数据存储', '设置、剪贴板历史和 API Key 都保存在本机'],
      ] as [string, string][],
      keysCaption: '默认快捷键（可在 设置 → 快捷键 里修改）',
      keysHead: ['操作', '快捷键'],
      keys: [
        ['打开 / 关闭搜索框', SHORTCUTS.toggleHome],
        ['打开剪贴板历史', SHORTCUTS.clipboardHistory],
        ['输入翻译', SHORTCUTS.inputTranslation],
        ['关闭划词气泡和浮窗', SHORTCUTS.hideBubble],
      ] as [string, string[]][],
    },
    faqTitle: '常见问题',
    faq: [
      { q: '为什么需要“辅助功能”权限？', a: '用来读取你选中的文字、在光标旁弹出气泡，以及把剪贴板内容粘贴回原来的应用。没有授权时，搜索框顶部会提示去开启。' },
      { q: '需要“屏幕录制”权限吗？', a: '不需要。它只用于“截图辅助解释”这个可选功能；不开启时会自动跳过截图，不会弹窗打扰。' },
      { q: '打开时提示“无法验证开发者”怎么办？', a: 'popMind 还没有经过 Apple 公证。打开 系统设置 → 隐私与安全性，点“仍要打开”即可，只需一次。安装引导里有详细步骤。' },
      { q: '要付费吗？', a: 'popMind 免费、开源。AI 解释和 AI 翻译用的是你自己的 API Key，按服务商的价格计费；Google、Bing 等翻译引擎可以直接用。' },
      { q: '我的数据会被上传吗？', a: '设置、剪贴板历史和 API Key 都保存在本机。划词内容只发给你选择的翻译引擎或 AI 服务商；剪贴板同步只在你配置了自己的 R2 存储桶后才会进行。' },
      { q: '怎么更新？', a: 'popMind 每天检查一次 GitHub Releases，有新版本时展示更新内容，你点安装后在应用内完成更新并重启。也可以在菜单栏随时点“检查更新”。更新包带签名，只安装 popMind 自己签名的版本。' },
      { q: '和浏览器翻译插件有什么不同？', a: 'popMind 是系统级的，在终端、PDF 阅读器、微信、邮件等任何应用里都能划词，还有搜索框、输入翻译和剪贴板历史。浏览器插件擅长整页双语对照、视频字幕这类网页内的翻译，popMind 不做这些。两者可以一起用。' },
      { q: '支持 Intel 芯片的 Mac 吗？', a: '目前只提供 Apple 芯片（M 系列）版本。' },
    ],
    cta: { title: '划一下，就知道了。', lead: '免费下载，几秒装好，用你自己的 AI。', button: '下载 popMind' },
    footer: { tagline: 'popMind —— 选中文本，AI 即刻响应。', github: 'GitHub', feedback: '反馈问题', releases: '更新日志', by: '作者' },
    guide: {
      title: '安装引导',
      lead: 'popMind 不在 App Store 上架，第一次打开时 macOS 会多问一句。按下面几步走，几分钟就能用上。',
      steps: [
        { title: '下载并拖进“应用程序”', body: '下载 DMG 后打开，把 popMind 拖到右边的“应用程序”文件夹。', image: true },
        { title: '第一次打开：允许运行', body: 'macOS 会提示“无法验证开发者”，先点“完成”。然后打开 系统设置 → 隐私与安全性，在“安全性”下找到 popMind 的提示，点“仍要打开”，再确认一次。只需要做一次。' },
        { title: '授予“辅助功能”权限', body: 'popMind 打开后会播放一段开场动画，然后弹出搜索框。顶部的卡片会引导你去 系统设置 → 隐私与安全性 → 辅助功能，打开 popMind 的开关。授权后自动生效，不用重启。' },
        { title: '配置 AI（可选）', body: '在设置 → AI 里填入 API Key，就能用 AI 解释和 AI 翻译。只用 Google、Bing 翻译的话，这一步可以跳过。' },
        { title: '以后的更新', body: '新版本会在应用内提示，点“安装更新”即可，不会再弹安全提示。' },
      ],
      back: '返回首页',
      download: '下载 popMind',
      dmgAlt: 'popMind 的安装窗口：左边是 popMind，右边是“应用程序”文件夹，中间有一个箭头',
    },
  },
  en: {
    nav: { how: 'Use cases', features: 'How to use', models: 'Models', faq: 'FAQ', guide: 'Install guide', download: 'Download', other: '中文' },
    hero: {
      eyebrow: 'Select-to-translate and AI for all of macOS',
      title: 'Select text. AI responds.',
      lead: 'Browser, PDF, terminal, chat: select text in any app and popMind appears beside it to translate, explain, ask, copy or hand off to an AI tool, in one step. No switching apps, no breaking your reading.',
      download: 'Download for macOS',
      how: 'See it in your work',
      note: `Free and open source · macOS ${MIN_MACOS} or later · Apple silicon`,
    },
    demo: {
      app: 'Reader',
      text: 'Retrieval-augmented generation grounds a model in your own documents, so its answers cite',
      picked: 'sources you can check',
      after: 'instead of guessing.',
      tip: 'Translate',
      engine: 'Google',
      result: '你可以核实的来源',
      from: 'Detect',
      to: 'Simplified Chinese',
      speak: 'Speak',
      copy: 'Copy',
    },
    howTitle: 'Four ways in, all at hand.',
    how: [
      { keys: ['Select'], title: 'Select, and it is there', body: 'Select text in any app and a row of actions appears by the pointer: translate, explain, ask, copy, or open a link.' },
      { keys: ['⌥', 'Space'], title: 'One box for everything', body: 'Find apps, do math, /tr to translate, -ai to ask, /ex to explain, or hand off to ChatGPT, Perplexity or Google.' },
      { keys: ['⌘', '⇧', 'I'], title: 'Write in yours, send in theirs', body: 'Press it in any text field, write in your language, press Return: the translation replaces it and goes on the clipboard.' },
      { keys: ['⌥', 'V'], title: 'A clipboard that remembers', body: 'Text, links, code, images and files you copied stay in the history, a search away from pasting again.' },
    ],
    places: {
      title: 'Not just the browser. Every app.',
      lead: 'popMind works across macOS, not inside one web page: wherever you can select text, it appears.',
      apps: ['Browsers', 'PDF readers', 'Terminal', 'VS Code', 'WeChat', 'Slack', 'Mail', 'Notes'],
      more: 'and any app where you can select text',
    },
    personasTitle: 'Made for people who read in other languages and work with AI.',
    personas: [
      {
        key: 'dev',
        tag: 'Developers',
        title: 'Docs, errors and AI agents\' replies, read without stalling.',
        lead: 'English docs, GitHub issues, and the long output of tools like Claude Code in your terminal: select it for a translation that keeps its formatting.',
        points: [
          { title: 'Terminal output too', body: 'Tables drawn with lines come back as real tables; Markdown headings, lists and code keep their shape.' },
          { title: 'Ask about errors', body: 'Select an error and click Explain, or type /ex in the launcher: AI explains it in context, and you keep asking.' },
          { title: 'Snippets kept', body: 'Commands, configs and code you copied stay in the clipboard history, a filter away.' },
        ],
        shot: 'translate',
        alt: 'popMind translating a reply copied from a terminal, its table rebuilt as a real table',
      },
      {
        key: 'study',
        tag: 'Students and researchers',
        title: 'Read papers, look up terms, ask as you go.',
        lead: 'Select in your PDF reader or browser: words get dictionary entries, terms get explained by AI, and you can keep asking.',
        points: [
          { title: 'A dictionary for words', body: 'Select a single word for its phonetics, parts of speech and meanings, read aloud with a click.' },
          { title: 'AI that sees the context', body: 'Optionally sends a picture of the window you read, so answers fit the text; with web search, answers cite their sources.' },
          { title: 'Whole paragraphs', body: 'Switch between Google, DeepL, Bing, Youdao and your AI model; when one fails, the next takes over.' },
        ],
        shot: 'explain',
        alt: 'popMind explaining a term, with a code block, sources and the window picture',
      },
      {
        key: 'global',
        tag: 'Working across borders',
        title: 'Understand their messages. Reply in your language.',
        lead: 'In WeChat, Slack or Mail, select a message to understand it; to reply, write in your language and press ⌘⇧I.',
        points: [
          { title: 'Input translation', body: 'A box opens by the pointer; write, press Return, and the translation replaces your text and goes on the clipboard, ready to send.' },
          { title: 'Your target language', body: 'English, Japanese, Korean and more; the engine and language are remembered for next time.' },
          { title: 'Select to understand', body: 'Translate what you receive in place, without copying it to a website and back.' },
        ],
        shot: 'input',
        example: { from: '周五前我会把修复后的版本发给你，麻烦帮忙再测一下，有问题随时告诉我。', to: "I'll send you the fixed version by Friday. Could you test it again? Let me know if anything comes up." },
        alt: 'The popMind input translation box: a paragraph in Chinese, to English',
      },
      {
        key: 'create',
        tag: 'Content creators',
        title: 'Read the world fast. Keep what you find.',
        lead: 'Translate or explain posts, news and reports as you read, hand a question to Perplexity or ChatGPT to dig in, and keep the good parts in clipboard boards.',
        points: [
          { title: 'Hand off to AI tools', body: 'From the launcher, take your question to ChatGPT, Grok, Perplexity or Google search.' },
          { title: 'Pinboards', body: 'Keep text, links and images you reuse in boards of your own, out of the way of what is new.' },
          { title: 'Sync across Macs', body: 'Optional: sync the clipboard history through your own Cloudflare R2 bucket.' },
        ],
        shot: 'clipboard',
        alt: 'The popMind clipboard history: cards of text, links, code, a color and files',
      },
    ],
    privacy: {
      title: 'Your text stays yours.',
      lead: 'What you read, what you write and your API keys never pass through our servers.',
      items: [
        { title: 'Open source', body: `All of the code is on GitHub (${LICENSE}), for anyone to check.` },
        { title: 'Kept on your Mac', body: 'Settings, clipboard history and API keys stay on your Mac.' },
        { title: 'Straight to your provider', body: 'Selected text goes only to the engine or AI provider you chose, with no relay of ours.' },
        { title: 'Signed updates', body: 'Updates are checked before installing: popMind installs only versions signed with its key.' },
      ],
    },
    models: {
      title: 'Your keys, your models.',
      lead: 'API keys stay on your Mac; requests go straight to the provider you chose.',
      groups: [
        { name: 'AI models', items: ['OpenAI', 'Anthropic', 'Google Gemini', 'Kimi', 'DeepSeek', 'Custom relays', 'Local Gemma'] },
        { name: 'Translation', items: ['Google', 'DeepL', 'Bing', 'Youdao', 'AI translation'] },
        { name: 'Web search', items: ['Tavily', 'Serper', 'Brave', 'Jina'] },
      ],
    },
    facts: {
      title: 'Native, light, on your Mac.',
      items: [
        { value: DOWNLOAD_SIZE, label: 'to download' },
        { value: 'Native', label: 'written in Go, not a web page in a box' },
        { value: '6', label: 'translation engines to choose from' },
        { value: '2', label: 'languages: English, 简体中文' },
      ],
    },
    specs: {
      title: 'Specs and shortcuts',
      lead: 'The version, the requirements and the default shortcuts come straight from the app.',
      specsCaption: 'Specs',
      specs: [
        ['Version', VERSION],
        ['Requires', `macOS ${MIN_MACOS} or later, Apple silicon (M-series)`],
        ['Download', `${DOWNLOAD_SIZE} disk image, drag to install`],
        ['Price and license', `Free and open source (${LICENSE})`],
        ['Languages', 'English, Simplified Chinese'],
        ['Translation engines', 'Google, DeepL, Bing, Youdao, AI translation, local Gemma'],
        ['AI providers', 'OpenAI, Anthropic, Google Gemini, Kimi, DeepSeek, custom relays'],
        ['Web search', 'Tavily, Serper, Brave, Jina'],
        ['Updates', 'In the app, signature checked before installing'],
        ['Data', 'Settings, clipboard history and API keys stay on your Mac'],
      ] as [string, string][],
      keysCaption: 'Default shortcuts (change them in Settings → Shortcuts)',
      keysHead: ['Action', 'Shortcut'],
      keys: [
        ['Open or close the launcher', SHORTCUTS.toggleHome],
        ['Open the clipboard history', SHORTCUTS.clipboardHistory],
        ['Input translation', SHORTCUTS.inputTranslation],
        ['Close the bubble and floating windows', SHORTCUTS.hideBubble],
      ] as [string, string[]][],
    },
    faqTitle: 'Questions',
    faq: [
      { q: 'Why does popMind need Accessibility?', a: 'To read the text you select, show the bubble by the pointer, and paste clipboard items back into your app. Until it is granted, the launcher shows how to turn it on.' },
      { q: 'Is Screen Recording required?', a: 'No. It is only used by the optional picture of the window for explanations; without it, popMind skips the picture without asking.' },
      { q: 'macOS says it cannot verify popMind. What now?', a: 'popMind is not notarized by Apple yet. Open System Settings → Privacy & Security and click Open Anyway, once. The install guide shows each step.' },
      { q: 'Does it cost anything?', a: 'popMind is free and open source. AI explanations and AI translation use your own API key, at the provider\'s prices; Google, Bing and the other engines work as they are.' },
      { q: 'Is my data uploaded?', a: 'Settings, clipboard history and API keys stay on your Mac. Selected text goes only to the engine or AI provider you chose; clipboard sync happens only with an R2 bucket of your own.' },
      { q: 'How does popMind update?', a: 'It checks GitHub Releases once a day, shows what is new, and installs the update in the app when you agree, then restarts. Check any time from the menu bar. Updates are signed, and popMind installs only those signed with its key.' },
      { q: 'How is it different from a browser translation extension?', a: 'popMind works across macOS: select text in a terminal, a PDF reader, chat or mail, and it has a launcher, input translation and a clipboard history. Browser extensions do well at in-page work such as side-by-side translation of whole pages and video subtitles, which popMind does not do. They work well together.' },
      { q: 'Does it run on Intel Macs?', a: 'For now, only Apple silicon (M-series) Macs.' },
    ],
    cta: { title: 'Select something. See for yourself.', lead: 'Free to download, ready in seconds, with the AI you already use.', button: 'Download popMind' },
    footer: { tagline: 'popMind — select text, AI responds.', github: 'GitHub', feedback: 'Feedback', releases: 'Changelog', by: 'By' },
    guide: {
      title: 'Install guide',
      lead: 'popMind is not on the App Store, so macOS asks once more the first time it opens. These steps take a few minutes.',
      steps: [
        { title: 'Download and drag to Applications', body: 'Open the disk image and drag popMind onto the Applications folder beside it.', image: true },
        { title: 'First launch: allow it to run', body: 'macOS says it cannot verify the developer; click Done. Then open System Settings → Privacy & Security, find popMind under Security, click Open Anyway, and confirm. Only once.' },
        { title: 'Grant Accessibility', body: 'popMind plays its intro, then opens the launcher. The card at its top takes you to System Settings → Privacy & Security → Accessibility; switch popMind on. It works at once, no restart.' },
        { title: 'Set up AI (optional)', body: 'Add an API key in Settings → AI for AI explanations and translation. With Google or Bing translation only, skip this.' },
        { title: 'Later updates', body: 'New versions are offered in the app: click Install Update, with no more security prompts.' },
      ],
      back: 'Back to home',
      download: 'Download popMind',
      dmgAlt: 'The popMind installer: popMind on the left, the Applications folder on the right, an arrow between',
    },
  },
} as const;

export type Content = (typeof content)['zh'] | (typeof content)['en'];
