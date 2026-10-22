// Link previews for link cards: when a link is copied, the page is loaded once in a hidden offscreen window,
// a screenshot of its first screen is saved with the page title / description, and the panel shows it on cards
// that are on screen. Old links are fetched the first time their card scrolls into view.
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, session, type Session } from 'electron'
import { clipboardEvents } from '@/lib/clipboard/events'
import { getClipDirs } from '@/lib/clipboard/store/paths'
import { CLIP_PROTOCOL, type ClipLinkPreview } from '@/lib/clipboard/types'
import { mainLogger } from '@/lib/main/logger'

const PARTITION = 'popmind-link-preview'
const VIEWPORT = { width: 1280, height: 800 }
const IMAGE_WIDTH = 640
const LOAD_TIMEOUT_MS = 8_000
/** Lets late layout, fonts and lazy images settle after `load`. */
const SETTLE_MS = 1200
const RETRY_FAILED_AFTER_MS = 6 * 60 * 60 * 1000
const MAX_QUEUE = 30
const MAX_TEXT = 300

/** Query keys and paths of links that do something when opened (log in, confirm, unsubscribe …). */
const SENSITIVE_QUERY_KEY =
  /^(?:.*token.*|code|key|api[_-]?key|secret|sig|signature|x-amz-.*|password|passwd|pwd|auth.*|session.*|sid|otp|magic.*|ticket|nonce|state|invite.*)$/i
const SENSITIVE_PATH =
  /\/(?:log-?out|sign-?out|unsubscribe|reset|verify|confirm|activate|magic|callback|oauth2?|authorize|approve|delete)(?:[/?#.]|$)/i

type StoredPreview = Omit<ClipLinkPreview, 'imageUrl'> & { hasImage?: boolean }

const keyOf = (url: string) => createHash('sha256').update(url).digest('hex').slice(0, 32)

let previewDir: string | null = null
const getPreviewDir = () => {
  if (!previewDir) {
    previewDir = join(getClipDirs(app.getPath('userData')).root, 'link-previews')
    mkdirSync(previewDir, { recursive: true })
  }
  return previewDir
}

const metaPath = (key: string) => join(getPreviewDir(), `${key}.json`)
const imagePathOf = (key: string) => join(getPreviewDir(), `${key}.jpg`)

const toPublic = (key: string, stored: StoredPreview): ClipLinkPreview => {
  const { hasImage, ...rest } = stored
  return { ...rest, imageUrl: hasImage ? `${CLIP_PROTOCOL}://link-preview/${key}?v=${stored.fetchedAt}` : undefined }
}

/** localhost, *.local and private / loopback / link-local IP literals: local services are never opened. */
const isLocalHost = (hostname: string) => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0') return true
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    return (
      a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
    )
  }
  return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || host.startsWith('fe80:')
}

/** Why a link is not previewed, or null when it may be. */
export const linkPreviewSkipReason = (rawUrl: string): string | null => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'invalid-url'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'scheme'
  if (url.username || url.password) return 'credentials'
  if (isLocalHost(url.hostname)) return 'local-host'
  for (const name of url.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(name)) return 'sensitive-query'
  }
  if (SENSITIVE_PATH.test(url.pathname)) return 'sensitive-path'
  return null
}

let configuredSession: Session | null = null
const getPreviewSession = () => {
  if (configuredSession) return configuredSession
  // In-memory partition: no cookies or logins of other windows, nothing kept on disk.
  const previewSession = session.fromPartition(PARTITION, { cache: false })
  previewSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  previewSession.setPermissionCheckHandler(() => false)
  previewSession.on('will-download', (event) => event.preventDefault())
  // Some sites refuse unknown browsers; look like plain Chrome.
  previewSession.setUserAgent(
    previewSession
      .getUserAgent()
      .replace(/\s(?:Electron|popMind|popmind)\/\S+/gi, '')
      .trim()
  )
  configuredSession = previewSession
  return previewSession
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const EXTRACT_META = `(() => {
  const pick = (selector) => document.querySelector(selector)?.getAttribute('content') || ''
  return {
    title: pick('meta[property="og:title"]') || document.title || '',
    description: pick('meta[property="og:description"]') || pick('meta[name="description"]') || '',
    siteName: pick('meta[property="og:site_name"]') || '',
  }
})()`

class SkippedError extends Error {}

const clean = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) || undefined : undefined

