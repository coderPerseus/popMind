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
}: {
  language: AppLanguage
  selectionText: string
  messages: ExplainConversationMessage[]
  searchResults: WebSearchResult[]
}) => {
  const sections = [translateMessage(language, 'prompt.explain.user.selection', { selection: selectionText })]

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
