// Synchronous mirror of `settings.clipboard` (capture polling, paste and window code need it without awaiting).
import { capabilityStore } from '@/lib/capability/store'
import { defaultClipboardSettings, type ClipboardSettings } from '@/lib/clipboard/types'
import { mainLogger } from '@/lib/main/logger'
import { addAiUsage } from './usage'

let current: ClipboardSettings = defaultClipboardSettings
let detach: (() => void) | null = null
let usageChain: Promise<unknown> = Promise.resolve()

export const getClipboardSettings = () => current

/** Loads the saved settings and keeps the mirror in sync with later changes. */
export const initClipboardSettings = async () => {
  if (detach) return

  detach = capabilityStore.subscribe((settings) => {
    current = settings.clipboard ?? defaultClipboardSettings
  })

  const settings = await capabilityStore.getSettings()
  current = settings.clipboard ?? defaultClipboardSettings
}

export const disposeClipboardSettings = () => {
  detach?.()
  detach = null
}

/** Adds Jev input tokens to the monthly counter (reset when the month changes). */
export const recordClipboardAiUsage = (inputTokens: number, now = new Date()) => {
  if (!inputTokens || inputTokens <= 0) return Promise.resolve()

  usageChain = usageChain
    .then(async () => {
      const previous = (await capabilityStore.getSettings()).clipboard?.ai.usage
      const usage = addAiUsage(previous, inputTokens, now)
      await capabilityStore.updateSettings({ clipboard: { ai: { usage } } })
      mainLogger.info('[clip-ai] usage updated', usage)
    })
    .catch((error) => {
      mainLogger.warn('[clip-ai] usage update failed', { error: String(error) })
    })

  return usageChain
}