/** Loads the page offscreen, saves a screenshot of its first screen and returns what was stored. */
const capture = async (url: string, key: string): Promise<StoredPreview> => {
  const window = new BrowserWindow({
    show: false,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    webPreferences: {
      offscreen: true,
      session: getPreviewSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  const contents = window.webContents
  contents.setAudioMuted(true)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.setFrameRate(10)

  let status = 0
  let blocked: string | null = null
  contents.on('did-navigate', (_event, _url, httpResponseCode) => {
    status = httpResponseCode
  })
  // A short link may redirect (or a page may navigate itself) to a login / unsubscribe link: stop there.
  const guard = (event: Electron.Event<{ url: string; isMainFrame: boolean }>) => {
    if (!event.isMainFrame) return
    const reason = linkPreviewSkipReason(event.url)
    if (!reason) return
    blocked ??= reason
    event.preventDefault()
  }
  contents.on('will-redirect', guard)
  contents.on('will-navigate', guard)

  try {
    const loaded = await Promise.race([
      contents.loadURL(url).then(
        () => 'loaded' as const,
        (error: unknown) => {
          // A blocked redirect fails the load (ERR_FAILED); report it as skipped below, not as a failure.
          if (blocked) throw new SkippedError(`redirect:${blocked}`)
          // A redirect aborts the first navigation; the final page still loads.
          if (error instanceof Error && error.message.includes('ERR_ABORTED')) return 'aborted' as const
          throw error
        }
      ),
      wait(LOAD_TIMEOUT_MS).then(() => 'timeout' as const),
    ])
    if (loaded === 'aborted') {
      await Promise.race([
        new Promise<void>((resolve) => contents.once('did-stop-loading', () => resolve())),
        wait(LOAD_TIMEOUT_MS),
      ])
    }
    if (blocked) throw new SkippedError(`redirect:${blocked}`)
    // No committed navigation (timeout before any response): a screenshot would only be a blank page.
    if (status === 0) throw new Error(`no response (${loaded})`)
    if (status >= 400) throw new Error(`HTTP ${status}`)
    await wait(SETTLE_MS)

    const meta = (await Promise.race([
      contents.executeJavaScript(EXTRACT_META, true),
      wait(2000).then(() => ({})),
    ]).catch(() => ({}))) as Record<string, unknown>
    const image = await contents.capturePage({ x: 0, y: 0, ...VIEWPORT })
    const hasImage = !image.isEmpty()
    if (hasImage) {
      const tempPath = `${imagePathOf(key)}.tmp`
      await writeFile(tempPath, image.resize({ width: IMAGE_WIDTH, quality: 'good' }).toJPEG(78))
      await rename(tempPath, imagePathOf(key))
    }

    return {
      url,
      status: 'ready',
      title: clean(meta.title),
      description: clean(meta.description),
      siteName: clean(meta.siteName),
      hasImage,
      fetchedAt: Date.now(),
    }
  } finally {
    window.destroy()
  }
}

class LinkPreviewService {
  /** Copied links, first in first out; they always go before visible cards. */
  private copyQueue: string[] = []
  /** Cards that scrolled into view, newest first: the oldest requests are usually off screen again. */
  private visibleQueue: string[] = []
  private queued = new Set<string>()
  private running = false
  private memory = new Map<string, StoredPreview>()

  /** Stored preview of a link, or null when it has none yet. */
  async get(url: string): Promise<ClipLinkPreview | null> {
    const key = keyOf(url)
    const stored = await this.read(key)
    return stored ? toPublic(key, stored) : null
  }

  /**
   * Returns the stored preview, or schedules a fetch and returns `pending` (a `link-preview` event follows).
   * `skipped` links are never fetched.
   */
  async request(url: string, reason: 'copy' | 'visible'): Promise<ClipLinkPreview> {
    const key = keyOf(url)
    const stored = await this.read(key)
    const retry = stored?.status === 'failed' && Date.now() - stored.fetchedAt > RETRY_FAILED_AFTER_MS
    if (stored && !retry) return toPublic(key, stored)

    const skipReason = linkPreviewSkipReason(url)
    if (skipReason) {
      const skipped: StoredPreview = { url, status: 'skipped', fetchedAt: Date.now() }
      this.memory.set(key, skipped)
      mainLogger.info('[link-preview] skipped', { reason: skipReason, host: safeHost(url), trigger: reason })
      return toPublic(key, skipped)
    }

    this.enqueue(url, reason)
    return { url, status: 'pending', fetchedAt: Date.now() }
  }

  /** Path of a stored screenshot for the protocol handler; `key` is validated by the caller. */
  imagePath(key: string) {
    return /^[0-9a-f]{32}$/.test(key) ? imagePathOf(key) : null
  }

  private async read(key: string): Promise<StoredPreview | null> {
    const cached = this.memory.get(key)
    if (cached) return cached
    try {
      const stored = JSON.parse(await readFile(metaPath(key), 'utf8')) as StoredPreview
      this.memory.set(key, stored)
      return stored
    } catch {
      return null
    }
  }

  /** Deletes every stored preview (history cleared); previews of kept links are fetched again when shown. */
  async clearAll() {
    this.memory.clear()
    const dir = getPreviewDir()
    const files = await readdir(dir).catch(() => [] as string[])
    await Promise.all(files.map((file) => rm(join(dir, file), { force: true })))
    mainLogger.info('[link-preview] cleared', { files: files.length })
  }

  private enqueue(url: string, reason: 'copy' | 'visible') {
    if (this.queued.has(url)) {
      if (reason !== 'copy') return
      // A copy of a link already waiting as a visible card moves it to the front.
      this.visibleQueue = this.visibleQueue.filter((queuedUrl) => queuedUrl !== url)
      if (this.copyQueue.includes(url)) return
    }
    if (reason === 'copy') this.copyQueue.push(url)
    else this.visibleQueue.unshift(url)
    this.queued.add(url)

    while (this.copyQueue.length + this.visibleQueue.length > MAX_QUEUE && this.visibleQueue.length > 0) {
      const dropped = this.visibleQueue.pop() as string
      this.queued.delete(dropped)
      // Not stored: tells the panel to ask again when the card shows up next time.
      clipboardEvents.emit('link-preview', { url: dropped, status: 'failed', fetchedAt: 0 })
    }
    void this.drain()
  }

  private async drain() {
    if (this.running) return
    this.running = true
    try {
      while (this.copyQueue.length + this.visibleQueue.length > 0) {
        const url = (this.copyQueue.shift() ?? this.visibleQueue.shift()) as string
        const key = keyOf(url)
        const startedAt = performance.now()
        let stored: StoredPreview
        try {
          stored = await capture(url, key)
          mainLogger.info('[link-preview] captured', {
            host: safeHost(url),
            hasImage: stored.hasImage,
            hasTitle: Boolean(stored.title),
            ms: Math.round(performance.now() - startedAt),
          })
        } catch (error) {
          stored = { url, status: error instanceof SkippedError ? 'skipped' : 'failed', fetchedAt: Date.now() }
          mainLogger.warn(`[link-preview] ${stored.status}`, {
            host: safeHost(url),
            error: String(error).slice(0, 200),
            ms: Math.round(performance.now() - startedAt),
          })
        }

        this.memory.set(key, stored)
        await writeFile(metaPath(key), JSON.stringify(stored)).catch((error: unknown) =>
          mainLogger.warn('[link-preview] could not save', { error: String(error) })
        )
        this.queued.delete(url)
        clipboardEvents.emit('link-preview', toPublic(key, stored))
      }
    } finally {
      this.running = false
    }
  }
}

const safeHost = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export const linkPreviews = new LinkPreviewService()
