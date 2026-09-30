// DEV ONLY: fake clipboard data for previewing the panel in a normal browser (`/clipboard-panel.html?mock`).
// Imported through a dynamic import inside an `import.meta.env.DEV` branch, so it never reaches production bundles.
import type { ClipListItem, ClipSourceApp, Pinboard } from '@/lib/clipboard/types'

export type MockExtras = {
  plainText?: string
  html?: string
  ocrText?: string
  filePaths?: string[]
  tags?: string[]
  imageUrl?: string
  /** Fake Finder icon for the preview (other file items exercise the generic fallback). */
  fileIcon?: 'folder' | 'doc'
}

export type MockItem = { item: ClipListItem; extras: MockExtras }

const svgUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

const appIcon = (letter: string, from: string, to: string) =>
  svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#g)"/><text x="32" y="43" text-anchor="middle" font-family="-apple-system,Helvetica" font-size="32" font-weight="700" fill="#fff">${letter}</text></svg>`
  )

export const mockApps: Record<string, ClipSourceApp> = {
  wechat: {
    bundleId: 'com.tencent.xinWeChat',
    name: '微信',
    color: '#07c160',
    iconUrl: appIcon('微', '#2fdc7c', '#07a94f'),
  },
  chrome: {
    bundleId: 'com.google.Chrome',
    name: 'Chrome',
    color: '#4285f4',
    iconUrl: appIcon('C', '#ea4335', '#4285f4'),
  },
  safari: {
    bundleId: 'com.apple.Safari',
    name: 'Safari',
    color: '#1e88f7',
    iconUrl: appIcon('S', '#4fc3ff', '#1565d8'),
  },
  xcode: {
    bundleId: 'com.apple.dt.Xcode',
    name: 'Xcode',
    color: '#1c7ef2',
    iconUrl: appIcon('X', '#3aa0ff', '#1249b5'),
  },
  vscode: {
    bundleId: 'com.microsoft.VSCode',
    name: 'VS Code',
    color: '#23a9f2',
    iconUrl: appIcon('V', '#3fbcff', '#0b6fb8'),
  },
  figma: {
    bundleId: 'com.figma.Desktop',
    name: 'Figma',
    color: '#a259ff',
    iconUrl: appIcon('F', '#c084ff', '#7c3aed'),
  },
  notes: {
    bundleId: 'com.apple.Notes',
    name: '备忘录',
    color: '#f5c518',
    iconUrl: appIcon('N', '#ffe066', '#f5a300'),
  },
  slack: {
    bundleId: 'com.tinyspeck.slackmacgap',
    name: 'Slack',
    color: '#4a154b',
    iconUrl: appIcon('S', '#7b2d80', '#36103a'),
  },
  terminal: {
    bundleId: 'com.apple.Terminal',
    name: '终端',
    color: '#2b2b2e',
    iconUrl: appIcon('>', '#4a4a4f', '#111113'),
  },
  finder: { bundleId: 'com.apple.finder', name: 'Finder', color: '#3b9cf5' },
  // No color and no icon: exercises the neutral fallback.
  unknown: { bundleId: 'org.example.tool', name: 'Scratch Tool' },
}

export const mockPinboards: Pinboard[] = [
  { id: 'pb-work', name: '工作', color: 'blue', sortOrder: 0, itemCount: 0 },
  { id: 'pb-code', name: '代码片段', color: 'green', sortOrder: 1, itemCount: 0 },
  { id: 'pb-idea', name: '灵感', color: 'purple', sortOrder: 2, itemCount: 0 },
]

// ---- images ----

