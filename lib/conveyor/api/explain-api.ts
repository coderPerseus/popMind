import { MainExplainChannel } from '@/lib/explain/shared'
import type { MainExplainState, ExplainSessionMode } from '@/lib/explain/types'
import type { AiProviderId } from '@/lib/capability/types'
import { ConveyorApi } from '@/lib/preload/shared'

export class ExplainApi extends ConveyorApi {
  onState = (handler: (state: MainExplainState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: MainExplainState) => {
      handler(state)
    }

    this.renderer.on(MainExplainChannel.State, listener)
    return () => this.renderer.removeListener(MainExplainChannel.State, listener)
  }

  getState = () => this.invoke('explain-get-state')
  startSession = (selectionText: string, mode: ExplainSessionMode = 'explain', providerId?: AiProviderId) =>
    this.invoke('explain-start', selectionText, mode, providerId)
  submitMessage = (message: string) => this.invoke('explain-submit', message)
  regenerate = () => this.invoke('explain-regenerate')
  stop = () => this.invoke('explain-stop')
  reset = () => this.invoke('explain-reset')
}
