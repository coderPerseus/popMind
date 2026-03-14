import { testAiService } from '@/lib/ai-service/test-service'
import type { CapabilitySettings } from './types'
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

  subscribe(listener: (settings: Awaited<ReturnType<typeof capabilityStore.getSettings>>) => void) {
    return capabilityStore.subscribe(listener)
  }
}

export const capabilityService = new CapabilityService()
