import { globalShortcut } from 'electron'
import { capabilityService } from '@/lib/capability/service'
import { mainLogger } from '@/lib/main/logger'
import {
  canonicalizeAccelerator,
  defaultShortcutBindings,
  normalizeShortcutBindings,
  shortcutActionIds,
  type ShortcutActionId,
  type ShortcutBindings,
  type ShortcutStatus,
} from './shared'

const isMac = process.platform === 'darwin'

/** Owns every user-configurable global shortcut and keeps them in sync with the saved settings. */
class ShortcutManager {
  private readonly handlers = new Map<ShortcutActionId, () => void>()
  private bindings: ShortcutBindings = { ...defaultShortcutBindings }
  private readonly registered = new Map<ShortcutActionId, string>()
  private statuses = new Map<ShortcutActionId, ShortcutStatus>()
  private initialized = false
  private suspended = false
  private detachSettingsListener: (() => void) | null = null
  private suspendFailsafeTimer: NodeJS.Timeout | null = null

  async initialize() {
    if (this.initialized) return
    this.initialized = true

    const settings = await capabilityService.getSettings()
    this.bindings = normalizeShortcutBindings(settings.shortcuts)
    this.apply('initialize')

    this.detachSettingsListener = capabilityService.subscribe((next) => {
      const bindings = normalizeShortcutBindings(next.shortcuts)
      if (shortcutActionIds.every((id) => bindings[id] === this.bindings[id])) return

      this.bindings = bindings
      this.apply('settings-changed')
    })
  }

  setHandler(id: ShortcutActionId, handler: () => void) {
    this.handlers.set(id, handler)
    if (this.initialized) {
      this.apply(`handler:${id}`)
    }
  }

  getAccelerator(id: ShortcutActionId) {
    return this.bindings[id] || undefined
  }

  /** Accelerator for native menus, only when the shortcut is actually live. */
  getMenuAccelerator(id: ShortcutActionId) {
    return this.statuses.get(id)?.state === 'registered' ? this.bindings[id] : undefined
  }

  getStatus(): ShortcutStatus[] {
    return shortcutActionIds.map(
      (id) =>
        this.statuses.get(id) ?? {
          id,
          accelerator: this.bindings[id],
          state: this.bindings[id] ? 'failed' : 'disabled',
        }
    )
  }

  /** Pause all shortcuts while the settings page records a new key combo. */
  setSuspended(suspended: boolean) {
    if (this.suspendFailsafeTimer) {
      clearTimeout(this.suspendFailsafeTimer)
      this.suspendFailsafeTimer = null
    }
    if (suspended) {
      // If the settings window goes away mid-recording, never leave shortcuts dead.
      this.suspendFailsafeTimer = setTimeout(() => this.setSuspended(false), 60_000)
    }
    if (this.suspended === suspended) return
    this.suspended = suspended
    this.apply(suspended ? 'suspend' : 'resume')
  }

  dispose() {
    if (this.suspendFailsafeTimer) {
      clearTimeout(this.suspendFailsafeTimer)
      this.suspendFailsafeTimer = null
    }
    this.detachSettingsListener?.()
    this.detachSettingsListener = null
    this.unregisterAll()
    this.handlers.clear()
    this.initialized = false
  }

  private unregisterAll() {
    for (const accelerator of this.registered.values()) {
      globalShortcut.unregister(accelerator)
    }
    this.registered.clear()
  }

  private apply(reason: string) {
    this.unregisterAll()
    const statuses = new Map<ShortcutActionId, ShortcutStatus>()
    const claimed = new Set<string>()

    for (const id of shortcutActionIds) {
      const accelerator = this.bindings[id]
      const handler = this.handlers.get(id)

      if (!accelerator) {
        statuses.set(id, { id, accelerator, state: 'disabled' })
        continue
      }

      if (this.suspended) {
        statuses.set(id, { id, accelerator, state: 'suspended' })
        continue
      }

      const canonical = canonicalizeAccelerator(accelerator, isMac)
      if (claimed.has(canonical)) {
        statuses.set(id, { id, accelerator, state: 'conflict' })
        continue
      }

      if (!handler) {
        // Handler not wired yet (feature still starting). Reported as failed until it arrives.
        statuses.set(id, { id, accelerator, state: 'failed' })
        continue
      }

      let registered = false
      try {
        registered = globalShortcut.register(accelerator, () => {
          mainLogger.info('[shortcut] triggered', { id, accelerator })
          handler()
        })
      } catch (error) {
        mainLogger.warn('[shortcut] invalid accelerator', { id, accelerator, error: String(error) })
      }

      if (registered) {
        this.registered.set(id, accelerator)
        claimed.add(canonical)
      }
      statuses.set(id, { id, accelerator, state: registered ? 'registered' : 'failed' })
    }

    this.statuses = statuses
    mainLogger.info('[shortcut] apply', {
      reason,
      suspended: this.suspended,
      shortcuts: Object.fromEntries(
        [...statuses.values()].map((status) => [status.id, `${status.accelerator || '-'}:${status.state}`])
      ),
    })
  }
}

export const shortcutManager = new ShortcutManager()
