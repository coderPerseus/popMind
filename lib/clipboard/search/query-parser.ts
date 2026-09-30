// Query parser (spec §6.3). Splits the raw search box text into free-text keywords, filter tokens
// (`type:` / `app:` / `in:` / date words) and Paste-style suggestions. Dates are computed here, never by the AI.
import type { ClipQueryParseFn, ClipSearchContext } from '@/lib/clipboard/search/contract'
import type { ClipDatePreset, ClipDateRange, ClipKind, ClipQueryToken, ParsedClipQuery } from '@/lib/clipboard/types'

const HOUR_MS = 60 * 60 * 1000

// ---------------------------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------------------------

const startOfDay = (ts: number, dayOffset = 0): number => {
  const date = new Date(ts)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset).getTime()
}

/** Monday 00:00 (local time) of the week containing `ts`. */
const startOfWeek = (ts: number, weekOffset = 0): number => {
  const date = new Date(ts)
  const dayOfWeek = (date.getDay() + 6) % 7
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - dayOfWeek + weekOffset * 7).getTime()
}

const startOfMonth = (ts: number, monthOffset = 0): number => {
  const date = new Date(ts)
  return new Date(date.getFullYear(), date.getMonth() + monthOffset, 1).getTime()
}

/** Extra machine values the parser can emit besides `ClipDatePreset` (dateRange is still filled in). */
export type ClipDateValue = ClipDatePreset | 'day_before_yesterday' | `last_${number}_days` | `last_${number}_hours`

/**
 * Resolves a date preset to a concrete range in local time (week starts on Monday).
 * `from` inclusive, `to` exclusive. Also exported for the AI intent, which only classifies wording.
 */
export const computeDateRange = (preset: ClipDateValue, now: number): ClipDateRange => {
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: startOfDay(now, 1) }
    case 'yesterday':
      return { from: startOfDay(now, -1), to: startOfDay(now) }
    case 'day_before_yesterday':
      return { from: startOfDay(now, -2), to: startOfDay(now, -1) }
    case 'this_week':
      return { from: startOfWeek(now), to: startOfWeek(now, 1) }
    case 'last_week':
      return { from: startOfWeek(now, -1), to: startOfWeek(now) }
    case 'this_month':
      return { from: startOfMonth(now), to: startOfMonth(now, 1) }
    case 'last_month':
      return { from: startOfMonth(now, -1), to: startOfMonth(now) }
    case 'last_7_days':
      return { from: startOfDay(now, -6) }
    case 'last_30_days':
      return { from: startOfDay(now, -29) }
    default: {
      const days = /^last_(\d+)_days$/.exec(preset)
      if (days) return { from: startOfDay(now, -(Math.max(Number(days[1]), 1) - 1)) }
      const hours = /^last_(\d+)_hours$/.exec(preset)
      if (hours) return { from: now - Number(hours[1]) * HOUR_MS }
      return {}
    }
  }
}

/** Intersects two ranges; either may be undefined. */
export const intersectDateRanges = (a?: ClipDateRange, b?: ClipDateRange): ClipDateRange | undefined => {
  if (!a) return b
  if (!b) return a
  const from = a.from !== undefined && b.from !== undefined ? Math.max(a.from, b.from) : (a.from ?? b.from)
  const to = a.to !== undefined && b.to !== undefined ? Math.min(a.to, b.to) : (a.to ?? b.to)
  return { from, to }
}

// ---------------------------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------------------------

const TYPE_ALIASES: Record<ClipKind, string[]> = {
  image: [
    'image',
    'images',
    'img',
    'photo',
    'photos',
    'picture',
    'pictures',
    'screenshot',
    'screenshots',
    '图片',
    '图像',
    '图',
    '截图',
    '照片',
    '截屏',
  ],
  text: ['text', 'texts', 'txt', 'string', '文本', '文字', '纯文本'],
  link: ['link', 'links', 'url', 'urls', 'web', '链接', '网址', '网页', '连接'],
  file: ['file', 'files', 'document', 'documents', 'doc', '文件', '文档'],
  color: ['color', 'colors', 'colour', 'colours', '颜色', '色值', '色彩', '色'],
}

