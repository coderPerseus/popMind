import { capabilityService } from '@/lib/capability/service'
import { handle } from '@/lib/main/shared'
import type { CapabilitySettings, CapabilitySettingsPatch, WebSearchProviderId } from '@/lib/capability/types'

export const registerCapabilityHandlers = () => {
  handle('capability-get-settings', () => capabilityService.getSettings())
  handle('capability-update-settings', (patch: CapabilitySettingsPatch) => capabilityService.updateSettings(patch))
  handle('capability-test-ai-service', (settings: CapabilitySettings) => capabilityService.testAiService(settings))
  handle('capability-test-web-search-provider', (settings: CapabilitySettings, providerId: WebSearchProviderId) =>
    capabilityService.testWebSearchProvider(settings, providerId)
  )
}
