// Public entry of the AI search package. FOUNDATION STUBS — replaced by jev-client.ts / jev-intent.ts / jev-rerank.ts.
import type { ClipAiSearchFn, ClipAiTestFn } from '@/lib/clipboard/search/ai/contract'

export type * from '@/lib/clipboard/search/ai/contract'

export const runAiSearch: ClipAiSearchFn = async () => ({ status: 'disabled', items: [], scores: [], tookMs: 0 })

export const testJevConnection: ClipAiTestFn = async () => ({ ok: false, errorMessage: 'not implemented' })
