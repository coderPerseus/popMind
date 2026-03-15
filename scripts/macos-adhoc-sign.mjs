import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const ENTITLEMENTS_PATH = path.resolve(import.meta.dirname, '..', 'resources', 'build', 'entitlements.mac.plist')
const CODESIGN_ARGS = ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', ENTITLEMENTS_PATH, '--timestamp=none']
const BUNDLE_SUFFIXES = ['.app', '.framework', '.xpc']
const FILE_SUFFIXES = ['.dylib', '.node']
const IGNORE_DIRS = new Set(['_CodeSignature'])

async function listSignTargets(rootDir) {
  const targets = []
  await walk(rootDir, targets)
  targets.sort((left, right) => right.length - left.length)
  return targets
}

async function walk(currentPath, targets) {
  const entries = await readdir(currentPath, { withFileTypes: true })

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) {
      continue
    }

    const fullPath = path.join(currentPath, entry.name)

    if (entry.isDirectory()) {
      // Always recurse into directories, including bundles, to find
      // and sign inner binaries before signing the outer bundle.
      await walk(fullPath, targets)

      if (BUNDLE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
        targets.push(fullPath)
      }
      continue
    }

    if (FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
      targets.push(fullPath)
      continue
    }

    if (await isMachOExecutable(fullPath)) {
      targets.push(fullPath)
    }
  }
}

async function isMachOExecutable(filePath) {
  try {
    const { stdout } = await execFileAsync('file', ['-b', filePath])
    return stdout.includes('Mach-O')
  } catch {
    return false
  }
}

async function codesign(targetPath) {
  await execFileAsync('codesign', [...CODESIGN_ARGS, targetPath])
}

async function verify(appPath) {
  await execFileAsync('codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath])
}

async function resolveAppPath(appOutDir) {
  const entries = await readdir(appOutDir, { withFileTypes: true })
  const appEntry = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'))

  if (!appEntry) {
    throw new Error(`[macos-adhoc-sign] .app bundle not found in ${appOutDir}`)
  }

  return path.join(appOutDir, appEntry.name)
}

export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  const appPath = await resolveAppPath(context.appOutDir)
  const targets = await listSignTargets(appPath)

  for (const target of targets) {
    await codesign(target)
  }

  await codesign(appPath)
  await verify(appPath)
}
