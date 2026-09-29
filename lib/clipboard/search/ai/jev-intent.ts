// Intent understanding (spec §7.2 step 1): one Jev request with the raw query as state.
// Jev only classifies the wording; the actual date range is computed in code (Jev is bad at dates).
import {
  choice,
  jevRequest,
  noul,
  type JevChoiceAnswer,
  type JevChoiceQuestion,
  type JevNoulAnswer,
  type JevNoulQuestion,
  type JevRequestOptions,
} from '@/lib/clipboard/search/ai/jev-client'
import { computeDateRange } from '@/lib/clipboard/search/query-parser'
import {
  clipDatePresets,
  type ClipAiIntent,
  type ClipDatePreset,
  type ClipDateRange,
  type ClipKind,
  type ClipSourceApp,
} from '@/lib/clipboard/types'

/** Answers below this confidence / probability are ignored. */
export const INTENT_MIN_CONFIDENCE = 0.6
/** Max number of apps offered as options (plus `any`); a choice question holds at most 255 options. */
export const INTENT_MAX_APPS = 250

const STATE_HINT =
  'The state is a search query typed by a user who is looking for something they copied earlier (their clipboard history).'

const KIND_CRITERIA: Record<ClipKind | 'any', string> = {
  text: 'Plain text: a sentence, note, message, address, number, snippet of code',
  link: 'A web link, URL or website address',
  image: 'An image: screenshot, photo, picture, 截图, 图片, 照片',
  file: 'A file or document on disk: PDF, Word, spreadsheet, 文件, 文档',
  color: 'A color value such as #FF8800 or rgb(255, 136, 0)',
  any: 'The query does not say or imply what type of item it is',
}

const DATE_CRITERIA: Record<ClipDatePreset | 'any', string> = {
  today: 'The user wants something copied today (今天)',
  yesterday: 'The user wants something copied yesterday (昨天)',
  this_week: 'The user wants something copied this week (本周, 这周)',
  last_week: 'The user wants something copied last week (上周)',
  this_month: 'The user wants something copied this month (本月)',
  last_month: 'The user wants something copied last month (上个月)',
  last_7_days: 'The user wants something copied in the last 7 days (最近7天, 近一周)',
  last_30_days: 'The user wants something copied in the last 30 days (最近30天, 近一个月)',
  any: 'The query does not mention when the item was copied',
}

export type IntentApp = { key: string; app: ClipSourceApp }

const pad = (value: number): string => String(value).padStart(3, '0')

/** Picks up to `max` apps: the ones named in the query first, then the rest in the given (recency) order. */
export const selectIntentApps = (query: string, apps: ClipSourceApp[], max = INTENT_MAX_APPS): IntentApp[] => {
  const lowerQuery = query.toLowerCase()
  const scored = apps
    .filter((app) => app.name.trim())
    .map((app, index) => {
      const name = app.name.toLowerCase()
      const parts = name.split(/[\s._-]+/).filter((part) => part.length >= 2)
      let relevance = 0
      if (lowerQuery.includes(name)) relevance = 2
      else if (parts.some((part) => lowerQuery.includes(part))) relevance = 1
      return { app, index, relevance }
    })
  scored.sort((a, b) => b.relevance - a.relevance || a.index - b.index)
  return scored.slice(0, max).map((entry, position) => ({ key: `A${pad(position + 1)}`, app: entry.app }))
}

export type IntentOutcome = {
  intent: ClipAiIntent
  /** Date range computed in code from `intent.datePreset`. */
  dateRange?: ClipDateRange
  inputTokens: number
}

export const hasIntentFilters = (intent: ClipAiIntent): boolean =>
  Boolean(intent.kind || intent.datePreset || intent.appBundleId)

export const runIntentRequest = async (
  options: JevRequestOptions,
  query: string,
  apps: ClipSourceApp[],
  now: number
): Promise<IntentOutcome> => {
  const intentApps = selectIntentApps(query, apps)

  const appCriteria: Record<string, string | null> = {}
  for (const entry of intentApps) appCriteria[entry.key] = entry.app.name
  appCriteria.any = 'The query does not mention any application'

  const questions: {
    kind: JevChoiceQuestion
    date: JevChoiceQuestion
    app?: JevChoiceQuestion
    wantsAll: JevNoulQuestion
  } = {
    kind: choice(
      `${STATE_HINT} What type of clipboard item is the user looking for? Answer "any" unless the query clearly says or implies a type.`,
      { ...KIND_CRITERIA }
    ),
    date: choice(
      `${STATE_HINT} Which time period does the query say the item was copied in? Only classify the wording; answer "any" unless a time period is clearly mentioned.`,
      { ...DATE_CRITERIA }
    ),
    wantsAll: noul(
      `${STATE_HINT} Does the user want to see every item of a category (for example all tracking numbers, all links from last week) rather than one specific item?`,
      {
        true: 'The user wants all items of a kind, a list of results',
        false: 'The user is looking for one specific item',
      }
    ),
  }
  if (intentApps.length) {
    questions.app = choice(
      `${STATE_HINT} Which application does the query say the item was copied from? Answer "any" unless an application is clearly mentioned.`,
      appCriteria
    )
  }

  const response = await jevRequest(options, query, questions)
  const answers = response.answers as unknown as {
    kind: JevChoiceAnswer
    date: JevChoiceAnswer
    app?: JevChoiceAnswer
    wantsAll: JevNoulAnswer
  }

  const intent: ClipAiIntent = { wantsAll: false }

  const kind = answers.kind
  if (kind.confidence >= INTENT_MIN_CONFIDENCE && kind.choice !== 'any' && kind.choice in KIND_CRITERIA) {
    intent.kind = kind.choice as ClipKind
  }

  const date = answers.date
  if (
    date.confidence >= INTENT_MIN_CONFIDENCE &&
    date.choice !== 'any' &&
    (clipDatePresets as readonly string[]).includes(date.choice)
  ) {
    intent.datePreset = date.choice as ClipDatePreset
  }

  const appAnswer = answers.app
  if (appAnswer && appAnswer.confidence >= INTENT_MIN_CONFIDENCE && appAnswer.choice !== 'any') {
    const picked = intentApps.find((entry) => entry.key === appAnswer.choice)
    if (picked) intent.appBundleId = picked.app.bundleId
  }

  if (answers.wantsAll.noul >= INTENT_MIN_CONFIDENCE) intent.wantsAll = true

  return {
    intent,
    dateRange: intent.datePreset ? computeDateRange(intent.datePreset, now) : undefined,
    inputTokens: response.inputTokens,
  }
}
