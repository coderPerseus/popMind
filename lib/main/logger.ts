import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, type WriteStream, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { inspect } from 'node:util'
import { app, dialog } from 'electron'

type ConsoleMethodName = 'log' | 'info' | 'warn' | 'error' | 'debug'

const CONSOLE_METHODS: ConsoleMethodName[] = ['log', 'info', 'warn', 'error', 'debug']
const LOG_FILE_PREFIX = 'main-'
const LOG_FILE_EXTENSION = '.log'
const runtimeConsole = console as Console & Record<ConsoleMethodName, (...args: unknown[]) => void>

const originalConsole = Object.fromEntries(
  CONSOLE_METHODS.map((method) => [method, runtimeConsole[method].bind(runtimeConsole)])
) as Record<ConsoleMethodName, (...args: unknown[]) => void>

const bufferedLines: string[] = []

let isConsoleCaptureInstalled = false
let isLoggingInitialized = false
let areProcessHooksInstalled = false
let logDirectoryPath: string | null = null
let currentLogFilePath: string | null = null
let logStream: WriteStream | null = null

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

const persistLogLine = (line: string) => {
  if (logStream) {
    logStream.write(line)
    return
  }

  bufferedLines.push(line)
}

const flushBufferedLogs = () => {
  if (!logStream || bufferedLines.length === 0) {
    return
  }

  for (const line of bufferedLines.splice(0, bufferedLines.length)) {
    logStream.write(line)
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
      persistLogLine(formatLogLine(method, args))
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

  const sessionStamp = new Date().toISOString().replace(/[:.]/g, '-')
  currentLogFilePath = join(directoryPath, `${LOG_FILE_PREFIX}${sessionStamp}${LOG_FILE_EXTENSION}`)
  logStream = createWriteStream(currentLogFilePath, {
    flags: 'a',
    encoding: 'utf8',
  })

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