/** Words that are only suggested (never auto applied) when they stand alone. Deliberately narrower than TYPE_ALIASES. */
const TYPE_SUGGEST_WORDS: Record<string, ClipKind> = {
  图片: 'image',
  截图: 'image',
  照片: 'image',
  image: 'image',
  images: 'image',
  photo: 'image',
  screenshot: 'image',
  picture: 'image',
  链接: 'link',
  网址: 'link',
  link: 'link',
  links: 'link',
  url: 'link',
  文件: 'file',
  file: 'file',
  files: 'file',
  颜色: 'color',
  色值: 'color',
  color: 'color',
  colour: 'color',
  文本: 'text',
  text: 'text',
}

const kindOfTypeWord = (raw: string): ClipKind | undefined => {
  const word = raw.trim().toLowerCase()
  if (!word) return undefined
  for (const kind of Object.keys(TYPE_ALIASES) as ClipKind[]) {
    if (TYPE_ALIASES[kind].includes(word)) return kind
  }
  // Unique prefix of an English alias (typing `type:im` should already work).
  if (word.length >= 2 && /^[a-z]+$/.test(word)) {
    const matched = new Set<ClipKind>()
    for (const kind of Object.keys(TYPE_ALIASES) as ClipKind[]) {
      if (TYPE_ALIASES[kind].some((alias) => alias.startsWith(word))) matched.add(kind)
    }
    if (matched.size === 1) return [...matched][0]
  }
  return undefined
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

/** Parses `3`, `三`, `十`, `十二`, `二十`, `二十五`. Returns undefined if not a number. */
const parseCount = (raw: string): number | undefined => {
  if (/^\d+$/.test(raw)) return Number(raw)
  if (!/^[零一二两三四五六七八九十]+$/.test(raw)) return undefined
  const tenIndex = raw.indexOf('十')
  if (tenIndex === -1) {
    let total = 0
    for (const ch of raw) total = total * 10 + (CN_DIGITS[ch] ?? 0)
    return total
  }
  const tens = tenIndex === 0 ? 1 : (CN_DIGITS[raw[tenIndex - 1]] ?? 0)
  const rest = raw.slice(tenIndex + 1)
  const ones = rest ? (CN_DIGITS[rest[0]] ?? 0) : 0
  return tens * 10 + ones
}

type DateMatch = { value: ClipDateValue; preset?: ClipDatePreset }

const STATIC_DATE_WORDS: Array<[RegExp, ClipDateValue]> = [
  [/^(?:今天|今日|today)$/i, 'today'],
  [/^(?:昨天|昨日|yesterday)$/i, 'yesterday'],
  [/^(?:前天|day before yesterday)$/i, 'day_before_yesterday'],
  [/^(?:本周|这周|本星期|这星期|这一周|这个星期|this week)$/i, 'this_week'],
  [/^(?:上周|上星期|上个星期|上一周|上个礼拜|上礼拜|last week)$/i, 'last_week'],
  [/^(?:本月|这个月|这月|this month)$/i, 'this_month'],
  [/^(?:上个月|上月|上一个月|last month)$/i, 'last_month'],
  [/^(?:近一周|最近一周|最近一星期|past week)$/i, 'last_7_days'],
  [/^(?:近一个月|最近一个月|past month)$/i, 'last_30_days'],
]

const RECENT_UNIT_ZH = /^(?:最近|近|过去)\s*(\d+|[零一二两三四五六七八九十]+)\s*个?\s*(天|日|小时)(?:内|以内)?$/
const RECENT_UNIT_EN = /^(?:last|past)\s+(\d+)\s+(days?|hours?)$/i

const matchDatePhrase = (phrase: string): DateMatch | undefined => {
  const text = phrase.trim()
  for (const [pattern, value] of STATIC_DATE_WORDS) {
    if (pattern.test(text)) return { value, preset: isPreset(value) ? value : undefined }
  }
  const zh = RECENT_UNIT_ZH.exec(text)
  const en = zh ? null : RECENT_UNIT_EN.exec(text)
  const hit = zh ?? en
  if (!hit) return undefined
  const count = parseCount(hit[1])
  if (!count || count < 1 || count > 3650) return undefined
  const isHours = /小时|hour/i.test(hit[2])
  if (isHours) return { value: `last_${count}_hours` }
  if (count === 7) return { value: 'last_7_days', preset: 'last_7_days' }
  if (count === 30) return { value: 'last_30_days', preset: 'last_30_days' }
  return { value: `last_${count}_days` }
}

const presetSet = new Set<string>([
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'last_7_days',
  'last_30_days',
])
const isPreset = (value: string): value is ClipDatePreset => presetSet.has(value)

// ---------------------------------------------------------------------------------------------
// Fuzzy name matching (apps / pinboards)
// ---------------------------------------------------------------------------------------------

const normalizeName = (value: string): string => value.toLowerCase().replace(/[\s._\-·]+/g, '')

const bundleTail = (bundleId: string): string => {
  const tail = bundleId.split('.').pop() ?? bundleId
  return normalizeName(tail)
}

type NamedApp = { bundleId: string; name: string }

/** Tier 0 = bundle id equal, 1 = name equal / name part equal, 2 = prefix, 3 = substring. Lower is better. */
const appMatchTier = (app: NamedApp, rawQuery: string): number | undefined => {
  const query = normalizeName(rawQuery)
  if (!query) return undefined
  if (app.bundleId.toLowerCase() === rawQuery.trim().toLowerCase()) return 0
  const name = normalizeName(app.name)
  const tail = bundleTail(app.bundleId)
  if (name === query || tail === query) return 1
  if (query.length >= 3) {
    const parts = app.name
      .toLowerCase()
      .split(/[\s._\-]+/)
      .filter((part) => part.length >= 3)
    if (parts.includes(rawQuery.trim().toLowerCase())) return 1
  }
  if (name.startsWith(query) || tail.startsWith(query)) return 2
  if (name.includes(query) || app.bundleId.toLowerCase().includes(query)) return 3
  return undefined
}

const matchApps = (rawQuery: string, apps: NamedApp[], maxTier: number, cap: number): NamedApp[] => {
  let bestTier = Infinity
  let matched: NamedApp[] = []
  for (const app of apps) {
    const tier = appMatchTier(app, rawQuery)
    if (tier === undefined || tier > maxTier) continue
    if (tier < bestTier) {
      bestTier = tier
      matched = [app]
    } else if (tier === bestTier) {
      matched.push(app)
    }
  }
  return matched.slice(0, cap)
}

const matchPinboard = (rawQuery: string, pinboards: Array<{ id: string; name: string }>) => {
  const query = normalizeName(rawQuery)
  if (!query) return undefined
  const tiered = (pinboard: { id: string; name: string }): number | undefined => {
    if (pinboard.id === rawQuery.trim()) return 0
    const name = normalizeName(pinboard.name)
    if (name === query) return 1
    if (name.startsWith(query)) return 2
    if (name.includes(query)) return 3
    return undefined
  }
  let best: { id: string; name: string } | undefined
  let bestTier = Infinity
  for (const pinboard of pinboards) {
    const tier = tiered(pinboard)
    if (tier !== undefined && tier < bestTier) {
      best = pinboard
      bestTier = tier
    }
  }
  return best
}

// ---------------------------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------------------------

type Word = { text: string; start: number; end: number }

const splitWords = (text: string): Word[] => {
  const words: Word[] = []
  const pattern = /\S+/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    words.push({ text: match[0], start: match.index, end: match.index + match[0].length })
  }
  return words
}

