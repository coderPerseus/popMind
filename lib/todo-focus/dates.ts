// Local-calendar date helpers. Days are `YYYY-MM-DD` strings in local time; weeks start on Monday.

const pad = (value: number) => String(value).padStart(2, '0')

export const toDayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const parseDayKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export const addDays = (date: Date, days: number) => {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + days)
  return next
}

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

/** 0 = Monday … 6 = Sunday. */
export const mondayIndex = (date: Date) => (date.getDay() + 6) % 7

export const startOfWeek = (date: Date) => addDays(date, -mondayIndex(date))

export const dayDiff = (from: Date, to: Date) =>
  Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000)

export const isValidDate = (year: number, month: number, day: number) => {
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export const isValidTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
