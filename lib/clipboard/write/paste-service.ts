// Direct paste flow (spec §5.5), written against injected dependencies so the decision logic is unit testable.
// Real wiring lives in write/index.ts.
import type { ClipboardSettings, ClipPasteMode, ClipPasteResult, ClipWriteResult } from '@/lib/clipboard/types'
import type { NativePasteKeystrokeResult } from '@/lib/native/macos-addon'

/** The app that was frontmost when the panel opened and should receive the paste. */
export type PasteTarget = {
  pid: number
  bundleId: string
  name: string
}

export type PasteServiceDeps = {
  getSettings: () => Pick<ClipboardSettings, 'directPaste'>
  /** Puts the items on the pasteboard (writer). */
  writeItems: (ids: string[], mode: ClipPasteMode) => Promise<ClipWriteResult>
  getTarget: () => PasteTarget | null
  /** Hides the panel immediately (no renderer round trip). */
  hidePanel: (reason: string) => void
  markUsed: (id: string) => Promise<void>
  native: {
    isAccessibilityTrusted: () => boolean
    isSecureInputEnabled: () => boolean
    getFrontmostApp: () => { pid: number } | null
    postPasteKeystroke: () => NativePasteKeystrokeResult
    activateAppAndPaste: (pid: number) => boolean
  }
  sleep: (ms: number) => Promise<void>
  now: () => number
  log: (message: string, details?: Record<string, unknown>) => void
  /** Time for the panel to disappear and key focus to settle back to the target app. */
  hideSettleMs?: number
}

export type PasteService = {
  paste: (ids: string[], mode: ClipPasteMode) => Promise<ClipPasteResult>
}

const DEFAULT_HIDE_SETTLE_MS = 60

export const createPasteService = (deps: PasteServiceDeps): PasteService => {
  const settleMs = deps.hideSettleMs ?? DEFAULT_HIDE_SETTLE_MS
  // Rapid repeated Enter presses must not interleave write / hide / keystroke steps.
  let chain: Promise<unknown> = Promise.resolve()

  const run = async (ids: string[], mode: ClipPasteMode): Promise<ClipPasteResult> => {
    const startedAt = deps.now()
    const steps: Record<string, number> = {}
    const mark = (name: string) => {
      steps[name] = deps.now() - startedAt
    }
    const finish = (result: ClipPasteResult, extra: Record<string, unknown> = {}) => {
      mark('totalMs')
      deps.log('[clip-paste] result', { ids: ids.length, mode, ...result, steps, ...extra })
      return result
    }

    deps.log('[clip-paste] start', { ids: ids.length, mode })

    let written: ClipWriteResult
    try {
      written = await deps.writeItems(ids, mode)
    } catch (error) {
      deps.log('[clip-paste] write threw', { error: String(error) })
      written = { ok: false, reason: 'write_failed' }
    }
    mark('writeMs')
    if (!written.ok) {
      return finish({ ok: false, action: 'none', reason: written.reason ?? 'write_failed' })
    }

    if (!deps.getSettings().directPaste) {
      return finish({ ok: true, action: 'copied' }, { why: 'direct-paste-off' })
    }

    if (!deps.native.isAccessibilityTrusted()) {
      return finish({ ok: true, action: 'copied', reason: 'no_permission' })
    }

    if (deps.native.isSecureInputEnabled()) {
      return finish({ ok: true, action: 'copied', reason: 'secure_input' })
    }

    const target = deps.getTarget()
    if (!target) {
      return finish({ ok: true, action: 'copied', reason: 'no_target' })
    }

    deps.hidePanel('paste')
    await deps.sleep(settleMs)
    mark('hideMs')

    const frontmost = deps.native.getFrontmostApp()
    let pasted = false
    let reason: ClipPasteResult['reason']

    if (!frontmost || frontmost.pid !== target.pid) {
      // The panel could not keep the target app frontmost (e.g. opened from the launcher): activate it ourselves.
      deps.log('[clip-paste] target not frontmost, activating', {
        target: target.bundleId,
        targetPid: target.pid,
        frontmostPid: frontmost?.pid ?? null,
      })
      pasted = deps.native.activateAppAndPaste(target.pid)
      reason = pasted ? undefined : 'no_target'
      mark('activatePasteMs')
    } else {
      const keystroke = deps.native.postPasteKeystroke()
      pasted = keystroke.ok
      reason = keystroke.ok ? undefined : (keystroke.reason ?? 'no_permission')
      mark('keystrokeMs')
    }

    if (!pasted) {
      return finish({ ok: true, action: 'copied', reason }, { target: target.bundleId })
    }

    for (const id of ids) {
      void deps.markUsed(id).catch((error) => {
        deps.log('[clip-paste] markUsed failed', { id, error: String(error) })
      })
    }

    return finish({ ok: true, action: 'pasted' }, { target: target.bundleId })
  }

  return {
    paste: (ids, mode) => {
      const next = chain.then(
        () => run(ids, mode),
        () => run(ids, mode)
      )
      chain = next.catch(() => undefined)
      return next
    },
  }
}
