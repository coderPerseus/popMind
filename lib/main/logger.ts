import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  type WriteStream,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { inspect } from 'node:util'
import { app, dialog } from 'electron'

type ConsoleMethodName = 'log' | 'info' | 'warn' | 'error' | 'debug'

const CONSOLE_METHODS: ConsoleMethodName[] = ['log', 'info', 'warn', 'error', 'debug']
const LOG_FILE_PREFIX = 'main-'
const LOG_FILE_EXTENSION = '.log'
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024
const MAX_LOG_FILES = 10
const MAX_TOTAL_LOG_BYTES = 20 * 1024 * 1024
const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000
const LOG_SEVERITY: Record<ConsoleMethodName, number> = {
  debug: 10,
  log: 20,
  info: 20,
  warn: 30,
  error: 40,
}
const runtimeConsole = console as Console & Record<ConsoleMethodName, (...args: unknown[]) => void>

const originalConsole = Object.fromEntries(
  CONSOLE_METHODS.map((method) => [method, runtimeConsole[method].bind(runtimeConsole)])
) as Record<ConsoleMethodName, (...args: unknown[]) => void>

const bufferedLines: Array<{ level: ConsoleMethodName; line: string }> = []

let isConsoleCaptureInstalled = false
let isLoggingInitialized = false
let areProcessHooksInstalled = false
let logDirectoryPath: string | null = null
let currentLogFilePath: string | null = null
let logStream: WriteStream | null = null
let currentLogFileSize = 0

const resolvePersistedLogLevel = (): ConsoleMethodName => {
  const configuredLevel = process.env['POPMIND_FILE_LOG_LEVEL']?.trim().toLowerCase()
  if (configuredLevel && CONSOLE_METHODS.includes(configuredLevel as ConsoleMethodName)) {
    return configuredLevel as ConsoleMethodName
  }

  return 'warn'
}

const persistedLogLevel = resolvePersistedLogLevel()

const getLogDirectoryPath = () => {
  if (logDirectoryPath || !app.isReady()) {
    return logDirectoryPath
  }

  logDirectoryPath = join(app.getPath('logs'), 'popMind')
  return logDirectoryPath
}

const serializeLogArgument = (arg: unknown) => {
  if (arg instanceof Error) {
    return arg.stack || `${arg.name}: ${arg.message}`
  }

  if (typeof arg === 'string') {
    return arg
  }

  return inspect(arg, {
    depth: 6,
    colors: false,
    compact: false,
    breakLength: 140,
  })
}

const formatLogLine = (level: ConsoleMethodName, args: unknown[]) => {
  const timestamp = new Date().toISOString()
  const source = process.type || 'browser'
  const message = args.map((arg) => serializeLogArgument(arg)).join(' ')
  return `${timestamp} [${source}] [${level.toUpperCase()}] ${message}\n`
}

const shouldPersistLogLevel = (level: ConsoleMethodName) => {
  return LOG_SEVERITY[level] >= LOG_SEVERITY[persistedLogLevel]
}

const buildLogFilePath = () => {
  const directoryPath = getLogDirectoryPath()
  if (!directoryPath) {
    return null
  }

  const sessionStamp = new Date().toISOString().replace(/[:.]/g, '-')
  let candidate = join(directoryPath, `${LOG_FILE_PREFIX}${sessionStamp}${LOG_FILE_EXTENSION}`)
  let suffix = 1

  while (existsSync(candidate)) {
    candidate = join(directoryPath, `${LOG_FILE_PREFIX}${sessionStamp}-${suffix}${LOG_FILE_EXTENSION}`)
    suffix += 1
  }

  return candidate
}

const openLogStream = (filePath: string) => {
  currentLogFilePath = filePath
  logStream = createWriteStream(filePath, {
    flags: 'a',
    encoding: 'utf8',
  })
  currentLogFileSize = existsSync(filePath) ? statSync(filePath).size : 0
}

const cleanupLogFiles = () => {
  const now = Date.now()
  const files = getLogFiles()
    .map((filePath) => {
      try {
        const stats = statSync(filePath)
        return {
          filePath,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        }
      } catch {
        return null
      }
    })
    .filter((entry): entry is { filePath: string; size: number; mtimeMs: number } => Boolean(entry))

  const removable = files
    .filter((entry) => entry.filePath !== currentLogFilePath)
    .sort((left, right) => left.mtimeMs - right.mtimeMs)

  for (const entry of removable) {
    if (now - entry.mtimeMs <= MAX_LOG_AGE_MS) {
      continue
    }

    try {
      unlinkSync(entry.filePath)
    } catch {
      // Ignore cleanup failures.
    }
  }

  const remaining = getLogFiles()
    .map((filePath) => {
      try {
        const stats = statSync(filePath)
        return {
          filePath,
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        }
      } catch {
        return null
      }
    })
    .filter((entry): entry is { filePath: string; size: number; mtimeMs: number } => Boolean(entry))
    .sort((left, right) => left.mtimeMs - right.mtimeMs)

  let totalSize = remaining.reduce((sum, entry) => sum + entry.size, 0)
  let fileCount = remaining.length

  for (const entry of remaining) {
    if (entry.filePath === currentLogFilePath) {
      continue
    }

    const shouldTrimByCount = fileCount > MAX_LOG_FILES
    const shouldTrimBySize = totalSize > MAX_TOTAL_LOG_BYTES
    if (!shouldTrimByCount && !shouldTrimBySize) {
      continue
    }

    try {
      unlinkSync(entry.filePath)
      totalSize -= entry.size
      fileCount -= 1
    } catch {
      // Ignore cleanup failures.
    }
  }
}

