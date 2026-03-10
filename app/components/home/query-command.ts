export type MainSearchCommand =
  | { kind: 'none' }
  | { kind: 'translate'; trigger: '/tr' | '/翻译'; text: string }

const translateTriggers = ['/tr', '/翻译'] as const

export const parseMainSearchCommand = (rawQuery: string): MainSearchCommand => {
  const query = rawQuery.trim()

  if (!query.startsWith('/')) {
    return { kind: 'none' }
  }

  for (const trigger of translateTriggers) {
    if (query === trigger) {
      return {
        kind: 'translate',
        trigger,
        text: '',
      }
    }

    if (query.startsWith(`${trigger} `)) {
      return {
        kind: 'translate',
        trigger,
        text: query.slice(trigger.length).trim(),
      }
    }
  }

  return { kind: 'none' }
}
