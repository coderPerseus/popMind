import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { app, systemPreferences } from 'electron'
import { mainLogger } from '@/lib/main/logger'

const execFileAsync = promisify(execFile)

export interface MacCodeSigningInfo {
  appPath: string
  executablePath: string
  identifier: string | null
  signature: string | null
  teamIdentifier: string | null
  isAdhoc: boolean | null
  designatedRequirement: string | null
}

let signingInfoPromise: Promise<MacCodeSigningInfo | null> | null = null

export const getMacCodeSigningInfo = async () => {
  if (process.platform !== 'darwin') {
    return null
  }

  if (!signingInfoPromise) {
    signingInfoPromise = readMacCodeSigningInfo()
  }

  return signingInfoPromise
}

const readMacCodeSigningInfo = async (): Promise<MacCodeSigningInfo | null> => {
  const executablePath = process.execPath
  const appPath = dirname(dirname(dirname(executablePath)))

  try {
    const { stderr, stdout } = await execFileAsync('codesign', ['-dvvv', appPath])
    const output = `${stderr}\n${stdout}`
    const identifier = matchValue(output, 'Identifier')
    const signature = matchValue(output, 'Signature')
    const teamIdentifier = matchValue(output, 'TeamIdentifier')

    return {
      appPath,
      executablePath,
      identifier,
      signature,
      teamIdentifier,
      isAdhoc: signature ? signature.toLowerCase() === 'adhoc' : null,
      designatedRequirement: await readDesignatedRequirement(appPath),
    }
  } catch {
    return null
  }
}

const readDesignatedRequirement = async (appPath: string) => {
  try {
    const { stderr, stdout } = await execFileAsync('codesign', ['-d', '-r-', appPath])
    return matchValue(`${stderr}\n${stdout}`, 'designated =>', ' ')
  } catch {
    return null
  }
}

const matchValue = (output: string, key: string, separator = '=') => {
  const match = output.match(new RegExp(`^${key}${separator}(.+)$`, 'm'))
  return match?.[1]?.trim() || null
}

const signingIdentityFilePath = () => join(app.getPath('userData'), 'mac-signing-identity.json')

const readLastDesignatedRequirement = async () => {
  try {
    const content = JSON.parse(await readFile(signingIdentityFilePath(), 'utf8')) as { designatedRequirement?: unknown }
    return typeof content.designatedRequirement === 'string' ? content.designatedRequirement : null
  } catch {
    return null
  }
}

/**
 * macOS keys Accessibility / Screen Recording grants to the app's designated
 * requirement. When it changes (older ad-hoc builds, or the first release
 * signed with the stable certificate), the old entry stays in System Settings
 * looking enabled while no longer applying to this app, and toggling it does
 * nothing. Drop such stale entries automatically so the normal permission
 * prompt works again. Stable-signed releases keep the same requirement, so
 * this never touches a working grant.
 */
export const clearStaleMacPermissionsIfIdentityChanged = async (isAccessibilityGranted: () => boolean) => {
  if (process.platform !== 'darwin' || !app.isPackaged) {
    return
  }

  const signingInfo = await getMacCodeSigningInfo()
  const requirement = signingInfo?.designatedRequirement
  if (!signingInfo || !requirement) {
    return
  }

  const lastRequirement = await readLastDesignatedRequirement()
  const bundleId = signingInfo.identifier || 'com.popmind.app'

  mainLogger.info('[permissions] signing identity', {
    bundleId,
    isAdhoc: signingInfo.isAdhoc,
    requirement,
    identityChanged: lastRequirement !== requirement,
  })

  if (lastRequirement === requirement) {
    return
  }

  const resetService = async (service: 'Accessibility' | 'ScreenCapture') => {
    try {
      await execFileAsync('tccutil', ['reset', service, bundleId])
      mainLogger.info('[permissions] cleared stale permission after signing identity change', { service, bundleId })
    } catch (error) {
      mainLogger.warn('[permissions] failed to clear stale permission', { service, bundleId, error: String(error) })
    }
  }

  if (!isAccessibilityGranted()) {
    await resetService('Accessibility')
  }

  if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    await resetService('ScreenCapture')
  }

  try {
    await writeFile(signingIdentityFilePath(), JSON.stringify({ designatedRequirement: requirement }, null, 2))
  } catch (error) {
    mainLogger.warn('[permissions] failed to save signing identity', { error: String(error) })
  }
}