const rotateLogFileIfNeeded = (incomingBytes: number) => {
  if (!logStream) {
    return
  }

  if (currentLogFileSize + incomingBytes <= MAX_LOG_FILE_BYTES) {
    return
  }

  logStream.end()
  logStream = null

  const nextLogFilePath = buildLogFilePath()
  if (!nextLogFilePath) {
    return
  }

  openLogStream(nextLogFilePath)
  cleanupLogFiles()
}

const persistLogLine = (level: ConsoleMethodName, line: string) => {
  if (!shouldPersistLogLevel(level)) {
    return
  }

  if (logStream) {
    const lineSize = Buffer.byteLength(line, 'utf8')
    rotateLogFileIfNeeded(lineSize)
    logStream.write(line)
    currentLogFileSize += lineSize
    return
  }

  bufferedLines.push({ level, line })
}

const flushBufferedLogs = () => {
  if (!logStream || bufferedLines.length === 0) {
    return
  }

  for (const entry of bufferedLines.splice(0, bufferedLines.length)) {
    const lineSize = Buffer.byteLength(entry.line, 'utf8')
    rotateLogFileIfNeeded(lineSize)
    logStream.write(entry.line)
    currentLogFileSize += lineSize
  }
}

const installConsoleCapture = () => {
  if (isConsoleCaptureInstalled) {
    return
  }

  isConsoleCaptureInstalled = true

  for (const method of CONSOLE_METHODS) {
    runtimeConsole[method] = (...args: unknown[]) => {
      originalConsole[method](...args)
      persistLogLine(method, formatLogLine(method, args))
    }
  }
}

const getLogFiles = () => {
  const directoryPath = getLogDirectoryPath()
  if (!directoryPath || !existsSync(directoryPath)) {
    return []
  }

  return readdirSync(directoryPath)
    .filter((name) => name.startsWith(LOG_FILE_PREFIX) && name.endsWith(LOG_FILE_EXTENSION))
    .sort()
    .map((name) => join(directoryPath, name))
}

installConsoleCapture()

export const initializeAppLogging = () => {
  if (isLoggingInitialized) {
    return
  }

  const directoryPath = getLogDirectoryPath()
  if (!directoryPath) {
    return
  }

  mkdirSync(directoryPath, { recursive: true })

  const nextLogFilePath = buildLogFilePath()
  if (!nextLogFilePath) {
    return
  }

  openLogStream(nextLogFilePath)
  cleanupLogFiles()

  flushBufferedLogs()
  isLoggingInitialized = true

  if (!areProcessHooksInstalled) {
    areProcessHooksInstalled = true

    process.on('uncaughtException', (error) => {
      runtimeConsole.error('[logger] uncaughtException', error)
    })

    process.on('unhandledRejection', (reason) => {
      runtimeConsole.error('[logger] unhandledRejection', reason)
    })
  }

  runtimeConsole.info('[logger] initialized', {
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    userDataPath: app.getPath('userData'),
    logsPath: directoryPath,
    currentLogFilePath,
    persistedLogLevel,
  })
}

export const exportMainProcessLogs = async () => {
  initializeAppLogging()

  const files = getLogFiles()
  const defaultPath = join(
    app.getPath('desktop'),
    `popmind-debug-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
  )

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出日志',
    defaultPath,
    filters: [
      { name: 'Log Files', extensions: ['log', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  if (canceled || !filePath) {
    runtimeConsole.info('[logger] export canceled')
    return { canceled: true as const }
  }

  const exportSections = [
    'popMind debug export',
    `exportedAt: ${new Date().toISOString()}`,
    `version: ${app.getVersion()}`,
    `isPackaged: ${app.isPackaged}`,
    `platform: ${process.platform}`,
    `arch: ${process.arch}`,
    `pid: ${process.pid}`,
    `currentLogFilePath: ${currentLogFilePath ?? 'unavailable'}`,
    '',
  ]

  for (const file of files.slice(-5)) {
    exportSections.push(`===== ${basename(file)} =====`)
    exportSections.push(readFileSync(file, 'utf8'))
    exportSections.push('')
  }

  if (files.length === 0 && bufferedLines.length > 0) {
    exportSections.push('===== buffered.log =====')
    exportSections.push(bufferedLines.join(''))
  }

  writeFileSync(filePath, exportSections.join('\n'), 'utf8')

  runtimeConsole.info('[logger] logs exported', {
    filePath,
    fileCount: files.length,
  })

  return {
    canceled: false as const,
    filePath,
  }
}

export const getCurrentMainLogFilePath = () => currentLogFilePath

export const mainLogger: Console = runtimeConsole