const bars = (w: number, h: number, hue: number) => {
  const values = [0.35, 0.6, 0.45, 0.8, 0.55, 0.9, 0.7]
  const bw = w / (values.length * 1.6)
  const rects = values
    .map((value, index) => {
      const bh = value * h * 0.6
      return `<rect x="${w * 0.1 + index * bw * 1.6}" y="${h * 0.85 - bh}" width="${bw}" height="${bh}" rx="4" fill="hsl(${hue + index * 8} 80% 60%)"/>`
    })
    .join('')
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="hsl(${hue} 40% 96%)"/><text x="${w * 0.1}" y="${h * 0.14}" font-family="Helvetica" font-size="${h * 0.07}" font-weight="700" fill="hsl(${hue} 30% 25%)">Weekly revenue</text>${rects}</svg>`
  )
}

const codeShot = (w: number, h: number) => {
  const lines = [
    ['#c678dd', 'const', '#e5c07b', ' panel', '#abb2bf', ' = ', '#61afef', 'createPanel', '#abb2bf', '()'],
    [
      '#c678dd',
      'await',
      '#abb2bf',
      ' panel.',
      '#61afef',
      'show',
      '#abb2bf',
      '({ animate: ',
      '#d19a66',
      'true',
      '#abb2bf',
      ' })',
    ],
    ['#7f848e', '// keyboard first, like Paste'],
    ['#c678dd', 'export default', '#e5c07b', ' panel'],
  ]
  const text = lines
    .map((parts, row) => {
      let x = 24
      const spans: string[] = []

      for (let i = 0; i < parts.length; i += 2) {
        const color = parts[i]
        const value = parts[i + 1] ?? ''
        spans.push(`<tspan x="${x}" fill="${color}">${value.replace(/ /g, '&#160;')}</tspan>`)
        x += value.length * 9.6
      }

      return `<text y="${64 + row * 30}" font-family="Menlo,monospace" font-size="16">${spans.join('')}</text>`
    })
    .join('')
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#282c34"/><circle cx="20" cy="20" r="6" fill="#ff5f57"/><circle cx="40" cy="20" r="6" fill="#febc2e"/><circle cx="60" cy="20" r="6" fill="#28c840"/>${text}</svg>`
  )
}

const invoiceShot = (w: number, h: number) =>
  svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fffdf5"/><rect x="16" y="16" width="${w - 32}" height="${h - 32}" fill="none" stroke="#d9c9a3" stroke-width="2"/><text x="${w / 2}" y="60" text-anchor="middle" font-family="PingFang SC,Helvetica" font-size="26" font-weight="700" fill="#8a5a00">电子发票</text><text x="40" y="110" font-family="PingFang SC,Helvetica" font-size="17" fill="#333">发票号码：0231 8842 1907</text><text x="40" y="145" font-family="PingFang SC,Helvetica" font-size="17" fill="#333">购买方：上海某某科技有限公司</text><text x="40" y="180" font-family="PingFang SC,Helvetica" font-size="17" fill="#333">价税合计：¥1,280.00</text></svg>`
  )

const photo = (w: number, h: number, hue: number) =>
  svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 80% 70%)"/><stop offset="1" stop-color="hsl(${hue + 40} 85% 55%)"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#s)"/><circle cx="${w * 0.72}" cy="${h * 0.3}" r="${h * 0.14}" fill="#fff" opacity="0.85"/><path d="M0 ${h} L${w * 0.3} ${h * 0.55} L${w * 0.5} ${h * 0.8} L${w * 0.72} ${h * 0.5} L${w} ${h * 0.85} L${w} ${h} Z" fill="hsl(${hue + 200} 40% 22%)" opacity="0.85"/></svg>`
  )

const uiShot = (w: number, h: number) =>
  svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#f2f2f7"/><rect x="24" y="24" width="${w * 0.42}" height="${h - 48}" rx="14" fill="#fff"/><rect x="${w * 0.42 + 44}" y="24" width="${w * 0.5}" height="${h * 0.4}" rx="14" fill="#0a84ff"/><rect x="${w * 0.42 + 44}" y="${h * 0.4 + 44}" width="${w * 0.5}" height="${h * 0.4}" rx="14" fill="#fff"/><rect x="44" y="52" width="${w * 0.26}" height="12" rx="6" fill="#d1d1d6"/><rect x="44" y="80" width="${w * 0.32}" height="12" rx="6" fill="#e5e5ea"/><rect x="44" y="108" width="${w * 0.2}" height="12" rx="6" fill="#e5e5ea"/></svg>`
  )

export const fileIconSvg = (kind: 'folder' | 'doc') =>
  svgUrl(
    kind === 'folder'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="M10 34a10 10 0 0 1 10-10h27l12 12h49a10 10 0 0 1 10 10v58a10 10 0 0 1-10 10H20a10 10 0 0 1-10-10z" fill="#5ab8f5"/><path d="M10 48a10 10 0 0 1 10-10h88a10 10 0 0 1 10 10v50a10 10 0 0 1-10 10H20a10 10 0 0 1-10-10z" fill="#39a0ee"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="M28 8h48l28 28v76a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8z" fill="#f4f4f6" stroke="#c8c8ce" stroke-width="3"/><path d="M76 8l28 28H84a8 8 0 0 1-8-8z" fill="#d6d6dc"/><rect x="34" y="60" width="52" height="6" rx="3" fill="#e0533d"/><rect x="34" y="76" width="52" height="6" rx="3" fill="#cfcfd6"/><rect x="34" y="92" width="36" height="6" rx="3" fill="#cfcfd6"/></svg>'
  )

