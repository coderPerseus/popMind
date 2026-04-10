import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { app, nativeImage } from 'electron'
import { mainLogger } from '@/lib/main/logger'

const execFileAsync = promisify(execFile)
const DEFAULT_RESULT_LIMIT = 8
const APPLICATION_INDEX_TTL_MS = 1000 * 60 * 5
const FALLBACK_FIND_MAX_DEPTH = '3'
const FIND_MAX_BUFFER = 1024 * 1024 * 16
const LSREGISTER_MAX_BUFFER = 1024 * 1024 * 64
const LSREGISTER_PATH =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
const FALLBACK_APP_DIRECTORIES = ['/Applications', '/System/Applications', join(homedir(), 'Applications')] as const
const COMMON_BUNDLE_ID_SEGMENTS = new Set(['app', 'com', 'helper', 'macos', 'system'])

type InstalledAppMetadata = {
  name: string
  fileName: string
  bundleId: string
  path: string
}

type LocalizedNameMap = Record<string, string>

type LaunchServicesBundleRecord = {
  bundleId: string
  displayName: string
  itemName: string
  localizedNames: LocalizedNameMap
  localizedShortNames: LocalizedNameMap
  name: string
  path: string
}

type InstalledAppIndexEntry = InstalledAppMetadata & {
  aliases: string[]
}

export type InstalledAppSearchResult = InstalledAppMetadata & {
  iconDataUrl: string | null
}

const normalizeSearchText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

const isNestedApplication = (appPath: string) => /\.app\/Contents\/.+\.app$/i.test(appPath)

const getIconCandidates = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '(null)') {
    return []
  }

  const ext = extname(trimmed).toLowerCase()
  if (ext) {
    return [trimmed]
  }

  return [`${trimmed}.icns`, `${trimmed}.png`]
}

const scoreField = (field: string, query: string) => {
  if (!field) {
    return 0
  }

  if (field === query) {
    return 120
  }

  if (field.startsWith(query)) {
    return 80
  }

  if (field.includes(query)) {
    return 45
  }

  const compactField = field.replace(/\s+/g, '')
  const compactQuery = query.replace(/\s+/g, '')

  if (compactField === compactQuery) {
    return 90
  }

  if (compactField.startsWith(compactQuery)) {
    return 60
  }

  if (compactField.includes(compactQuery)) {
    return 30
  }

  return 0
}

const stripLaunchServicesSuffix = (value: string) => value.replace(/\s+\(0x[0-9a-f]+\)$/i, '').trim()

const parseLocalizedNameMap = (value: string) => {
  const localizedNames: LocalizedNameMap = {}
  const regex = /"([^"]+)" = (?:"([^"]*)"|\?)/g

  for (const match of value.matchAll(regex)) {
    const locale = match[1]?.trim()
    const localizedValue = match[2]?.trim()

    if (!locale || !localizedValue) {
      continue
    }

    localizedNames[locale] = localizedValue
  }

  return localizedNames
}

const getPreferredLocaleKeys = () => {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || 'en'
  const normalizedLocale = locale.replace('_', '-')
  const lowerLocale = normalizedLocale.toLowerCase()
  const keys = new Set<string>([
    normalizedLocale,
    normalizedLocale.replace(/-/g, '_'),
    normalizedLocale.split('-')[0] ?? normalizedLocale,
  ])

  if (lowerLocale.startsWith('zh-cn') || lowerLocale.startsWith('zh-sg') || lowerLocale === 'zh') {
    keys.add('zh-Hans')
    keys.add('zh_CN')
  }

  if (lowerLocale.startsWith('zh-tw') || lowerLocale.startsWith('zh-hk') || lowerLocale.startsWith('zh-mo')) {
    keys.add('zh-Hant')
    keys.add('zh_TW')
    keys.add('zh_HK')
  }

  keys.add('en')
  keys.add('LSDefaultLocalizedValue')

  return [...keys]
}

const pickPreferredLocalizedName = (shortNames: LocalizedNameMap, names: LocalizedNameMap) => {
  const localeKeys = getPreferredLocaleKeys()

  for (const localeKey of localeKeys) {
    const shortName = shortNames[localeKey]?.trim()
    if (shortName) {
      return shortName
    }

    const name = names[localeKey]?.trim()
    if (name) {
      return name
    }
  }

  return Object.values(shortNames).find(Boolean) || Object.values(names).find(Boolean) || ''
}

