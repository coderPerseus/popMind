import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { app } from 'electron'
import type {
  SelectionActionEvent,
  SelectionBridge,
  SelectionSceneValue,
  SelectionSnapshot,
} from '@/lib/text-picker/shared'

interface NativeSelectionBridgeModule {
  checkPermission(prompt?: boolean): boolean
  getSelectionSnapshot(options?: { scene?: SelectionSceneValue | string }): SelectionSnapshot
  getTextByClipboardAsync(useMenu: boolean, pid: number): Promise<string>
  startActionMonitor(callback: (event: SelectionActionEvent) => void): boolean
  stopActionMonitor(): boolean
  getCursorPosition(): { x: number; y: number }
  getFrontmostAppInfo(): { bundleId: string; name: string; pid: number }
  configureBubbleWindow(nativeHandle: Buffer): boolean
  orderBubbleFront(nativeHandle: Buffer): boolean
  setActivationPolicy(policy: number): boolean
}

const require = createRequire(import.meta.url)

const createStub = (): SelectionBridge => ({
  isSupported: false,
  checkPermission: () => false,
  getSelectionSnapshot: () => ({
    text: '',
    sourceApp: '',
    sourceBundleId: '',
    hasRect: false,
    error: 'unsupported_platform',
  }),
  getTextByClipboardAsync: () => Promise.resolve(''),
  startActionMonitor: () => false,
  stopActionMonitor: () => true,
  getCursorPosition: () => ({ x: 0, y: 0 }),
  getFrontmostAppInfo: () => ({ bundleId: '', name: '', pid: -1 }),
  configureBubbleWindow: () => false,
  orderBubbleFront: () => false,
  setActivationPolicy: () => false,
})

const resolveAddonPath = (): string | null => {
  const candidates = [
    resolve(process.cwd(), 'build/Release/selection_bridge.node'),
    resolve(process.resourcesPath, 'app.asar.unpacked/build/Release/selection_bridge.node'),
  ]

  try {
    candidates.push(resolve(app.getAppPath(), 'build/Release/selection_bridge.node'))
  } catch {
    // App path is unavailable before Electron finishes bootstrapping.
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const loadNativeModule = (): NativeSelectionBridgeModule | null => {
  if (process.platform !== 'darwin') {
    return null
  }

  const addonPath = resolveAddonPath()
  if (!addonPath) {
    console.error('[selection-bridge] native addon not found')
    return null
  }

  try {
    return require(addonPath) as NativeSelectionBridgeModule
  } catch (error) {
    console.error('[selection-bridge] failed to load native addon:', error)
    return null
  }
}

const nativeModule = loadNativeModule()

export const selectionBridge: SelectionBridge = nativeModule
  ? {
      isSupported: true,
      checkPermission(prompt = false) {
        return Boolean(nativeModule.checkPermission(Boolean(prompt)))
      },
      getSelectionSnapshot(scene = null) {
        if (typeof scene === 'string' && scene.length > 0) {
          return nativeModule.getSelectionSnapshot({ scene })
        }

        return nativeModule.getSelectionSnapshot()
      },
      getTextByClipboardAsync(useMenu, pid) {
        return nativeModule.getTextByClipboardAsync(useMenu, pid)
      },
      startActionMonitor(callback) {
        return Boolean(nativeModule.startActionMonitor(callback))
      },
      stopActionMonitor() {
        return Boolean(nativeModule.stopActionMonitor())
      },
      getCursorPosition() {
        return nativeModule.getCursorPosition()
      },
      getFrontmostAppInfo() {
        return nativeModule.getFrontmostAppInfo()
      },
      configureBubbleWindow(nativeHandle) {
        return Boolean(nativeModule.configureBubbleWindow(nativeHandle))
      },
      orderBubbleFront(nativeHandle) {
        return Boolean(nativeModule.orderBubbleFront(nativeHandle))
      },
      setActivationPolicy(policy) {
        return Boolean(nativeModule.setActivationPolicy(policy))
      },
    }
  : createStub()
