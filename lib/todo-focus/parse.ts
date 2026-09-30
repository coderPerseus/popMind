// Natural-language quick add (Todoist style): "明天 下午3点 写周报 #工作 !1 ~2".
// Recognised parts are removed from the title and returned as tokens so the UI can highlight them.
import { addDays, isValidDate, mondayIndex, startOfWeek, toDayKey } from '@/lib/todo-focus/dates'
import type { TodoPriority } from '@/lib/todo-focus/types'

export type QuickAddTokenKind = 'date' | 'time' | 'tag' | 'priority' | 'estimate'

export type QuickAddToken = {
  kind: QuickAddTokenKind
  /** Normalised value: day key, `HH:mm`, tag text, priority 1–3, pomodoro count. */
  value: string
  start: number
  end: number
}

export type QuickAddResult = {
  title: string
  dueDate?: string
  dueTime?: string
  priority?: TodoPriority
  tags: string[]
  estimate?: number
  tokens: QuickAddToken[]
}

const CN_WEEKDAYS: Record<string, number> = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 }
const EN_WEEKDAYS: Record<string, number> = {
  mon: 0,
  monday: 0,
  tue: 1,
  tues: 1,
  tuesday: 1,
  wed: 2,
  wednesday: 2,
  thu: 3,
  thur: 3,
  thurs: 3,
  thursday: 3,
  fri: 4,
  friday: 4,
  sat: 5,
  saturday: 5,
  sun: 6,
  sunday: 6,
}
const CN_NUMBERS: Record<string, number> = {
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
  十: 10,
  十一: 11,
  十二: 12,
}

// Latin tokens must stand alone; CJK tokens may touch other CJK text ("明天下午3点写周报").
const LATIN_BEFORE = '(?<![A-Za-z0-9])'
const LATIN_AFTER = '(?![A-Za-z0-9])'

const weekdayOnOrAfter = (now: Date, weekday: number) => addDays(now, (weekday - mondayIndex(now) + 7) % 7)

type Match = { start: number; end: number }

const findFirst = (text: string, pattern: RegExp, taken: Match[]) => {
  const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  for (let match = regex.exec(text); match; match = regex.exec(text)) {
    const start = match.index
    const end = start + match[0].length
    if (!taken.some((range) => start < range.end && end > range.start)) {
      return match
    }
  }
  return null
}

const parseDate = (text: string, now: Date, taken: Match[]): { value: string; start: number; end: number } | null => {
  const candidates: Array<{ pattern: RegExp; resolve: (match: RegExpExecArray) => Date | null }> = [
    { pattern: /大后天/, resolve: () => addDays(now, 3) },
    { pattern: /后天/, resolve: () => addDays(now, 2) },
    { pattern: /明天|明日/, resolve: () => addDays(now, 1) },
    { pattern: /今天|今日|今晚/, resolve: () => now },
    {
      pattern: /(下下|下|本|这)?(?:周|星期|礼拜)([一二三四五六日天])/,
      resolve: (match) => {
        const weekday = CN_WEEKDAYS[match[2]]
        if (!match[1]) return weekdayOnOrAfter(now, weekday)
        const weeks = match[1] === '下下' ? 2 : match[1] === '下' ? 1 : 0
        return addDays(startOfWeek(now), weeks * 7 + weekday)
      },
    },
    {
      pattern: /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/,
      resolve: (match) => {
        const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
        return isValidDate(year, month, day) ? new Date(year, month - 1, day) : null
      },
    },
    {
      pattern: /(\d{1,2})月(\d{1,2})[日号]?/,
      resolve: (match) => resolveMonthDay(now, Number(match[1]), Number(match[2])),
    },
    {
      pattern: new RegExp(`${LATIN_BEFORE}(\\d{1,2})/(\\d{1,2})${LATIN_AFTER}`),
      resolve: (match) => resolveMonthDay(now, Number(match[1]), Number(match[2])),
    },
    { pattern: new RegExp(`${LATIN_BEFORE}(?:today|tonight)${LATIN_AFTER}`, 'i'), resolve: () => now },
    { pattern: new RegExp(`${LATIN_BEFORE}(?:tomorrow|tmr)${LATIN_AFTER}`, 'i'), resolve: () => addDays(now, 1) },
    {
      pattern: new RegExp(
        `${LATIN_BEFORE}(next\\s+)?(${Object.keys(EN_WEEKDAYS)
          .sort((a, b) => b.length - a.length)
          .join('|')})${LATIN_AFTER}`,
        'i'
      ),
      resolve: (match) => {
        const weekday = EN_WEEKDAYS[match[2].toLowerCase()]
        return match[1] ? addDays(startOfWeek(now), 7 + weekday) : weekdayOnOrAfter(now, weekday)
      },
    },
  ]

  let best: { value: string; start: number; end: number } | null = null
  for (const candidate of candidates) {
    const match = findFirst(text, candidate.pattern, taken)
    if (!match) continue
    const date = candidate.resolve(match)
    if (!date) continue
    if (!best || match.index < best.start) {
      best = { value: toDayKey(date), start: match.index, end: match.index + match[0].length }
    }
  }
  return best
}

