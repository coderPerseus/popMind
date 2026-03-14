import { testAiService } from '@/lib/ai-service/test-service'
import { testWebSearchProvider } from '@/lib/web-search/test-service'
import type { CapabilitySettings, WebSearchProviderId } from './types'
import { capabilityStore } from './store'

export class CapabilityService {
  getSettings() {
    return capabilityStore.getSettings()
  }

  updateSettings(patch: Parameters<typeof capabilityStore.updateSettings>[0]) {
    return capabilityStore.updateSettings(patch)
  }

  testAiService(settings: CapabilitySettings) {
    return testAiService(settings)
  }

  testWebSearchProvider(settings: CapabilitySettings, providerId: WebSearchProviderId) {
    return testWebSearchProvider(settings, providerId)
  }

  subscribe(listener: (settings: Awaited<ReturnType<typeof capabilityStore.getSettings>>) => void) {
    return capabilityStore.subscribe(listener)
  }
}

export const capabilityService = new CapabilityService()
