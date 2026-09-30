// Background enrichment queue. Jobs live in the enrich_jobs table (survive restarts); each job type has its
// own lane with concurrency 1, and lanes back off after ingest so capture stays responsive.
import { ensureAppMeta, isAppKnown, markAppKnown } from '@/lib/clipboard/enrich/app-meta'
import { recognizeImageText } from '@/lib/clipboard/enrich/ocr'
import { ensureThumbnail } from '@/lib/clipboard/enrich/thumbnail'
import { computeLocalTags } from '@/lib/clipboard/search'
import { clipStore } from '@/lib/clipboard/store'
import type { ClipEnrichJob, ClipEnrichTask } from '@/lib/clipboard/store/contract'
import type { ClipboardSettings } from '@/lib/clipboard/types'
import { mainLogger } from '@/lib/main/logger'

const LANES: ClipEnrichJob[] = ['thumbnail', 'ocr', 'local_tags']
const START_DELAY_MS = 3_000
const AFTER_INGEST_DELAY_MS: Record<string, number> = { thumbnail: 400, ocr: 1_500, local_tags: 2_000 }
const BETWEEN_TASKS_MS = 150
const AFTER_FAILURE_MS = 2_000
const SAFETY_WAKE_MS = 60_000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type TaskResult = { ocrText?: string; tags?: string[] }

const runTask = async (task: ClipEnrichTask): Promise<TaskResult> => {
  switch (task.job) {
    case 'thumbnail': {
      if (!task.imagePath) {
        throw new Error('image file missing')
      }
      await ensureThumbnail(task.imagePath)
      return {}
    }
    case 'ocr': {
      if (!task.imagePath) {
        throw new Error('image file missing')
      }
      const ocrText = await recognizeImageText(task.itemId, task.imagePath)
      return { ocrText, tags: ocrText ? computeLocalTags(ocrText).tags : undefined }
    }
    case 'local_tags': {
      return { tags: task.plainText ? computeLocalTags(task.plainText).tags : [] }
    }
    default:
      return {}
  }
}

export class EnrichQueue {
  private getSettings: (() => ClipboardSettings) | null = null
  private running = new Set<ClipEnrichJob>()
  private timers = new Map<ClipEnrichJob, NodeJS.Timeout>()
  private safetyTimer: NodeJS.Timeout | null = null
  private stopped = true

  start(getSettings: () => ClipboardSettings) {
    this.getSettings = getSettings
    this.stopped = false

    clipStore
      .listApps()
      .then((apps) => apps.filter((app) => app.color).forEach((app) => markAppKnown(app.bundleId)))
      .catch((error: unknown) => mainLogger.warn('[clip-enrich] could not load known apps', String(error)))

    LANES.forEach((job) => this.wake(job, START_DELAY_MS))
    this.safetyTimer = setInterval(() => LANES.forEach((job) => this.wake(job, 0)), SAFETY_WAKE_MS)
    this.safetyTimer.unref()
    mainLogger.info('[clip-enrich] queue started')
  }

  stop() {
    this.stopped = true
    this.timers.forEach((timer) => clearTimeout(timer))
    this.timers.clear()
    if (this.safetyTimer) {
      clearInterval(this.safetyTimer)
      this.safetyTimer = null
    }
  }

  /** Called after each ingest: schedules lanes shortly after capture went quiet. */
  notifyIngest(source?: { bundleId: string; name: string }) {
    if (this.stopped) {
      return
    }

    LANES.forEach((job) => this.wake(job, AFTER_INGEST_DELAY_MS[job] ?? 1_000))

    if (source && !isAppKnown(source.bundleId)) {
      // App metadata is not a persisted job type; it is cheap and idempotent per bundle id.
      markAppKnown(source.bundleId)
      setTimeout(() => void ensureAppMeta(source), 300)
    }
  }

  private wake(job: ClipEnrichJob, delayMs: number) {
    if (this.stopped) {
      return
    }

    const existing = this.timers.get(job)
    if (existing) {
      clearTimeout(existing)
    }

    const timer = setTimeout(() => {
      this.timers.delete(job)
      void this.drain(job)
    }, delayMs)
    timer.unref()
    this.timers.set(job, timer)
  }

  private isLaneEnabled(job: ClipEnrichJob) {
    return job !== 'ocr' || Boolean(this.getSettings?.().ocr.enabled)
  }

  private async drain(job: ClipEnrichJob) {
    if (this.running.has(job)) {
      return
    }

    this.running.add(job)
    try {
      while (!this.stopped && this.isLaneEnabled(job)) {
        const [task] = await clipStore.takeEnrichTasks(job, 1)
        if (!task) {
          break
        }

        const started = performance.now()
        let failed = false
        try {
          const result = await runTask(task)
          await clipStore.completeEnrichTask(task.itemId, job, { ok: true, ...result })
          mainLogger.info('[clip-enrich] task done', {
            job,
            itemId: task.itemId,
            attempts: task.attempts,
            ms: Math.round(performance.now() - started),
          })
        } catch (error) {
          failed = true
          const message = error instanceof Error ? error.message : String(error)
          mainLogger.warn('[clip-enrich] task failed', {
            job,
            itemId: task.itemId,
            attempts: task.attempts,
            error: message,
          })
          await clipStore.completeEnrichTask(task.itemId, job, { ok: false, error: message })
        }

        await sleep(failed ? AFTER_FAILURE_MS : BETWEEN_TASKS_MS)
      }
    } catch (error) {
      mainLogger.warn('[clip-enrich] lane stopped after error', { job, error: String(error) })
    } finally {
      this.running.delete(job)
    }
  }
}

export const enrichQueue = new EnrichQueue()
