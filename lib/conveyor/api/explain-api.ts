import { ConveyorApi } from '@/lib/preload/shared'
import type { ExplainInput } from '@/lib/explain/types'

export class ExplainApi extends ConveyorApi {
  explain = (input: ExplainInput) => this.invoke('explain-run', input)
}
