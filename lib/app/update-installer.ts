import { app, BrowserWindow, net, shell } from 'electron'
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { mainLogger } from '@/lib/main/logger'
import { fetchLatestRelease } from './latest-release'
import {
  UPDATE_DOWNLOAD_STATE_CHANNEL,
  compareReleaseVersions,
  getReleasePkgFileName,
  type LatestReleaseInfo,
  type UpdateDownloadState,
} from './release'

const PROGRESS_BROADCAST_INTERVAL_MS = 200

let state: UpdateDownloadState = { status: 'idle' }
let currentTask: Promise<UpdateDownloadState> | null = null

const getUpdatesDir = () => join(app.getPath('temp'), 'popMind-updates')

const setState = (next: UpdateDownloadState) => {
  state = next

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(UPDATE_DOWNLOAD_STATE_CHANNEL, next)
    }
  }
}

const getFileSize = async (filePath: string) => {
  try {
    return (await stat(filePath)).size
  } catch {
    return null
  }
}

/** Removes installers of other versions and unfinished downloads left by earlier runs. */
const cleanupStaleFiles = async (dir: string, keepFileName: string) => {
  try {
    for (const name of await readdir(dir)) {
      if (name !== keepFileName) {
        await rm(join(dir, name), { force: true })
      }
    }
  } catch {
    // Directory may not exist yet.
  }
}

const downloadPkg = async (release: LatestReleaseInfo, filePath: string) => {
  const partialPath = `${filePath}.part`
  const response = await net.fetch(release.downloadUrl, { headers: { 'User-Agent': 'popMind-updater' } })

  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}`)
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
  const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : release.downloadSize
  let receivedBytes = 0
  let lastBroadcastAt = 0

  mainLogger.info('[update] download started', { url: release.downloadUrl, totalBytes, filePath })
  setState({ status: 'downloading', version: release.version, receivedBytes, totalBytes })

  const file = await open(partialPath, 'w')
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      await file.write(chunk)
      receivedBytes += chunk.byteLength

      const now = Date.now()
      if (now - lastBroadcastAt >= PROGRESS_BROADCAST_INTERVAL_MS) {
        lastBroadcastAt = now
        setState({ status: 'downloading', version: release.version, receivedBytes, totalBytes })
      }
    }
  } finally {
    await file.close()
  }

  const expectedBytes = release.downloadSize ?? totalBytes
  if (expectedBytes && receivedBytes !== expectedBytes) {
    await rm(partialPath, { force: true })
    throw new Error(`Incomplete download: received ${receivedBytes} of ${expectedBytes} bytes`)
  }

  await rename(partialPath, filePath)
  setState({ status: 'downloading', version: release.version, receivedBytes, totalBytes: receivedBytes })
  mainLogger.info('[update] download finished', { receivedBytes, filePath })
}

const runDownloadAndInstall = async (): Promise<UpdateDownloadState> => {
  if (process.platform !== 'darwin') {
    return { status: 'failed', version: null, message: 'In-app install is only supported on macOS' }
  }

  const release = await fetchLatestRelease()
  if (!release) {
    return { status: 'failed', version: null, message: 'Could not fetch the latest release' }
  }

  if (
    compareReleaseVersions(release.version, app.getVersion()) <= 0 &&
    !process.env.POPMIND_DEBUG_LATEST_RELEASE_VERSION
  ) {
    return { status: 'failed', version: release.version, message: 'Already on the latest version' }
  }

  const dir = getUpdatesDir()
  const fileName = getReleasePkgFileName(release.version)
  const filePath = join(dir, fileName)

  await mkdir(dir, { recursive: true })
  await cleanupStaleFiles(dir, fileName)

  const existingSize = await getFileSize(filePath)
  if (existingSize !== null && (release.downloadSize === null || existingSize === release.downloadSize)) {
    mainLogger.info('[update] reusing downloaded installer', { filePath, existingSize })
  } else {
    await rm(filePath, { force: true })
    await downloadPkg(release, filePath)
  }

  // The installer's preinstall script quits popMind, postinstall relaunches the new version.
  const openError = await shell.openPath(filePath)
  if (openError) {
    throw new Error(`Could not open installer: ${openError}`)
  }

  mainLogger.info('[update] installer opened', { version: release.version, filePath })
  return { status: 'installing', version: release.version, filePath }
}

export const getUpdateDownloadState = () => state

export const downloadAndInstallUpdate = () => {
  if (currentTask) {
    return currentTask
  }

  currentTask = runDownloadAndInstall()
    .catch((error: unknown): UpdateDownloadState => {
      const message = error instanceof Error ? error.message : String(error)
      mainLogger.error('[update] download and install failed', { message })
      return {
        status: 'failed',
        version: state.status === 'downloading' ? state.version : null,
        message,
      }
    })
    .then((result) => {
      if (result.status === 'failed') {
        mainLogger.warn('[update] not installed', result)
      }
      setState(result)
      return result
    })
    .finally(() => {
      currentTask = null
    })

  return currentTask
}
