import type { SelectionBridge } from '@/lib/text-picker/shared'
import { nativeMacOSAddon } from '@/lib/native/macos-addon'

const createStub = (): SelectionBridge => ({
  isSupported: false,
  checkPermission: () => false,
  getSelectionSnapshot: () => ({
    text: '',
    sourceApp: '',
    sourceBundleId: '',
    sourceAppPid: -1,
    hasRect: false,
    error: 'unsupported_platform',
  }),
  getTextByClipboardAsync: () => Promise.resolve(''),
  copySelectionAsync: () => Promise.resolve(false),
  captureFrontmostWindowImage: () => null,
  startActionMonitor: () => false,
  stopActionMonitor: () => true,
  setKeyMonitorEnabled: () => false,
  getCursorPosition: () => ({ x: 0, y: 0 }),
  getFrontmostAppInfo: () => ({ bundleId: '', name: '', pid: -1 }),
  getClipboardChangeCount: () => -1,
  getClipboardSnapshot: () => [],
  restoreClipboardSnapshot: () => false,
  activateAppAndPaste: () => false,
  configureBubbleWindow: () => false,
  orderBubbleFront: () => false,
  setActivationPolicy: () => false,
})
const nativeModule = nativeMacOSAddon

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
      copySelectionAsync(useMenu, pid, expectedText) {
        return nativeModule.copySelectionAsync(useMenu, pid, expectedText)
      },
      captureFrontmostWindowImage(pid) {
        return nativeModule.captureFrontmostWindowImage(pid)
      },
      startActionMonitor(callback) {
        return Boolean(nativeModule.startActionMonitor(callback))
      },
      stopActionMonitor() {
        return Boolean(nativeModule.stopActionMonitor())
      },
      setKeyMonitorEnabled(enabled) {
        return Boolean(nativeModule.setKeyMonitorEnabled(Boolean(enabled)))
      },
      getCursorPosition() {
        return nativeModule.getCursorPosition()
      },
      getFrontmostAppInfo() {
        return nativeModule.getFrontmostAppInfo()
      },
      getClipboardChangeCount() {
        return nativeModule.getClipboardChangeCount()
      },
      getClipboardSnapshot() {
        return nativeModule.getClipboardSnapshot()
      },
      restoreClipboardSnapshot(items) {
        return Boolean(nativeModule.restoreClipboardSnapshot(items))
      },
      activateAppAndPaste(pid) {
        return Boolean(nativeModule.activateAppAndPaste(pid))
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
