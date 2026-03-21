export type MainSearchCommand =
  | { kind: 'none' }
  | { kind: 'translate'; id: string; trigger: string; text: string }
  | { kind: 'explain'; id: string; trigger: string; text: string }
  | { kind: 'plugin'; id: string; trigger: string; text: string }

export type MainSearchSlashEntry = {
  kind: 'translate' | 'explain' | 'plugin'
  id: string
  aliases: string[]
}

export const parseMainSearchCommand = (rawQuery: string, entries: MainSearchSlashEntry[]): MainSearchCommand => {
  const query = rawQuery.trim()

  if (!query.startsWith('/')) {
    return { kind: 'none' }
  }

  const normalizedEntries = entries
    .flatMap((entry) => entry.aliases.map((alias) => ({ kind: entry.kind, id: entry.id, alias })))
    .sort((left, right) => right.alias.length - left.alias.length)

  for (const entry of normalizedEntries) {
    const trigger = entry.alias

    if (query === trigger) {
      return {
        kind: entry.kind,
        id: entry.id,
        trigger,
        text: '',
      }
    }

    if (query.startsWith(`${trigger} `)) {
      return {
        kind: entry.kind,
        id: entry.id,
        trigger,
        text: query.slice(trigger.length).trim(),
      }
    }
  }

  return { kind: 'none' }
}