const buildAliasSet = (values: string[]) => {
  const aliases = new Set<string>()

  for (const value of values) {
    const normalized = normalizeSearchText(value)
    if (!normalized) {
      continue
    }

    aliases.add(normalized)
  }

  return aliases
}

const addBundleIdentifierAliases = (aliases: Set<string>, bundleId: string) => {
  const normalizedBundleId = normalizeSearchText(bundleId)
  if (!normalizedBundleId) {
    return
  }

  aliases.add(normalizedBundleId)

  for (const segment of normalizedBundleId.split(/[./_-]+/)) {
    if (segment.length < 2 || COMMON_BUNDLE_ID_SEGMENTS.has(segment)) {
      continue
    }

    aliases.add(segment)
  }
}

const buildIndexEntry = (
  appPath: string,
  metadata: {
    bundleId?: string
    displayName?: string
    fileName?: string
    itemName?: string
    localizedNames?: LocalizedNameMap
    localizedShortNames?: LocalizedNameMap
    name?: string
  }
): InstalledAppIndexEntry => {
  const fileName = metadata.fileName || basename(appPath)
  const fileBaseName = fileName.replace(/\.app$/i, '')
  const displayName = metadata.displayName?.trim() || ''
  const itemName = metadata.itemName?.trim() || ''
  const bundleId = metadata.bundleId?.trim() || ''
  const name = metadata.name?.trim() || ''
  const localizedNames = metadata.localizedNames ?? {}
  const localizedShortNames = metadata.localizedShortNames ?? {}
  const preferredName =
    pickPreferredLocalizedName(localizedShortNames, localizedNames) || displayName || name || itemName || fileBaseName
  const aliases = buildAliasSet([
    preferredName,
    displayName,
    name,
    itemName,
    fileBaseName,
    ...Object.values(localizedShortNames),
    ...Object.values(localizedNames),
  ])

  addBundleIdentifierAliases(aliases, bundleId)

  return {
    path: appPath,
    name: preferredName,
    fileName,
    bundleId,
    aliases: [...aliases],
  }
}

const parseLaunchServicesBundleRecord = (block: string): LaunchServicesBundleRecord | null => {
  let bundleClass = ''
  let bundleId = ''
  let displayName = ''
  let itemName = ''
  let name = ''
  let path = ''
  let localizedNames: LocalizedNameMap = {}
  let localizedShortNames: LocalizedNameMap = {}

  for (const line of block.split('\n')) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()

    switch (key) {
      case 'class':
        bundleClass = value
        break
      case 'identifier':
        bundleId = value
        break
      case 'displayName':
        displayName = value
        break
      case 'itemName':
        itemName = value
        break
      case 'localizedNames':
        localizedNames = parseLocalizedNameMap(value)
        break
      case 'localizedShortNames':
        localizedShortNames = parseLocalizedNameMap(value)
        break
      case 'name':
        name = value
        break
      case 'path':
        path = stripLaunchServicesSuffix(value)
        break
      default:
        break
    }
  }

  if (!bundleClass.startsWith('kLSBundleClassApplication') || !path.endsWith('.app') || isNestedApplication(path)) {
    return null
  }

  return {
    path,
    bundleId,
    name,
    displayName,
    itemName,
    localizedNames,
    localizedShortNames,
  }
}

class InstalledAppService {
  private iconCache = new Map<string, Promise<string | null>>()
  private applicationIndexCache: { expiresAt: number; promise: Promise<InstalledAppIndexEntry[]> } | null = null

