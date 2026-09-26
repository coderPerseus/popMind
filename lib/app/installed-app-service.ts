import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { app, nativeImage } from 'electron'
import { mainLogger } from '@/lib/main/logger'
import { nativeMacOSAddon } from '@/lib/native/macos-addon'

const execFileAsync = promisify(execFile)
const DEFAULT_RESULT_LIMIT = 8
const APPLICATION_INDEX_TTL_MS = 1000 * 60 * 5
const APPLICATION_SCAN_MAX_DEPTH = 3
const APPLICATION_WATCH_DEBOUNCE_MS = 1500
const ICON_SIZE = 64
const ICON_CACHE_VERSION = 'v1'
const ICON_PREWARM_BATCH_SIZE = 16
// Localizations worth indexing: English + Chinese names cover nearly every search in practice.
const INDEXED_LOCALES = ['en', 'English', 'Base', 'zh_CN', 'zh-Hans', 'zh_TW', 'zh-Hant', 'zh_HK']
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
  private applicationIndex: { builtAt: number; entries: InstalledAppIndexEntry[] } | null = null
  private applicationIndexBuild: Promise<InstalledAppIndexEntry[]> | null = null
  private applicationIndexDirty = false
  private watchers: FSWatcher[] = []
  private watchRefreshTimer: NodeJS.Timeout | null = null
  private iconCacheDirectory: Promise<string> | null = null

  /** Build the index (and icon cache) in the background so the first search is instant. */
  warmup() {
    if (process.platform !== 'darwin') {
      return
    }

    void this.getIndexedApplications()
      .then((entries) => this.prewarmIcons(entries))
      .catch((error) => {
        mainLogger.warn('[installed-app-service] warmup failed', { error })
      })
    void this.watchApplicationDirectories()
  }

  dispose() {
    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers = []
    if (this.watchRefreshTimer) {
      clearTimeout(this.watchRefreshTimer)
      this.watchRefreshTimer = null
    }
  }

  async search(query: string, limit = DEFAULT_RESULT_LIMIT): Promise<InstalledAppSearchResult[]> {
    if (process.platform !== 'darwin') {
      return []
    }

    const normalizedQuery = normalizeSearchText(query)
    if (!normalizedQuery) {
      return []
    }

    const startedAt = performance.now()
    const indexedApplications = await this.getIndexedApplications()
    const indexReadyAt = performance.now()
    const ranked = indexedApplications
      .map((item) => ({
        item,
        score: this.scoreResult(item, normalizedQuery),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name, 'zh-Hans-CN'))
      .slice(0, limit)

    const results = await Promise.all(
      ranked.map(async ({ item }) => ({
        path: item.path,
        name: item.name,
        fileName: item.fileName,
        bundleId: item.bundleId,
        iconDataUrl: await this.getIconDataUrl(item.path),
      }))
    )

    const finishedAt = performance.now()
    mainLogger.info('[installed-app-service] search', {
      query: normalizedQuery,
      results: results.length,
      indexMs: Math.round(indexReadyAt - startedAt),
      iconMs: Math.round(finishedAt - indexReadyAt),
      totalMs: Math.round(finishedAt - startedAt),
    })

    return results
  }

  private scoreResult(item: InstalledAppIndexEntry, normalizedQuery: string) {
    return item.aliases.reduce((best, alias) => Math.max(best, scoreField(alias, normalizedQuery)), 0)
  }

  /**
   * Stale-while-revalidate: once an index exists it is returned immediately and refreshed in the
   * background when it expires or an application folder changes. Only the very first call waits.
   */
  private async getIndexedApplications() {
    const index = this.applicationIndex
    if (index) {
      if (this.applicationIndexDirty || Date.now() - index.builtAt > APPLICATION_INDEX_TTL_MS) {
        void this.rebuildIndex('stale')
      }
      return index.entries
    }

    return this.rebuildIndex('initial')
  }

  private rebuildIndex(reason: string) {
    if (this.applicationIndexBuild) {
      return this.applicationIndexBuild
    }

    this.applicationIndexDirty = false
    const startedAt = performance.now()
    const build = this.loadIndexedApplications()
      .then((entries) => {
        this.applicationIndex = { builtAt: Date.now(), entries }
        mainLogger.info('[installed-app-service] index built', {
          reason,
          apps: entries.length,
          source: this.canUseNativeIndex() ? 'native' : 'launch-services',
          ms: Math.round(performance.now() - startedAt),
        })
        return entries
      })
      .catch((error) => {
        mainLogger.warn('[installed-app-service] application index build failed', { reason, error })
        return this.applicationIndex?.entries ?? []
      })
      .finally(() => {
        if (this.applicationIndexBuild === build) {
          this.applicationIndexBuild = null
        }
      })

    this.applicationIndexBuild = build
    return build
  }

  private async watchApplicationDirectories() {
    if (this.watchers.length) {
      return
    }

    for (const directory of await this.getSearchDirectories()) {
      try {
        const watcher = watch(directory, { persistent: false }, () => this.scheduleWatchRefresh())
        watcher.on('error', (error) => {
          mainLogger.warn('[installed-app-service] directory watcher failed', { directory, error })
        })
        this.watchers.push(watcher)
      } catch (error) {
        mainLogger.warn('[installed-app-service] cannot watch directory', { directory, error })
      }
    }
  }

  private scheduleWatchRefresh() {
    this.applicationIndexDirty = true
    if (this.watchRefreshTimer) {
      clearTimeout(this.watchRefreshTimer)
    }
    this.watchRefreshTimer = setTimeout(() => {
      this.watchRefreshTimer = null
      void this.rebuildIndex('directory-changed')
    }, APPLICATION_WATCH_DEBOUNCE_MS)
  }

  private canUseNativeIndex() {
    return typeof nativeMacOSAddon?.readApplicationsInfoAsync === 'function'
  }

  private getIndexedLocales() {
    const locales = new Set(INDEXED_LOCALES)
    try {
      for (const locale of app.getPreferredSystemLanguages()) {
        locales.add(locale)
        locales.add(locale.split('-')[0] ?? locale)
      }
    } catch {
      // Not critical: the fixed list already covers English and Chinese.
    }
    return [...locales]
  }

  private async loadIndexedApplications() {
    const filesystemPaths = await this.listFilesystemApplicationPaths()

    if (this.canUseNativeIndex()) {
      const records = await nativeMacOSAddon!.readApplicationsInfoAsync!(filesystemPaths, this.getIndexedLocales())
      return records.map((record) =>
        buildIndexEntry(record.path, {
          bundleId: record.bundleId,
          displayName: record.fileDisplayName || record.displayName,
          fileName: basename(record.path),
          itemName: record.displayName,
          localizedNames: record.localizedNames,
          localizedShortNames: {},
          name: record.name,
        })
      )
    }

    return this.loadIndexedApplicationsFromLaunchServices(filesystemPaths)
  }

  /** Fallback when the native addon is unavailable: slower (lsregister dump takes seconds). */
  private async loadIndexedApplicationsFromLaunchServices(filesystemPaths: string[]) {
    const launchServicesRecords = await this.readLaunchServicesRecords()
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
    const pathSets = await Promise.all(searchDirectories.map((directory) => this.collectApplicationPaths(directory, 1)))

    return [...new Set(pathSets.flat())]
  }

  /** Walk app folders a few levels deep. Symlinked bundles count too (e.g. /Applications/Safari.app). */
  private async collectApplicationPaths(directory: string, depth: number): Promise<string[]> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (depth === 1) {
        mainLogger.warn('[installed-app-service] filesystem app enumeration failed', { directory, error })
      }
      return []
    }

    const nested = await Promise.all(
      entries.map(async (entry) => {
        if (entry.name.startsWith('.')) {
          return []
        }

        const entryPath = join(directory, entry.name)
        if (entry.name.toLowerCase().endsWith('.app')) {
          if (entry.isDirectory()) {
            return [entryPath]
          }
          if (entry.isSymbolicLink()) {
            const target = await stat(entryPath).catch(() => null)
            return target?.isDirectory() ? [entryPath] : []
          }
          return []
        }

        if (entry.isDirectory() && depth < APPLICATION_SCAN_MAX_DEPTH) {
          return this.collectApplicationPaths(entryPath, depth + 1)
        }

        return []
      })
    )

    return nested.flat()
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

    const iconPromise = this.loadIconDataUrl(appPath).catch((error) => {
      mainLogger.warn('[installed-app-service] icon load failed', { appPath, error })
      return null
    })

    this.iconCache.set(appPath, iconPromise)
    return iconPromise
  }

  private async loadIconDataUrl(appPath: string) {
    if (typeof nativeMacOSAddon?.writeApplicationIconsAsync === 'function') {
      const iconPath = await this.getCachedIconPath(appPath)
      if (iconPath) {
        const png = await readFile(iconPath).catch(() => null)
        if (!png) {
          const [written] = await nativeMacOSAddon.writeApplicationIconsAsync(
            [{ appPath, outputPath: iconPath }],
            ICON_SIZE
          )
          if (written) {
            return `data:image/png;base64,${(await readFile(iconPath)).toString('base64')}`
          }
        } else {
          return `data:image/png;base64,${png.toString('base64')}`
        }
      }
    }

    return this.loadIconDataUrlFallback(appPath)
  }

  /** Disk cache keyed by bundle path + modification time, so app updates get a fresh icon. */
  private async getCachedIconPath(appPath: string) {
    const [directory, info] = await Promise.all([
      this.getIconCacheDirectory(),
      stat(join(appPath, 'Contents', 'Info.plist')).catch(() => stat(appPath).catch(() => null)),
    ])
    if (!info) {
      return null
    }

    const key = createHash('sha1')
      .update(`${ICON_CACHE_VERSION}:${ICON_SIZE}:${appPath}:${Math.round(info.mtimeMs)}`)
      .digest('hex')
    return join(directory, `${key}.png`)
  }

  private getIconCacheDirectory() {
    if (!this.iconCacheDirectory) {
      const directory = join(app.getPath('userData'), 'app-icons')
      this.iconCacheDirectory = mkdir(directory, { recursive: true }).then(() => directory)
    }
    return this.iconCacheDirectory
  }

  /** Generate missing icons for every indexed app so later searches never wait on icon rendering. */
  private async prewarmIcons(entries: InstalledAppIndexEntry[]) {
    const writeIcons = nativeMacOSAddon?.writeApplicationIconsAsync
    if (typeof writeIcons !== 'function') {
      return
    }

    const startedAt = performance.now()
    const missing: Array<{ appPath: string; outputPath: string }> = []
    for (const entry of entries) {
      const outputPath = await this.getCachedIconPath(entry.path)
      if (outputPath && !(await this.pathExists(outputPath))) {
        missing.push({ appPath: entry.path, outputPath })
      }
    }

    for (let index = 0; index < missing.length; index += ICON_PREWARM_BATCH_SIZE) {
      await writeIcons(missing.slice(index, index + ICON_PREWARM_BATCH_SIZE), ICON_SIZE)
    }

    mainLogger.info('[installed-app-service] icon cache prewarmed', {
      apps: entries.length,
      generated: missing.length,
      ms: Math.round(performance.now() - startedAt),
    })
  }

  private loadIconDataUrlFallback(appPath: string) {
    return this.getBundleIconDataUrl(appPath).then((iconDataUrl) => {
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
