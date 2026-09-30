// Monthly Jev token counter helpers (pure).
import type { ClipboardSettings } from '@/lib/clipboard/types'

export type ClipAiUsage = ClipboardSettings['ai']['usage']

/** Local `YYYY-MM`. */
export const usageMonthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

/** Adds tokens to the counter; a different month than the stored one resets it first. */
export const addAiUsage = (current: ClipAiUsage | undefined, inputTokens: number, now: Date): ClipAiUsage => {
  const month = usageMonthKey(now)
  const base = current && current.month === month ? current.inputTokens : 0
  const added = Number.isFinite(inputTokens) && inputTokens > 0 ? Math.round(inputTokens) : 0
  return { month, inputTokens: base + added }
}
