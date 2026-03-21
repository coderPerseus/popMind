import { randomUUID } from 'node:crypto'
import { searchHistoryService } from '@/lib/search-history/service'
import { runExplain } from './runner'
import type { ExplainInput, ExplainResult } from './types'

export class ExplainService {
  async explain(input: ExplainInput): Promise<ExplainResult> {
    const text = input.text.trim()
    if (!text) {
      throw new Error('Text is required')
    }

    const createdAt = Date.now()
    const result = await runExplain({
      selectionText: text,
      messages: [{ role: 'user', text }],
    })

    await searchHistoryService.recordExplain({
      id: randomUUID(),
      selectionText: text,
      messages: [
        {
          id: randomUUID(),
          role: 'user',
          text,
          createdAt,
        },
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
