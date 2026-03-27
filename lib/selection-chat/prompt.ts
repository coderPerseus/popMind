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
  const normalizedSelectionText = selectionText.trim()
  const normalizedMessages = messages.filter(
    (message, index) => !(index === 0 && message.role === 'user' && message.text.trim() === normalizedSelectionText)
  )
  const latestUserMessageIndex = [...normalizedMessages].map((message) => message.role).lastIndexOf('user')
  const latestUserQuestion =
    latestUserMessageIndex >= 0 ? normalizedMessages[latestUserMessageIndex]?.text.trim() ?? '' : ''
  const historyMessages =
    latestUserMessageIndex >= 0
      ? normalizedMessages.filter((_message, index) => index !== latestUserMessageIndex)
      : normalizedMessages

  if (sourceAppName?.trim()) {
    sections.push(`Current application:\n${sourceAppName.trim()}`)
  }

  if (hasImageContext) {
    sections.push(
      'Attached context image:\nA screenshot of the current application window is attached. Use it as additional visual context when it helps explain the selected text.'
    )
  }

  sections.push(translateMessage(language, 'prompt.explain.user.selection', { selection: selectionText }))

  if (historyMessages.length > 0) {
    sections.push(
      [
        'Conversation history:',
        ...historyMessages.map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.text}`),
      ].join('\n')
    )
  }

  if (latestUserQuestion) {
    sections.push(translateMessage(language, 'prompt.explain.user.followup', { question: latestUserQuestion }))
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
