import { explainService } from '@/lib/explain/service'
import { handle } from '@/lib/main/shared'
import type { ExplainInput } from '@/lib/explain/types'

export const registerExplainHandlers = () => {
  handle('explain-run', (input: ExplainInput) => explainService.explain(input))
}
