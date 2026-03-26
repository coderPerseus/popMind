import { formatLanguageLabel, translateMessage } from '@/lib/i18n/shared'
import type { AppLanguage } from '@/lib/capability/types'
import type { ExplainConversationMessage } from '@/lib/explain/types'
import type { WebSearchResult } from '@/lib/web-search/types'

export const buildExplainSystemPrompt = (language: AppLanguage) => {
  return translateMessage(language, 'prompt.explain.system', {
    languageLabel: formatLanguageLabel(language),
  })
}

export const buildExplainPrompt = ({
  language,
  selectionText,
  messages,
  searchResults,
  sourceAppName,
  hasImageContext,
}: {
  language: AppLanguage
  selectionText: string
  messages: ExplainConversationMessage[]
  searchResults: WebSearchResult[]
  sourceAppName?: string
  hasImageContext?: boolean
}) => {
  const sections = []

  if (sourceAppName?.trim()) {
    sections.push(`Current application:\n${sourceAppName.trim()}`)
  }

  if (hasImageContext) {
    sections.push(
      'Attached context image:\nA screenshot of the current application window is attached. Use it as additional visual context when it helps explain the selected text.'
    )
  }

  sections.push(translateMessage(language, 'prompt.explain.user.selection', { selection: selectionText }))

  if (messages.length > 1) {
    sections.push(
      [
        'Conversation history:',
        ...messages.map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`),
      ].join('\n')
    )
  }

  if (searchResults.length > 0) {
    sections.push(
      translateMessage(language, 'prompt.explain.user.search', {
        context: searchResults
          .map((item, index) => `${index + 1}. ${item.title}\n${item.url}\n${item.snippet}`)
          .join('\n\n'),
      })
    )
  }

  return sections.join('\n\n')
}
