// Runs Workers AI models through the Cloudflare `cf` CLI, so popMind reuses the user's `cf auth login`
// session without ever reading the stored credentials itself.
import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const PATH_MARKER = '__POPMIND_PATH__'
const SHELL_TIMEOUT_MS = 5000

export class CfCliError extends Error {
  readonly code: 'not-found' | 'failed' | 'timeout' | 'bad-output'

  constructor(code: CfCliError['code'], message: string) {
    super(message)
    this.name = 'CfCliError'
    this.code = code
  }
}

type CfCliLocation = { path: string; env: NodeJS.ProcessEnv }

let resolved: CfCliLocation | null = null
let resolving: Promise<CfCliLocation | null> | null = null
/** Read once: starting a login shell costs seconds, while re-scanning its PATH for `cf` costs milliseconds. */
let loginShellPath: Promise<string> | null = null

const run = (file: string, args: string[], options: { env?: NodeJS.ProcessEnv; timeoutMs: number }) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      file,
      args,
      { env: options.env, timeout: options.timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout: String(stdout), stderr: String(stderr) }))
          return
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })

/**
 * Apps started from Finder get a minimal PATH, while `cf` (and the `node` it runs on) usually lives in a
 * Homebrew / npm / nvm directory added by the user's shell profile. Ask the login shell for its PATH once.
 */
const readLoginShellPath = async () => {
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const { stdout } = await run(shell, ['-ilc', `printf '${PATH_MARKER}%s${PATH_MARKER}' "$PATH"`], {
      timeoutMs: SHELL_TIMEOUT_MS,
    })
    return stdout.split(PATH_MARKER)[1] ?? ''
  } catch {
    return ''
  }
}

const isExecutable = async (file: string) => {
  try {
    await access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

const findCfCli = async (): Promise<CfCliLocation | null> => {
  const home = homedir()
  loginShellPath ??= readLoginShellPath()
  const shellPath = await loginShellPath
  const dirs = [
    ...shellPath.split(delimiter),
    ...(process.env.PATH ?? '').split(delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.npm-global/bin'),
    join(home, 'Library/pnpm'),
    join(home, '.bun/bin'),
    join(home, '.volta/bin'),
  ].filter(Boolean)
  const searchPath = [...new Set(dirs)].join(delimiter)
  const env = { ...process.env, PATH: searchPath }

  for (const dir of new Set(dirs)) {
    const candidate = join(dir, 'cf')
    if (!(await isExecutable(candidate))) continue

    // The Cloud Foundry CLI is also called `cf`; it prints "cf version x.y.z".
    try {
      const { stdout } = await run(candidate, ['--version'], { env, timeoutMs: 10_000 })
      if (/^cf version /i.test(stdout.trim())) continue
    } catch {
      continue
    }

    return { path: candidate, env }
  }

  return null
}

/** Cached once found; a miss is re-checked on the next call so installing `cf` needs no restart. */
export const resolveCfCli = async () => {
  if (resolved) return resolved

  resolving ??= findCfCli().finally(() => {
    resolving = null
  })
  resolved = await resolving
  return resolved
}

/** cf prints errors inside a box ("┌ Error", "│ No authentication token found."); keep the first real line. */
const firstErrorLine = (text: string) =>
  text
    .split('\n')
    .map((line) => line.replace(/^[\s│┃┌┐└┘├┤─━]+/u, '').trim())
    .find((line) => line && !/^error:?$/i.test(line) && !line.startsWith('at '))
    ?.slice(0, 200) ?? ''

/** `cf ai run <model> --body <json>`, returning the parsed JSON output. */
export const runWorkersAiWithCfCli = async (
  modelId: string,
  body: unknown,
  options: { accountId?: string; timeoutMs: number }
): Promise<unknown> => {
  const cli = await resolveCfCli()
  if (!cli) {
    throw new CfCliError(
      'not-found',
      'Cloudflare cf CLI not found. Install it with `npm i -g cf` and run `cf auth login`'
    )
  }

  const accountId = options.accountId?.trim()
  const env = accountId ? { ...cli.env, CLOUDFLARE_ACCOUNT_ID: accountId } : cli.env

  let stdout: string
  try {
    ;({ stdout } = await run(cli.path, ['ai', 'run', modelId, '--body', JSON.stringify(body)], {
      env,
      timeoutMs: options.timeoutMs,
    }))
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { killed?: boolean; stdout?: string; stderr?: string }
    if (failure.killed) {
      throw new CfCliError('timeout', `cf CLI did not answer within ${options.timeoutMs} ms`)
    }
    const output = `${failure.stderr ?? ''}\n${failure.stdout ?? ''}`
    if (/no authentication|not logged in|cf auth login/i.test(output)) {
      throw new CfCliError('failed', 'cf CLI is not logged in. Run `cf auth login`, or fill in an API token')
    }
    const detail = firstErrorLine(failure.stderr ?? '') || firstErrorLine(failure.stdout ?? '') || failure.message
    throw new CfCliError('failed', `cf CLI failed: ${detail}`)
  }

  try {
    return JSON.parse(stdout)
  } catch {
    throw new CfCliError('bad-output', `cf CLI returned non-JSON output: ${firstErrorLine(stdout)}`)
  }
}
