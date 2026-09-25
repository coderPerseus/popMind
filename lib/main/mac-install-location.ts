import { execFile, spawn } from 'node:child_process'
import { readdir, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { app, shell } from 'electron'
import { compareReleaseVersions } from '@/lib/app/release'
import { mainLogger } from '@/lib/main/logger'

const execFileAsync = promisify(execFile)

const APPLICATIONS_DIR = '/Applications'
const TARGET_BUNDLE_NAME = 'popMind.app'
const TARGET_BUNDLE_PATH = join(APPLICATIONS_DIR, TARGET_BUNDLE_NAME)

type BundleInfo = {
  path: string
  bundleId: string | null
  version: string | null
}

const getCurrentBundlePath = () => dirname(dirname(dirname(process.execPath)))

const readPlistValue = async (bundlePath: string, key: string) => {
  try {
    const { stdout } = await execFileAsync('plutil', [
      '-extract',
      key,
      'raw',
      '-o',
      '-',
      join(bundlePath, 'Contents', 'Info.plist'),
    ])
    return stdout.trim() || null
  } catch {
    return null
  }
}

const readBundleInfo = async (bundlePath: string): Promise<BundleInfo> => ({
  path: bundlePath,
  bundleId: await readPlistValue(bundlePath, 'CFBundleIdentifier'),
  version: await readPlistValue(bundlePath, 'CFBundleShortVersionString'),
})

/** Other popMind copies in /Applications, e.g. "popMind 2.app" left by unzipping a release next to an older one. */
const findOtherInstalledCopies = async (bundleId: string, currentPath: string) => {
  let entries: string[] = []
  try {
    entries = await readdir(APPLICATIONS_DIR)
  } catch {
    return []
  }

  const candidates = entries
    .filter((name) => name.startsWith('popMind') && name.endsWith('.app'))
    .map((name) => join(APPLICATIONS_DIR, name))
    .filter((path) => path !== currentPath)

  const infos = await Promise.all(candidates.map(readBundleInfo))
  return infos.filter((info) => info.bundleId === bundleId)
}

const stopInstancesOf = async (bundlePath: string) => {
  const executablePath = join(bundlePath, 'Contents', 'MacOS', basename(process.execPath))
  const findPids = async () => {
    try {
      const { stdout } = await execFileAsync('pgrep', ['-f', executablePath])
      return stdout
        .split('\n')
        .map((line) => Number.parseInt(line.trim(), 10))
        .filter((pid) => Number.isFinite(pid) && pid !== process.pid)
    } catch {
      return []
    }
  }

  const signal = (pids: number[], name: NodeJS.Signals) => {
    for (const pid of pids) {
      try {
        process.kill(pid, name)
      } catch {
        // already exited
      }
    }
  }

  let pids = await findPids()
  if (!pids.length) return

  mainLogger.info('[install] stopping running copy', { bundlePath, pids })
  signal(pids, 'SIGTERM')
  for (let attempt = 0; attempt < 15 && pids.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    pids = await findPids()
  }
  signal(pids, 'SIGKILL')
}

const trashBundle = async (bundlePath: string) => {
  await stopInstancesOf(bundlePath)
  try {
    await shell.trashItem(bundlePath)
    mainLogger.info('[install] moved duplicate copy to Trash', { bundlePath })
  } catch (error) {
    mainLogger.warn('[install] failed to trash duplicate copy', { bundlePath, error: String(error) })
  }
}

// app.relaunch() starts its relauncher from the current executable path, which no
// longer exists once the bundle has been renamed. Open the new location from a
// detached shell after this process has fully exited instead.
const openAfterExit = (bundlePath: string) => {
  spawn(
    '/bin/sh',
    ['-c', 'while kill -0 "$0" 2>/dev/null; do sleep 0.2; done; /usr/bin/open "$1"', String(process.pid), bundlePath],
    {
      detached: true,
      stdio: 'ignore',
    }
  ).unref()
  app.exit(0)
}

/**
 * Keep exactly one popMind at /Applications/popMind.app, however it was installed.
 * Unzipping a release next to an older copy produces "popMind 2.app", "popMind 3.app"...
 * and moving that into /Applications keeps the numbered name, so the user ends up
 * with several copies. Runs after the app is already inside /Applications.
 *
 * Returns false when the app is relaunching from the canonical location.
 */
export const normalizeMacInstallLocation = async () => {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return true
  }

  const currentPath = getCurrentBundlePath()
  if (dirname(currentPath) !== APPLICATIONS_DIR) {
    // Outside /Applications (Downloads, ~/Applications, translocated): handled by the move prompt.
    return true
  }

  const current = await readBundleInfo(currentPath)
  if (!current.bundleId) {
    return true
  }

  try {
    const otherCopies = await findOtherInstalledCopies(current.bundleId, currentPath)

    if (currentPath === TARGET_BUNDLE_PATH) {
      for (const copy of otherCopies) {
        await trashBundle(copy.path)
      }
      return true
    }

    const target = otherCopies.find((copy) => copy.path === TARGET_BUNDLE_PATH)
    if (target?.version && current.version && compareReleaseVersions(target.version, current.version) > 0) {
      // An older numbered copy was opened while a newer popMind.app is installed.
      mainLogger.info('[install] newer canonical copy exists, switching to it', {
        currentPath,
        currentVersion: current.version,
        targetVersion: target.version,
      })
      await shell.trashItem(currentPath).catch(() => undefined)
      openAfterExit(TARGET_BUNDLE_PATH)
      return false
    }

    mainLogger.info('[install] renaming app to canonical location', {
      from: currentPath,
      to: TARGET_BUNDLE_PATH,
      version: current.version,
      replacing: target?.version ?? null,
    })

    if (target) {
      await trashBundle(target.path)
    }
    await rename(currentPath, TARGET_BUNDLE_PATH)

    for (const copy of otherCopies) {
      if (copy.path !== TARGET_BUNDLE_PATH) {
        await trashBundle(copy.path)
      }
    }

    openAfterExit(TARGET_BUNDLE_PATH)
    return false
  } catch (error) {
    mainLogger.warn('[install] failed to normalize install location', { currentPath, error: String(error) })
    return true
  }
}
