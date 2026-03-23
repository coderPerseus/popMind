import { randomUUID } from 'node:crypto'
import { searchHistoryService } from '@/lib/search-history/service'
import { runExplain } from './runner'
import type { ExplainInput, ExplainResult } from './types'

export class ExplainService {
  async explain(input: ExplainInput): Promise<ExplainResult> {
    const selectionText = input.selectionText.trim()
    const messages = input.messages
      .map((message) => ({
        role: message.role,
        text: message.text.trim(),
      }))
      .filter((message) => message.text)

    if (!selectionText) {
      throw new Error('Selection text is required')
    }

    if (!messages.length) {
      throw new Error('Messages are required')
    }

    const createdAt = Date.now()
    const result = await runExplain({
      selectionText,
      messages,
    })

    await searchHistoryService.recordExplain({
      id: randomUUID(),
      selectionText,
      messages: [
        ...messages.map((message, index) => ({
          id: randomUUID(),
          role: message.role,
          text: message.text,
          createdAt: createdAt + index,
        })),
        {
          id: randomUUID(),
          role: 'assistant',
          text: result.text,
          createdAt: Date.now(),
          sources: result.sources.length ? result.sources : undefined,
        },
      ],
      aiProvider: result.aiProvider,
      webSearchProvider: result.webSearchProvider,
      language: result.language,
    })

    return result
  }
}

export const explainService = new ExplainService()
