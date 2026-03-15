import { execFile } from 'node:child_process'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface MacCodeSigningInfo {
  appPath: string
  executablePath: string
  identifier: string | null
  signature: string | null
  teamIdentifier: string | null
  isAdhoc: boolean | null
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
    }
  } catch {
    return null
  }
}

const matchValue = (output: string, key: string) => {
  const match = output.match(new RegExp(`^${key}=(.+)$`, 'm'))
  return match?.[1]?.trim() || null
}
