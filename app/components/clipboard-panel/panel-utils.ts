import type { AppLanguage } from '@/lib/capability/types'
import { clipT } from '@/lib/clipboard/i18n'
import type { ClipDatePreset, ClipDateRange, ClipKind, ClipListItem } from '@/lib/clipboard/types'

export const CARD_WIDTH = 220
export const CARD_GAP = 12
export const STRIP_PADDING = 16
export const GROUP_WIDTH = 34
export const PAGE_SIZE = 100
export const OVERSCAN_PX = 480
export const MIN_PANEL_HEIGHT = 160
export const MAX_PANEL_HEIGHT = 900
export const NEUTRAL_HEADER_COLOR = '#8e8e93'
export const UNDO_WINDOW_MS = 5000

export type PanelTranslate = (key: string, params?: Record<string, string | number>) => string

export const createTranslate =
  (language: AppLanguage): PanelTranslate =>
  (key, params) =>
    clipT(language, key, params)

export const pinboardColorValues: Record<string, string> = {
  red: '#ff453a',
  orange: '#ff9f0a',
  yellow: '#ffd60a',
  green: '#30d158',
  blue: '#0a84ff',
  purple: '#bf5af2',
  gray: '#8e8e93',
}

export const getPinboardColor = (color: string | undefined) => {
  if (!color) {
    return pinboardColorValues.gray
  }

  return pinboardColorValues[color] ?? (color.startsWith('#') ? color : pinboardColorValues.gray)
}

export const kindOptions: ClipKind[] = ['text', 'link', 'image', 'file', 'color']

export const datePresetOptions: ClipDatePreset[] = ['today', 'yesterday', 'this_week', 'last_week', 'this_month']

export const formatRelativeTime = (t: PanelTranslate, language: AppLanguage, timestamp: number, now: number) => {
  const diff = Math.max(0, now - timestamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) {
    return t('clip.panel.time.justNow')
  }

  if (diff < hour) {
    return t('clip.panel.time.minutes', { count: Math.floor(diff / minute) })
  }

  if (diff < day) {
    return t('clip.panel.time.hours', { count: Math.floor(diff / hour) })
  }

  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const daysAgo = Math.ceil((startOfToday.getTime() - timestamp) / day)

  if (daysAgo <= 1) {
    return t('clip.panel.time.yesterday')
  }

  if (daysAgo < 7) {
    return t('clip.panel.time.days', { count: daysAgo })
  }

  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    year: sameYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export const formatDateTime = (language: AppLanguage, timestamp: number) =>
  new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp)

export const formatBytes = (value: number) => {
  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export const getDomain = (url: string | undefined) => {
  if (!url) {
    return ''
  }

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const parseHexColor = (value: string): [number, number, number] | null => {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())

  if (!match) {
    return null
  }

  let hex = match[1]

  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((char) => char + char)
      .join('')
  }

  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

/** White or near-black text, whichever reads better on the given `#rrggbb` background. */
export const readableTextColor = (background: string) => {
  const rgb = parseHexColor(background)

  if (!rgb) {
    return '#ffffff'
  }

  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b

  return luminance > 0.42 ? 'rgba(0, 0, 0, 0.82)' : '#ffffff'
}

export const colorToRgbLabel = (value: string) => {
  const rgb = parseHexColor(value)
  return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : ''
}

export const presetToRange = (preset: ClipDatePreset, nowMs = Date.now()): ClipDateRange => {
  const now = new Date(nowMs)
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
  const today = startOfDay(now)
  // Monday based weeks.
  const weekStart = addDays(today, -((today.getDay() + 6) % 7))

  switch (preset) {
    case 'today':
      return { from: today.getTime(), to: addDays(today, 1).getTime() }
    case 'yesterday':
      return { from: addDays(today, -1).getTime(), to: today.getTime() }
    case 'this_week':
      return { from: weekStart.getTime(), to: addDays(weekStart, 7).getTime() }
    case 'last_week':
      return { from: addDays(weekStart, -7).getTime(), to: weekStart.getTime() }
    case 'this_month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime() }
    case 'last_month':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
        to: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      }
    case 'last_7_days':
      return { from: addDays(today, -6).getTime() }
    case 'last_30_days':
      return { from: addDays(today, -29).getTime() }
    default:
      return {}
  }
}

/** Remove `[start, end)` from the raw query text and tidy the whitespace left behind. */
export const stripTextRange = (text: string, start: number, end: number) =>
  `${text.slice(0, start)} ${text.slice(end)}`.replace(/\s+/g, ' ').trimStart()

/** ≥ 2 words or ≥ 5 CJK characters (spec §7.2). */
export const looksLikeNaturalLanguage = (text: string) => {
  const trimmed = text.trim()

  if (!trimmed) {
    return false
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  const cjk = trimmed.match(/[㐀-鿿]/g)?.length ?? 0
  return words.length >= 2 || cjk >= 5
}

export const isEditableTarget = (target: EventTarget | null): target is HTMLElement => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
}

export const canEditText = (item: ClipListItem) => item.kind === 'text' || item.kind === 'link'
export const canOpen = (item: ClipListItem) => item.kind === 'link' || item.kind === 'file'

export const mergeUniqueById = (base: ClipListItem[], extra: ClipListItem[]) => {
  const seen = new Set(base.map((item) => item.id))
  return [...base, ...extra.filter((item) => !seen.has(item.id))]
}

export const copyTextToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  }
}