// ---- items ----

const NOW = Date.now()
const MINUTE = 60_000
let sequence = 0

const items: MockItem[] = []

type Draft = {
  kind: ClipListItem['kind']
  previewText: string
  app: keyof typeof mockApps
  minutesAgo: number
  subKind?: ClipListItem['subKind']
  isRich?: boolean
  customTitle?: string
  title?: string
  url?: string
  colorValue?: string
  fileNames?: string[]
  fileCount?: number
  imageWidth?: number
  imageHeight?: number
  byteSize?: number
  thumbnailUrl?: string
  pinboardIds?: string[]
  hasOcrText?: boolean
  isRemote?: boolean
  extras?: MockExtras
}

const add = (draft: Draft) => {
  sequence += 1
  const at = NOW - draft.minutesAgo * MINUTE
  const text = draft.previewText
  const item: ClipListItem = {
    id: `mock-${sequence}`,
    kind: draft.kind,
    subKind: draft.subKind,
    isRich: Boolean(draft.isRich),
    title: draft.customTitle ?? draft.title ?? (text.split('\n')[0] || 'Untitled').slice(0, 48),
    customTitle: draft.customTitle,
    previewText: text,
    url: draft.url,
    colorValue: draft.colorValue,
    fileCount: draft.fileCount ?? draft.fileNames?.length ?? 0,
    fileNames: draft.fileNames,
    imageWidth: draft.imageWidth,
    imageHeight: draft.imageHeight,
    byteSize: draft.byteSize ?? new TextEncoder().encode(text).length,
    charCount: text.length,
    source: mockApps[draft.app],
    isRemote: Boolean(draft.isRemote),
    createdAt: at - 30 * MINUTE,
    lastCopiedAt: at,
    copyCount: 1 + (sequence % 4),
    useCount: sequence % 3,
    pinboardIds: draft.pinboardIds ?? [],
    hasOcrText: Boolean(draft.hasOcrText),
    thumbnailUrl: draft.thumbnailUrl,
  }

  items.push({ item, extras: draft.extras ?? {} })
}

const longText = `明天下午三点在 A 座 302 会议室开会，记得带上合同原件和公章。\n议程：\n1. 上季度回顾\n2. 新方案评审\n3. 预算确认\n会后请把纪要发给所有参会人。`