const PREFIX_PATTERN = /^(type|kind|app|in|pinboard)[:：](.*)$/i

export const parseClipQuery: ClipQueryParseFn = (text: string, context: ClipSearchContext): ParsedClipQuery => {
  const words = splitWords(text ?? '')
  const consumed = new Set<number>()
  const tokens: ClipQueryToken[] = []
  const kinds: ClipKind[] = []
  const appBundleIds: string[] = []
  let dateRange: ClipDateRange | undefined
  let datePreset: ClipDatePreset | undefined
  let pinboardId: string | undefined

  for (let i = 0; i < words.length; i++) {
    if (consumed.has(i)) continue
    const word = words[i]

    // 1. explicit `key:value` tokens
    const prefixed = PREFIX_PATTERN.exec(word.text)
    if (prefixed) {
      const key = prefixed[1].toLowerCase()
      const value = prefixed[2]
      if (key === 'type' || key === 'kind') {
        if (!value) {
          consumed.add(i)
          continue
        }
        const kind = kindOfTypeWord(value)
        if (kind) {
          consumed.add(i)
          if (!kinds.includes(kind)) kinds.push(kind)
          tokens.push({ kind: 'type', value: kind, label: value, start: word.start, end: word.end })
        }
        continue
      }
      if (key === 'app') {
        consumed.add(i)
        if (!value) continue
        const matched = matchApps(value, context.apps, 3, 5)
        if (matched.length === 0) {
          // Unknown app: keep the filter (it yields no results) instead of silently searching for "app:xyz".
          appBundleIds.push(value)
          tokens.push({ kind: 'app', value, label: value, start: word.start, end: word.end })
          continue
        }
        for (const app of matched) {
          if (!appBundleIds.includes(app.bundleId)) appBundleIds.push(app.bundleId)
          tokens.push({ kind: 'app', value: app.bundleId, label: app.name, start: word.start, end: word.end })
        }
        continue
      }
      // in: / pinboard:
      consumed.add(i)
      if (!value) continue
      const pinboard = matchPinboard(value, context.pinboards)
      if (pinboard) {
        pinboardId = pinboard.id
        tokens.push({ kind: 'pinboard', value: pinboard.id, label: pinboard.name, start: word.start, end: word.end })
      } else {
        pinboardId = value
        tokens.push({ kind: 'pinboard', value, label: value, start: word.start, end: word.end })
      }
      continue
    }

    // 2. date words (1–3 word phrases, longest first). Only the first date is applied.
    if (!datePreset && !dateRange) {
      let matchedLength = 0
      let dateMatch: DateMatch | undefined
      for (let length = Math.min(3, words.length - i); length >= 1 && !dateMatch; length--) {
        const slice = words.slice(i, i + length)
        if (slice.some((_, offset) => consumed.has(i + offset))) continue
        const phrase = slice.map((part) => part.text).join(' ')
        dateMatch = matchDatePhrase(phrase)
        if (dateMatch) matchedLength = length
      }
      if (dateMatch) {
        const last = words[i + matchedLength - 1]
        for (let offset = 0; offset < matchedLength; offset++) consumed.add(i + offset)
        dateRange = computeDateRange(dateMatch.value, context.now)
        datePreset = dateMatch.preset
        tokens.push({
          kind: 'date',
          value: dateMatch.value,
          label: text.slice(word.start, last.end),
          start: word.start,
          end: last.end,
        })
        i += matchedLength - 1
        continue
      }
    }
  }

  const keywords = words.filter((_, index) => !consumed.has(index)).map((word) => word.text)

  // 3. suggestions: standalone words that name a type or a known app (kept as keywords, not applied)
  const suggestions: ClipQueryToken[] = []
  const suggested = new Set<string>()
  for (let i = 0; i < words.length; i++) {
    if (consumed.has(i)) continue
    const word = words[i]
    const lower = word.text.toLowerCase()
    const kind = TYPE_SUGGEST_WORDS[lower]
    if (kind && !kinds.includes(kind) && !suggested.has(`type:${kind}`)) {
      suggested.add(`type:${kind}`)
      suggestions.push({ kind: 'type', value: kind, label: word.text, start: word.start, end: word.end })
    }
    if (word.text.length >= 2 && !kind) {
      for (const app of matchApps(word.text, context.apps, 1, 3)) {
        if (appBundleIds.includes(app.bundleId) || suggested.has(`app:${app.bundleId}`)) continue
        suggested.add(`app:${app.bundleId}`)
        suggestions.push({ kind: 'app', value: app.bundleId, label: app.name, start: word.start, end: word.end })
      }
    }
  }

  return { keywords, kinds, appBundleIds, dateRange, datePreset, pinboardId, tokens, suggestions }
}
