// DEV ONLY: installs a fake `window.conveyor` so the panel can be previewed in a browser.
// Open `/clipboard-panel.html?mock` (extra flags: `&ai`, `&noperm`, `&paused`, `&en`, `&stack`, `&q=text`).
import {
  defaultClipboardSettings,
  type ClipAiSearchResult,
  type ClipDetail,
  type ClipItemsChangedEvent,
  type ClipListItem,
  type ClipListResult,
  type ClipPanelShowEvent,
  type ClipPasteStackState,
  type ClipQuery,
  type ClipQueryToken,
  type ClipKind,
  type ParsedClipQuery,
  type Pinboard,
  type ClipDatePreset,
} from '@/lib/clipboard/types'
import { presetToRange } from '@/app/components/clipboard-panel/panel-utils'
import { mockApps, mockItems, mockPinboards, type MockItem } from '@/app/components/clipboard-panel/mock/mock-data'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const kindLabels: Record<string, string> = { text: '文本', link: '链接', image: '图片', file: '文件', color: '颜色' }
const typeWords: Record<string, ClipKind> = {
  图片: 'image',
  截图: 'image',
  链接: 'link',
  文件: 'file',
  颜色: 'color',
  文本: 'text',
}
const dateWords: Record<string, ClipDatePreset> = {
  今天: 'today',
  昨天: 'yesterday',
  本周: 'this_week',
  上周: 'last_week',
}
const dateLabels: Record<string, string> = { today: '今天', yesterday: '昨天', this_week: '本周', last_week: '上周' }