add({ kind: 'text', app: 'wechat', minutesAgo: 0.3, previewText: longText, pinboardIds: ['pb-work'] })
add({
  kind: 'link',
  app: 'chrome',
  minutesAgo: 2,
  previewText: 'https://github.com/electron/electron/releases',
  url: 'https://github.com/electron/electron/releases',
  title: 'Releases · electron/electron',
  extras: { plainText: 'https://github.com/electron/electron/releases' },
})
add({
  kind: 'image',
  app: 'figma',
  minutesAgo: 4,
  previewText: 'Weekly revenue',
  title: 'Weekly revenue chart',
  imageWidth: 1920,
  imageHeight: 1200,
  byteSize: 482_113,
  thumbnailUrl: bars(480, 300, 210),
  extras: { imageUrl: bars(1200, 750, 210) },
})
add({
  kind: 'color',
  app: 'figma',
  minutesAgo: 6,
  previewText: '#3A7BFF',
  colorValue: '#3A7BFF',
})
add({
  kind: 'file',
  app: 'finder',
  minutesAgo: 9,
  previewText: '合同-终稿.pdf',
  fileNames: ['合同-终稿.pdf', '报价单.xlsx', '现场照片.png'],
  byteSize: 4_812_331,
  extras: {
    filePaths: [
      '/Users/demo/Documents/合同-终稿.pdf',
      '/Users/demo/Documents/报价单.xlsx',
      '/Users/demo/Pictures/现场照片.png',
    ],
    fileIcon: 'doc',
  },
})
add({
  kind: 'text',
  subKind: 'code',
  app: 'vscode',
  minutesAgo: 12,
  previewText: `export async function paste(ids: string[]) {\n  const items = await store.get(ids)\n  await writer.write(items)\n  return pasteService.send()\n}`,
  pinboardIds: ['pb-code'],
})
add({
  kind: 'text',
  subKind: 'json',
  app: 'terminal',
  minutesAgo: 15,
  previewText: `{\n  "name": "popmind",\n  "version": "0.3.0",\n  "features": ["clipboard", "translate"]\n}`,
  pinboardIds: ['pb-code'],
})
add({
  kind: 'image',
  app: 'safari',
  minutesAgo: 18,
  previewText: '发票',
  title: '发票截图',
  imageWidth: 960,
  imageHeight: 600,
  byteSize: 221_450,
  hasOcrText: true,
  thumbnailUrl: invoiceShot(480, 300),
  extras: {
    imageUrl: invoiceShot(960, 600),
    ocrText: '电子发票\n发票号码：0231 8842 1907\n购买方：上海某某科技有限公司\n价税合计：¥1,280.00',
  },
})
add({
  kind: 'link',
  app: 'safari',
  minutesAgo: 25,
  previewText: 'https://developer.apple.com/documentation/appkit/nswindow',
  url: 'https://developer.apple.com/documentation/appkit/nswindow',
  title: 'NSWindow | Apple Developer Documentation',
})
add({
  kind: 'text',
  isRich: true,
  app: 'notes',
  minutesAgo: 31,
  previewText: '购物清单：牛奶、鸡蛋、面包、咖啡豆、橄榄油',
  pinboardIds: ['pb-idea'],
  extras: {
    plainText: '购物清单：牛奶、鸡蛋、面包、咖啡豆、橄榄油',
    html: '<h3 style="color:#c2410c">购物清单</h3><ul><li><b>牛奶</b></li><li>鸡蛋</li><li><i>面包</i></li><li>咖啡豆</li><li>橄榄油</li></ul><p style="color:#666">周末前买齐</p><script>alert(1)</script>',
  },
})
add({ kind: 'color', app: 'figma', minutesAgo: 40, previewText: '#FF6B6B', colorValue: '#FF6B6B' })
add({
  kind: 'text',
  subKind: 'email',
  app: 'slack',
  minutesAgo: 47,
  previewText: 'zhang.wei@example.com',
})
add({
  kind: 'image',
  app: 'xcode',
  minutesAgo: 55,
  previewText: 'Code screenshot',
  title: 'Xcode 截图',
  imageWidth: 1440,
  imageHeight: 900,
  byteSize: 305_211,
  thumbnailUrl: codeShot(480, 300),
  extras: { imageUrl: codeShot(960, 600) },
})
add({
  kind: 'text',
  subKind: 'phone',
  app: 'wechat',
  minutesAgo: 62,
  previewText: '138 0013 8000',
  isRemote: true,
})
add({
  kind: 'file',
  app: 'finder',
  minutesAgo: 75,
  previewText: 'screenshot-2026-09-28.png',
  fileNames: ['screenshot-2026-09-28.png'],
  byteSize: 913_004,
  extras: { filePaths: ['/Users/demo/Desktop/screenshot-2026-09-28.png'] },
})
add({
  kind: 'file',
  app: 'finder',
  minutesAgo: 80,
  previewText: '设计资源',
  fileNames: ['设计资源'],
  byteSize: 0,
  extras: { filePaths: ['/Users/demo/Design/设计资源'], fileIcon: 'folder' },
})
add({
  kind: 'file',
  app: 'finder',
  minutesAgo: 85,
  previewText: 'Q3-2026-quarterly-business-review-final-v12-approved-by-legal.pptx',
  fileNames: ['Q3-2026-quarterly-business-review-final-v12-approved-by-legal.pptx'],
  byteSize: 8_402_113,
  extras: { filePaths: ['/Users/demo/Documents/Q3-2026-quarterly-business-review-final-v12-approved-by-legal.pptx'] },
})
add({
  kind: 'text',
  app: 'chrome',
  minutesAgo: 90,
  previewText:
    'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump!',
})
add({
  kind: 'text',
  subKind: 'markdown',
  app: 'notes',
  minutesAgo: 110,
  previewText: `# 周报\n\n- 完成剪贴板面板 UI\n- 修复输入法组词时回车误触发的问题\n- 下周：联调 + 验收`,
  customTitle: '本周周报',
  pinboardIds: ['pb-work'],
})
add({
  kind: 'image',
  app: 'safari',
  minutesAgo: 140,
  previewText: 'Mountains',
  title: 'Mountains.jpg',
  imageWidth: 3024,
  imageHeight: 4032,
  byteSize: 2_418_113,
  thumbnailUrl: photo(300, 480, 20),
  extras: { imageUrl: photo(600, 960, 20) },
})
add({ kind: 'color', app: 'unknown', minutesAgo: 170, previewText: '#10B981', colorValue: '#10B981' })
add({
  kind: 'link',
  app: 'chrome',
  minutesAgo: 210,
  previewText: 'https://www.pasteapp.io/help/keyboard-shortcuts',
  url: 'https://www.pasteapp.io/help/keyboard-shortcuts',
  title: 'Keyboard shortcuts – Paste Help',
})
add({
  kind: 'text',
  app: 'unknown',
  minutesAgo: 260,
  previewText: '这段内容来自一个没有图标和颜色的应用，用来检查中性色头部的显示效果。',
})
add({
  kind: 'text',
  subKind: 'path',
  app: 'terminal',
  minutesAgo: 320,
  previewText: '/Users/demo/code/personal/popMind/app/components/clipboard-panel',
})
add({ kind: 'text', subKind: 'number', app: 'wechat', minutesAgo: 380, previewText: '482915' })
add({
  kind: 'image',
  app: 'figma',
  minutesAgo: 460,
  previewText: 'UI mock',
  title: 'Dashboard mock',
  imageWidth: 1600,
  imageHeight: 1000,
  byteSize: 188_002,
  thumbnailUrl: uiShot(480, 300),
  extras: { imageUrl: uiShot(960, 600) },
})
add({
  kind: 'text',
  app: 'slack',
  minutesAgo: 600,
  previewText: `@channel 今晚 8 点服务器维护，预计持续 30 分钟。\n期间无法登录，请提前保存好手头的工作。`,
})
add({ kind: 'color', app: 'figma', minutesAgo: 700, previewText: '#F59E0B', colorValue: '#F59E0B' })
add({
  kind: 'file',
  app: 'finder',
  minutesAgo: 900,
  previewText: '设计稿.fig',
  fileNames: ['设计稿.fig', 'logo.svg', 'icon-16.png', 'icon-32.png', 'icon-64.png', 'icon-128.png'],
  byteSize: 21_400_003,
  extras: { filePaths: ['/Users/demo/Design/设计稿.fig', '/Users/demo/Design/logo.svg'] },
})
add({
  kind: 'link',
  app: 'safari',
  minutesAgo: 1300,
  previewText: 'https://juejin.cn/post/7301234567890',
  url: 'https://juejin.cn/post/7301234567890',
  title: 'Electron 中实现不抢焦点的浮层面板',
})
add({
  kind: 'text',
  subKind: 'code',
  app: 'xcode',
  minutesAgo: 1500,
  previewText: `func presentPanel(_ window: NSWindow) {\n    window.orderFrontRegardless()\n    window.makeKey()\n}`,
})
add({
  kind: 'text',
  app: 'notes',
  minutesAgo: 2000,
  previewText: '阅读清单：《设计心理学》《Refactoring UI》《The Pragmatic Programmer》',
  pinboardIds: ['pb-idea'],
})
add({ kind: 'text', app: 'wechat', minutesAgo: 2900, previewText: '好的，收到，我晚点回复你。' })
add({
  kind: 'image',
  app: 'chrome',
  minutesAgo: 4000,
  previewText: 'Sunset',
  title: 'Sunset.png',
  imageWidth: 2400,
  imageHeight: 1350,
  byteSize: 1_204_998,
  thumbnailUrl: photo(480, 300, 320),
  extras: { imageUrl: photo(960, 600, 320) },
})
add({ kind: 'color', app: 'figma', minutesAgo: 5200, previewText: '#6366F1', colorValue: '#6366F1' })
add({
  kind: 'text',
  app: 'chrome',
  minutesAgo: 7000,
  previewText: 'macOS 上的全局快捷键需要辅助功能权限才能模拟粘贴。',
})
add({
  kind: 'link',
  app: 'chrome',
  minutesAgo: 9000,
  previewText: 'https://ui.shadcn.com/docs/components/context-menu',
  url: 'https://ui.shadcn.com/docs/components/context-menu',
  title: 'Context Menu - shadcn/ui',
})
add({ kind: 'text', app: 'slack', minutesAgo: 12000, previewText: 'LGTM 👍' })
add({
  kind: 'text',
  app: 'notes',
  minutesAgo: 20000,
  previewText: '旧笔记：2025 年的年度计划草稿，包含学习、健身、旅行三部分。',
})

export const mockItems = items