  async search(query: string, limit = DEFAULT_RESULT_LIMIT): Promise<InstalledAppSearchResult[]> {
    if (process.platform !== 'darwin') {
      return []
    }

    const normalizedQuery = normalizeSearchText(query)
    if (!normalizedQuery) {
      return []
    }

    const indexedApplications = await this.getIndexedApplications()
    const ranked = indexedApplications
      .map((item) => ({
        item,
        score: this.scoreResult(item, normalizedQuery),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name, 'zh-Hans-CN'))
      .slice(0, limit)

    return Promise.all(
      ranked.map(async ({ item }) => ({
        path: item.path,
        name: item.name,
        fileName: item.fileName,
        bundleId: item.bundleId,
        iconDataUrl: await this.getIconDataUrl(item.path),
      }))
    )
  }

  private scoreResult(item: InstalledAppIndexEntry, normalizedQuery: string) {
    return item.aliases.reduce((best, alias) => Math.max(best, scoreField(alias, normalizedQuery)), 0)
  }

  private async getIndexedApplications() {
    const now = Date.now()
    if (this.applicationIndexCache && this.applicationIndexCache.expiresAt > now) {
      return this.applicationIndexCache.promise
    }

    const promise = this.loadIndexedApplications().catch((error) => {
      mainLogger.warn('[installed-app-service] application index build failed', { error })
      if (this.applicationIndexCache?.promise === promise) {
        this.applicationIndexCache = null
      }
      return []
    })

    this.applicationIndexCache = {
      expiresAt: now + APPLICATION_INDEX_TTL_MS,
      promise,
    }

    return promise
  }

  private async loadIndexedApplications() {
    const [filesystemPaths, launchServicesRecords] = await Promise.all([
      this.listFilesystemApplicationPaths(),
      this.readLaunchServicesRecords(),
    ])

    const launchServicesMap = new Map(launchServicesRecords.map((record) => [record.path, record]))
    const entries = await Promise.all(
      filesystemPaths.map(async (appPath) => {
        const launchServicesRecord = launchServicesMap.get(appPath)
        if (launchServicesRecord) {
          return buildIndexEntry(appPath, {
            bundleId: launchServicesRecord.bundleId,
            displayName: launchServicesRecord.displayName,
            fileName: basename(appPath),
            itemName: launchServicesRecord.itemName,
            localizedNames: launchServicesRecord.localizedNames,
            localizedShortNames: launchServicesRecord.localizedShortNames,
            name: launchServicesRecord.name,
          })
        }

        return this.readBundleMetadataFallback(appPath)
      })
    )

    return entries
  }

  private async getSearchDirectories() {
    const directories = await Promise.all(
      FALLBACK_APP_DIRECTORIES.map(async (directory) => ((await this.pathExists(directory)) ? directory : null))
    )

    return directories.filter((directory): directory is string => Boolean(directory))
  }

  private async listFilesystemApplicationPaths() {
    const searchDirectories = await this.getSearchDirectories()
    if (!searchDirectories.length) {
      return []
    }

    const pathSets = await Promise.all(
      searchDirectories.map(async (directory) => {
        try {
          const { stdout } = await execFileAsync(
            'find',
            [directory, '-maxdepth', FALLBACK_FIND_MAX_DEPTH, '-type', 'd', '-name', '*.app'],
            {
              encoding: 'utf8',
              maxBuffer: FIND_MAX_BUFFER,
            }
          )

          return stdout
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((appPath) => !isNestedApplication(appPath))
        } catch (error) {
          mainLogger.warn('[installed-app-service] filesystem app enumeration failed', { directory, error })
          return []
        }
      })
    )

    return [...new Set(pathSets.flat())]
  }

  private async readLaunchServicesRecords() {
    try {
      const { stdout } = await execFileAsync(LSREGISTER_PATH, ['-dump', 'Bundle'], {
        encoding: 'utf8',
        maxBuffer: LSREGISTER_MAX_BUFFER,
      })

      return stdout
        .split(/\n-{20,}\n/g)
        .map((block) => parseLaunchServicesBundleRecord(block))
        .filter((record): record is LaunchServicesBundleRecord => Boolean(record))
    } catch (error) {
      mainLogger.warn('[installed-app-service] launch services dump failed', { error })
      return []
    }
  }

  private async readBundleMetadataFallback(appPath: string) {
    const infoPlistPath = join(appPath, 'Contents', 'Info.plist')
    const [info, localizedNames] = await Promise.all([
      this.readPlistObject(infoPlistPath),
      this.readLocalizedBundleNames(appPath),
    ])

    return buildIndexEntry(appPath, {
      bundleId: typeof info?.CFBundleIdentifier === 'string' ? info.CFBundleIdentifier : '',
      displayName: typeof info?.CFBundleDisplayName === 'string' ? info.CFBundleDisplayName : '',
      fileName: basename(appPath),
      localizedNames,
      name: typeof info?.CFBundleName === 'string' ? info.CFBundleName : '',
      itemName: typeof info?.CFBundleExecutable === 'string' ? info.CFBundleExecutable : '',
    })
  }

  private async readLocalizedBundleNames(appPath: string) {
    const resourcesDirectory = join(appPath, 'Contents', 'Resources')
    if (!(await this.pathExists(resourcesDirectory))) {
      return {}
    }

    try {
      const entries = await readdir(resourcesDirectory, { withFileTypes: true })
      const localizedValues = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && entry.name.endsWith('.lproj'))
          .map(async (entry) => {
            const locale = entry.name.replace(/\.lproj$/i, '')
            const stringsPath = join(resourcesDirectory, entry.name, 'InfoPlist.strings')
            const info = await this.readPlistObject(stringsPath)
            const value =
              (typeof info?.CFBundleDisplayName === 'string' && info.CFBundleDisplayName) ||
              (typeof info?.CFBundleName === 'string' && info.CFBundleName) ||
              ''

            return value ? [locale, value] : null
          })
      )

      return Object.fromEntries(
        localizedValues.filter((entry): entry is [string, string] => Array.isArray(entry) && entry.length === 2)
      )
    } catch (error) {
      mainLogger.warn('[installed-app-service] localized bundle name read failed', { appPath, error })
      return {}
    }
  }

  private async readPlistObject(filePath: string) {
    try {
      const { stdout } = await execFileAsync('plutil', ['-convert', 'json', '-o', '-', filePath], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 4,
      })

      return JSON.parse(stdout) as Record<string, unknown>
    } catch {
      return null
    }
  }

  private getIconDataUrl(appPath: string) {
    const cached = this.iconCache.get(appPath)
    if (cached) {
      return cached
    }

    const iconPromise = this.getBundleIconDataUrl(appPath)
      .then((iconDataUrl) => {
        if (iconDataUrl) {
          return iconDataUrl
        }

        return app.getFileIcon(appPath).then((icon) => {
          if (icon.isEmpty()) {
            return null
          }

          return icon.resize({ width: 64, height: 64 }).toDataURL()
        })
      })
      .catch((error) => {
        mainLogger.warn('[installed-app-service] getFileIcon failed', { appPath, error })
        return null
      })

    this.iconCache.set(appPath, iconPromise)
    return iconPromise
  }

  private async getBundleIconDataUrl(appPath: string) {
    const iconPath = await this.resolveBundleIconPath(appPath)
    if (!iconPath) {
      return null
    }

    const iconImage = nativeImage.createFromPath(iconPath)
    if (!iconImage.isEmpty()) {
      return iconImage.resize({ width: 64, height: 64 }).toDataURL()
    }

    if (extname(iconPath).toLowerCase() === '.icns') {
      return this.convertIcnsToDataUrl(iconPath)
    }

    return null
  }

  private async resolveBundleIconPath(appPath: string) {
    const infoPlistPath = join(appPath, 'Contents', 'Info.plist')
    const resourcesDir = join(appPath, 'Contents', 'Resources')
    const explicitCandidates = await Promise.all([
      this.readPlistValue(infoPlistPath, 'CFBundleIconFile'),
      this.readPlistValue(infoPlistPath, 'CFBundleIconName'),
    ])

    for (const candidate of explicitCandidates.flatMap((value) => getIconCandidates(value))) {
      const iconPath = join(resourcesDir, candidate)
      if (await this.pathExists(iconPath)) {
        return iconPath
      }
    }

    const fallbackCandidates = ['AppIcon.icns', 'AppIcon.png', 'electron.icns']
    for (const candidate of fallbackCandidates) {
      const iconPath = join(resourcesDir, candidate)
      if (await this.pathExists(iconPath)) {
        return iconPath
      }
    }

    return null
  }

  private async readPlistValue(infoPlistPath: string, key: string) {
    try {
      const { stdout } = await execFileAsync('plutil', ['-extract', key, 'raw', '-o', '-', infoPlistPath], {
        encoding: 'utf8',
      })

      return stdout.trim()
    } catch {
      return ''
    }
  }

  private async pathExists(path: string) {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }

  private async convertIcnsToDataUrl(iconPath: string) {
    const tempDir = await mkdtemp(join(tmpdir(), 'popmind-icon-'))
    const outputPath = join(tempDir, 'icon.png')

    try {
      await execFileAsync('sips', ['-s', 'format', 'png', '-z', '128', '128', iconPath, '--out', outputPath], {
        encoding: 'utf8',
      })

      const pngBuffer = await readFile(outputPath)
      return `data:image/png;base64,${pngBuffer.toString('base64')}`
    } catch (error) {
      mainLogger.warn('[installed-app-service] icns conversion failed', { iconPath, error })
      return null
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  }
}

export const installedAppService = new InstalledAppService()