export function installMockConveyor() {
  const params = new URLSearchParams(location.search)
  const state = {
    items: mockItems.map((entry) => ({ item: { ...entry.item }, extras: entry.extras })) as MockItem[],
    pinboards: mockPinboards.map((pinboard) => ({ ...pinboard })) as Pinboard[],
    hidden: new Set<string>(),
    undo: new Map<string, string[]>(),
    stack: { active: params.has('stack'), items: [] } as ClipPasteStackState,
    settings: {
      appLanguage: params.has('en') ? 'en' : 'zh-CN',
      clipboard: {
        ...defaultClipboardSettings,
        pausedUntil: params.has('paused') ? -1 : 0,
        ai: { ...defaultClipboardSettings.ai, enabled: params.has('ai') },
      },
    },
  }
  const changedHandlers = new Set<(event: ClipItemsChangedEvent) => void>()
  const showHandlers = new Set<(event: ClipPanelShowEvent) => void>()
  const hideHandlers = new Set<() => void>()
  const stackHandlers = new Set<(stack: ClipPasteStackState) => void>()
  const capabilityHandlers = new Set<(settings: unknown) => void>()
  let idCounter = 1000

  const log = (name: string, ...args: unknown[]) => console.info(`[mock] ${name}`, ...args)
  const emitChanged = (reason: ClipItemsChangedEvent['reason'], ids: string[]) =>
    changedHandlers.forEach((handler) => handler({ reason, ids }))
  const emitStack = () => stackHandlers.forEach((handler) => handler(state.stack))

  const refreshPinboardCounts = () => {
    state.pinboards.forEach((pinboard) => {
      pinboard.itemCount = state.items.filter(
        (entry) => !state.hidden.has(entry.item.id) && entry.item.pinboardIds.includes(pinboard.id)
      ).length
    })
  }

  const visibleItems = () =>
    state.items
      .filter((entry) => !state.hidden.has(entry.item.id))
      .sort((left, right) => right.item.lastCopiedAt - left.item.lastCopiedAt)

  const highlight = (source: string, keywords: string[]) => {
    const lower = source.toLowerCase()
    const first = keywords.map((keyword) => lower.indexOf(keyword.toLowerCase())).filter((index) => index >= 0)

    if (first.length === 0) {
      return null
    }

    const start = Math.max(0, Math.min(...first) - 18)
    const prefix = start > 0 ? '…' : ''
    const snippet = prefix + source.slice(start, start + 110)
    const snippetLower = snippet.toLowerCase()
    const ranges: Array<[number, number]> = []

    keywords.forEach((keyword) => {
      const needle = keyword.toLowerCase()
      let index = snippetLower.indexOf(needle)

      while (index >= 0) {
        ranges.push([index, index + needle.length])
        index = snippetLower.indexOf(needle, index + needle.length)
      }
    })

    return { snippet, ranges }
  }

  const parseQuery = (text: string): ParsedClipQuery => {
    const tokens: ClipQueryToken[] = []
    const suggestions: ClipQueryToken[] = []
    let remaining = text

    const take = (
      pattern: RegExp,
      build: (match: RegExpMatchArray) => Omit<ClipQueryToken, 'start' | 'end'> | null
    ) => {
      for (const match of text.matchAll(pattern)) {
        const built = build(match)

        if (built && match.index !== undefined) {
          tokens.push({ ...built, start: match.index, end: match.index + match[0].length })
          remaining = remaining.replace(match[0], ' ')
        }
      }
    }

    take(/type:(text|link|image|file|color)/g, (match) => ({
      kind: 'type',
      value: match[1],
      label: `类型：${kindLabels[match[1]]}`,
    }))
    take(/app:(\S+)/g, (match) => {
      const app = Object.values(mockApps).find((candidate) =>
        candidate.name.toLowerCase().includes(match[1].toLowerCase())
      )
      return app ? { kind: 'app', value: app.bundleId, label: `应用：${app.name}` } : null
    })
    take(/(今天|昨天|本周|上周)/g, (match) => ({
      kind: 'date',
      value: dateWords[match[1]],
      label: dateLabels[dateWords[match[1]]],
    }))

    for (const match of text.matchAll(/(图片|截图|链接|文件|颜色|文本)/g)) {
      if (match.index !== undefined) {
        const kind = typeWords[match[1]]
        suggestions.push({
          kind: 'type',
          value: kind,
          label: `类型：${kindLabels[kind]}`,
          start: match.index,
          end: match.index + match[0].length,
        })
      }
    }

    for (const app of Object.values(mockApps)) {
      const index = text.toLowerCase().indexOf(app.name.toLowerCase())

      if (index >= 0 && !tokens.some((token) => token.value === app.bundleId)) {
        suggestions.push({
          kind: 'app',
          value: app.bundleId,
          label: `应用：${app.name}`,
          start: index,
          end: index + app.name.length,
        })
      }
    }

    const datePreset = tokens.find((token) => token.kind === 'date')?.value as ClipDatePreset | undefined

    return {
      keywords: remaining.split(/\s+/).filter(Boolean),
      kinds: tokens.filter((token) => token.kind === 'type').map((token) => token.value as ClipKind),
      appBundleIds: tokens.filter((token) => token.kind === 'app').map((token) => token.value),
      dateRange: datePreset ? presetToRange(datePreset) : undefined,
      datePreset,
      tokens,
      suggestions,
    }
  }

  const runList = (query: ClipQuery): ClipListResult => {
    const parsed = parseQuery(query.text ?? '')
    const kinds = [...(query.kinds ?? []), ...parsed.kinds]
    const appIds = [...(query.appBundleIds ?? []), ...parsed.appBundleIds]
    const range = query.dateRange ?? parsed.dateRange
    let matches = visibleItems().map((entry) => ({ ...entry.item, match: undefined as ClipListItem['match'] }))

    if (query.scope?.type === 'pinboard') {
      const pinboardId = query.scope.pinboardId
      matches = matches.filter((item) => item.pinboardIds.includes(pinboardId))
    }

    if (kinds.length) {
      matches = matches.filter((item) => kinds.includes(item.kind))
    }

    if (appIds.length) {
      matches = matches.filter((item) => item.source && appIds.includes(item.source.bundleId))
    }

    if (range) {
      matches = matches.filter(
        (item) =>
          (range.from === undefined || item.lastCopiedAt >= range.from) &&
          (range.to === undefined || item.lastCopiedAt < range.to)
      )
    }

    if (parsed.keywords.length) {
      const keywords = parsed.keywords
      matches = matches.flatMap((item) => {
        const extras = state.items.find((entry) => entry.item.id === item.id)?.extras
        const fields: Array<['title' | 'body' | 'url' | 'ocr' | 'app', string]> = [
          ['body', item.previewText],
          ['title', item.title],
          ['url', item.url ?? ''],
          ['ocr', extras?.ocrText ?? ''],
          ['app', item.source?.name ?? ''],
        ]
        const haystack = fields.map(([, value]) => value.toLowerCase()).join('\n')

        if (!keywords.every((keyword) => haystack.includes(keyword.toLowerCase()))) {
          return []
        }

        for (const [field, value] of fields) {
          const found = value ? highlight(value, keywords) : null

          if (found) {
            return [{ ...item, match: { field, ...found } }]
          }
        }

        return [item]
      })
    }

    const offset = query.cursor ? Number(query.cursor) : 0
    const limit = query.limit ?? 100
    const page = matches.slice(offset, offset + limit)

    return {
      items: page,
      nextCursor: offset + limit < matches.length ? String(offset + limit) : undefined,
      parsed,
      tookMs: 3,
    }
  }

  const find = (id: string) => state.items.find((entry) => entry.item.id === id)

  const clipboard = {
    list: async (query: ClipQuery) => {
      await delay(25)
      return runList(query)
    },
    getDetail: async (id: string): Promise<ClipDetail | null> => {
      await delay(120)
      const entry = find(id)

      if (!entry || state.hidden.has(id)) {
        return null
      }

      return {
        ...entry.item,
        plainText: entry.extras.plainText ?? entry.item.previewText,
        html: entry.extras.html,
        hasRtf: false,
        filePaths: entry.extras.filePaths ?? [],
        ocrText: entry.extras.ocrText,
        tags: entry.extras.tags ?? (entry.item.kind === 'link' ? ['web'] : []),
        imageUrl: entry.extras.imageUrl,
      }
    },
    paste: async (ids: string[], mode: string) => {
      log('paste', ids, mode)
      await delay(60)
      return params.has('noperm')
        ? { ok: true, action: 'copied' as const, reason: 'no_permission' as const }
        : { ok: true, action: 'pasted' as const }
    },
    copy: async (ids: string[], mode: string) => {
      log('copy', ids, mode)
      return { ok: true }
    },
    remove: async (ids: string[]) => {
      log('delete', ids)
      ids.forEach((id) => state.hidden.add(id))
      const token = `undo-${(idCounter += 1)}`
      state.undo.set(token, ids)
      setTimeout(() => state.undo.delete(token), 5000)
      emitChanged('deleted', ids)
      return { ok: true, deletedIds: ids, undoToken: token }
    },
    undoDelete: async (token: string) => {
      const ids = state.undo.get(token) ?? []
      ids.forEach((id) => state.hidden.delete(id))
      state.undo.delete(token)
      emitChanged('added', ids)
      return { ok: ids.length > 0, restoredIds: ids }
    },
    rename: async (id: string, title: string | null) => {
      const entry = find(id)

      if (!entry) {
        return null
      }

      entry.item.customTitle = title ?? undefined
      entry.item.title = title ?? entry.item.previewText.split('\n')[0].slice(0, 48)
      return { ...entry.item }
    },
    updateText: async (id: string, text: string) => {
      const entry = find(id)

      if (!entry) {
        return null
      }

      entry.item.previewText = text
      entry.item.charCount = text.length
      entry.extras.plainText = text
      return { ...entry.item }
    },
    createText: async (text: string) => {
      idCounter += 1
      const item: ClipListItem = {
        id: `mock-${idCounter}`,
        kind: 'text',
        isRich: false,
        title: text.slice(0, 48),
        previewText: text,
        fileCount: 0,
        byteSize: text.length,
        charCount: text.length,
        source: mockApps.notes,
        isRemote: false,
        createdAt: Date.now(),
        lastCopiedAt: Date.now(),
        copyCount: 1,
        useCount: 0,
        pinboardIds: [],
        hasOcrText: false,
      }
      state.items.push({ item, extras: {} })
      emitChanged('added', [item.id])
      return item
    },
    open: async (id: string) => {
      log('open', id)
      return { ok: true }
    },
    reveal: async (id: string) => {
      log('reveal', id)
      return { ok: true }
    },
    startDrag: async (id: string) => {
      log('startDrag', id)
      return { ok: true }
    },
    listPinboards: async () => {
      refreshPinboardCounts()
      return state.pinboards.map((pinboard) => ({ ...pinboard }))
    },
    createPinboard: async (name: string, color: string) => {
      idCounter += 1
      const pinboard: Pinboard = { id: `pb-${idCounter}`, name, color, sortOrder: state.pinboards.length, itemCount: 0 }
      state.pinboards.push(pinboard)
      return pinboard
    },
    updatePinboard: async (id: string, patch: { name?: string; color?: string }) => {
      const pinboard = state.pinboards.find((candidate) => candidate.id === id)

      if (!pinboard) {
        return null
      }

      Object.assign(pinboard, patch)
      return { ...pinboard }
    },
    deletePinboard: async (id: string) => {
      state.pinboards = state.pinboards.filter((pinboard) => pinboard.id !== id)
      state.items.forEach((entry) => {
        entry.item.pinboardIds = entry.item.pinboardIds.filter((value) => value !== id)
      })
      return { ok: true }
    },
    reorderPinboards: async () => ({ ok: true }),
    addToPinboard: async (pinboardId: string, ids: string[]) => {
      ids.forEach((id) => {
        const entry = find(id)

        if (entry && !entry.item.pinboardIds.includes(pinboardId)) {
          entry.item.pinboardIds = [...entry.item.pinboardIds, pinboardId]
        }
      })
      return { ok: true }
    },
    removeFromPinboard: async (pinboardId: string, ids: string[]) => {
      ids.forEach((id) => {
        const entry = find(id)

        if (entry) {
          entry.item.pinboardIds = entry.item.pinboardIds.filter((value) => value !== pinboardId)
        }
      })
      return { ok: true }
    },
    reorderPinboardItems: async () => ({ ok: true }),
    listApps: async () => Object.values(mockApps),
    aiSearch: async (text: string): Promise<ClipAiSearchResult> => {
      log('aiSearch', text)
      await delay(1100)

      if (text.includes('nomatch')) {
        return { status: 'no_match', items: [], scores: [], tookMs: 1100 }
      }

      const picks = visibleItems()
        .map((entry) => entry.item)
        .filter((item) => item.kind === 'image' || item.kind === 'text')
        .slice(2, 8)
      return { status: 'ok', items: picks, scores: picks.map((_, index) => 0.9 - index * 0.1), tookMs: 1100 }
    },
    aiCancel: async () => ({ ok: true }),
    aiTest: async () => ({ ok: true }),
    stats: async () => ({
      itemCount: state.items.length,
      pinnedItemCount: 0,
      databaseBytes: 0,
      blobBytes: 0,
      ocrPending: 0,
    }),
    clearHistory: async () => ({ ok: true, deletedCount: 0 }),
    hidePanel: async () => {
      log('hidePanel')
      // Bring the preview back so the page stays usable.
      setTimeout(() => api.show(), 900)
      return { ok: true }
    },
    setPanelHeight: async (height: number) => {
      document.documentElement.style.setProperty('--mock-h', `${height}px`)
      return { ok: true }
    },
    togglePasteStack: async () => {
      state.stack = state.stack.active
        ? { active: false, items: [] }
        : {
            active: true,
            items: visibleItems()
              .slice(0, 3)
              .map((entry) => entry.item),
          }
      emitStack()
      return state.stack
    },
    getPasteStack: async () => state.stack,
    permissionStatus: async () => ({ accessibility: !params.has('noperm'), secureInput: false }),
    openAccessibilitySettings: async () => {
      log('openAccessibilitySettings')
      return { ok: true }
    },
    onItemsChanged: (handler: (event: ClipItemsChangedEvent) => void) => {
      changedHandlers.add(handler)
      return () => changedHandlers.delete(handler)
    },
    onPanelShow: (handler: (event: ClipPanelShowEvent) => void) => {
      showHandlers.add(handler)
      const timer = setTimeout(() => handler(showEvent()), 80)
      return () => {
        clearTimeout(timer)
        showHandlers.delete(handler)
      }
    },
    onPanelRequestHide: (handler: () => void) => {
      hideHandlers.add(handler)
      return () => hideHandlers.delete(handler)
    },
    onPasteStack: (handler: (stack: ClipPasteStackState) => void) => {
      stackHandlers.add(handler)
      return () => stackHandlers.delete(handler)
    },
  }

  const showEvent = (): ClipPanelShowEvent => ({
    openedAt: Date.now(),
    targetAppName: '备忘录',
    canDirectPaste: !params.has('noperm'),
    initialQuery: params.get('q') ?? undefined,
  })

  const capability = {
    getSettings: async () => structuredClone(state.settings),
    updateSettings: async (patch: { clipboard?: Record<string, unknown> }) => {
      state.settings = {
        ...state.settings,
        clipboard: { ...state.settings.clipboard, ...patch.clipboard },
      }
      capabilityHandlers.forEach((handler) => handler(structuredClone(state.settings)))
      return structuredClone(state.settings)
    },
    onState: (handler: (settings: unknown) => void) => {
      capabilityHandlers.add(handler)
      return () => capabilityHandlers.delete(handler)
    },
  }

  const windowApi = {
    windowShowRoute: async (route: string) => {
      log('windowShowRoute', route)
    },
  }

  const api = {
    show: () => showHandlers.forEach((handler) => handler(showEvent())),
    requestHide: () => hideHandlers.forEach((handler) => handler()),
    addItem: () => {
      const created = {
        ...state.items[0].item,
        id: `mock-${(idCounter += 1)}`,
        lastCopiedAt: Date.now(),
        previewText: '刚刚复制的新内容',
      }
      state.items.push({ item: { ...created, title: created.previewText }, extras: {} })
      emitChanged('added', [created.id])
    },
  }

  Object.assign(window, { conveyor: { clipboard, capability, window: windowApi }, __clipMock: api })

  // Fake desktop behind the frosted strip + preview height.
  document.documentElement.dataset.cpMock = ''
  const style = document.createElement('style')
  style.textContent = `
    html[data-cp-mock] body {
      background:
        radial-gradient(60% 50% at 20% 30%, rgba(255, 140, 120, 0.9), transparent 70%),
        radial-gradient(50% 60% at 80% 20%, rgba(90, 140, 255, 0.9), transparent 70%),
        radial-gradient(60% 60% at 60% 90%, rgba(120, 220, 170, 0.85), transparent 70%),
        linear-gradient(135deg, #f7e2c8, #c9d8f5);
    }
    html[data-cp-mock] .cp-root { top: auto; height: var(--mock-h, 340px); }
  `
  document.head.appendChild(style)
}