const resolveMonthDay = (now: Date, month: number, day: number) => {
  let year = now.getFullYear()
  if (!isValidDate(year, month, day)) return null
  // A date that already passed this year means next year (Todoist behaviour).
  if (new Date(year, month - 1, day) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    year += 1
    if (!isValidDate(year, month, day)) return null
  }
  return new Date(year, month - 1, day)
}

const toTime = (hours: number, minutes: number) =>
  hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
    : null

const parseCnHour = (raw: string) => (/^\d+$/.test(raw) ? Number(raw) : (CN_NUMBERS[raw] ?? NaN))

const parseTime = (text: string, taken: Match[]): { value: string; start: number; end: number } | null => {
  // 下午3点 / 晚上8点半 / 3点15 / 上午十点
  const cn = findFirst(
    text,
    /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|今晚)?(\d{1,2}|十[一二]?|[一二两三四五六七八九十])点(半|(\d{1,2})分?)?/,
    taken
  )
  if (cn) {
    let hours = parseCnHour(cn[2])
    const minutes = cn[3] === '半' ? 30 : cn[4] ? Number(cn[4]) : 0
    const period = cn[1]
    if (period && /下午|傍晚|晚上|今晚/.test(period) && hours < 12) hours += 12
    if (period === '中午' && hours < 11) hours += 12
    const value = Number.isNaN(hours) ? null : toTime(hours, minutes)
    // "今晚8点" also carries a date; keep the date word for the date parser by excluding it from the time span.
    const start = period === '今晚' ? cn.index + 2 : cn.index
    if (value) return { value, start, end: cn.index + cn[0].length }
  }

  // 3pm / 3:30pm / 11 am
  const ampm = findFirst(
    text,
    new RegExp(`${LATIN_BEFORE}(\\d{1,2})(?::(\\d{2}))?\\s?(am|pm)${LATIN_AFTER}`, 'i'),
    taken
  )
  if (ampm) {
    let hours = Number(ampm[1])
    const minutes = ampm[2] ? Number(ampm[2]) : 0
    const pm = ampm[3].toLowerCase() === 'pm'
    if (hours === 12) hours = pm ? 12 : 0
    else if (pm) hours += 12
    const value = hours <= 23 ? toTime(hours, minutes) : null
    if (value) return { value, start: ampm.index, end: ampm.index + ampm[0].length }
  }

  // 15:00 / 9:30
  const clock = findFirst(text, new RegExp(`${LATIN_BEFORE}([01]?\\d|2[0-3])[:：]([0-5]\\d)${LATIN_AFTER}`), taken)
  if (clock) {
    const value = toTime(Number(clock[1]), Number(clock[2]))
    if (value) return { value, start: clock.index, end: clock.index + clock[0].length }
  }

  return null
}

export const parseQuickAdd = (input: string, now = new Date()): QuickAddResult => {
  const text = input
  const tokens: QuickAddToken[] = []
  const taken: Match[] = []
  const take = (kind: QuickAddTokenKind, value: string, start: number, end: number) => {
    tokens.push({ kind, value, start, end })
    taken.push({ start, end })
  }

  const tags: string[] = []
  for (const match of text.matchAll(/(?<![^\s])[#＃]([^\s#＃]+)/g)) {
    const tag = match[1].trim()
    if (tag && !tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      tags.push(tag)
    }
    take('tag', tag, match.index, match.index + match[0].length)
  }

  let priority: TodoPriority | undefined
  const priorityMatch = findFirst(text, /(?<![^\s])(?:[!！]|[pP])([1-3])(?![^\s])/, taken)
  if (priorityMatch) {
    // !1 / p1 is the most important, like Todoist.
    priority = (4 - Number(priorityMatch[1])) as TodoPriority
    take('priority', String(priorityMatch[1]), priorityMatch.index, priorityMatch.index + priorityMatch[0].length)
  }

  let estimate: number | undefined
  const estimateMatch = findFirst(text, /(?<![^\s])[~～](\d{1,2})(?![^\s])/, taken)
  if (estimateMatch && Number(estimateMatch[1]) > 0) {
    estimate = Number(estimateMatch[1])
    take('estimate', String(estimate), estimateMatch.index, estimateMatch.index + estimateMatch[0].length)
  }

  const time = parseTime(text, taken)
  if (time) take('time', time.value, time.start, time.end)

  const date = parseDate(text, now, taken)
  if (date) take('date', date.value, date.start, date.end)

  let title = ''
  let cursor = 0
  for (const range of [...taken].sort((left, right) => left.start - right.start)) {
    title += `${text.slice(cursor, range.start)} `
    cursor = range.end
  }
  title = `${title}${text.slice(cursor)}`.replace(/\s+/g, ' ').trim()

  return {
    title,
    dueDate: date?.value ?? (time ? toDayKey(now) : undefined),
    dueTime: time?.value,
    priority,
    tags,
    estimate,
    tokens: tokens.sort((left, right) => left.start - right.start),
  }
}
