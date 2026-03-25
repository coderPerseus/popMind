import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { app, nativeImage } from 'electron'
import { mainLogger } from '@/lib/main/logger'

const execFileAsync = promisify(execFile)
const DEFAULT_RESULT_LIMIT = 8
const MAX_QUERY_CANDIDATES = 24
const MDLS_FIELDS = ['kMDItemCFBundleIdentifier', 'kMDItemDisplayName', 'kMDItemFSName'] as const

type InstalledAppMetadata = {
  name: string
  fileName: string
  bundleId: string
  path: string
}

export type InstalledAppSearchResult = InstalledAppMetadata & {
  iconDataUrl: string | null
}

const normalizeSearchText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

const escapeSpotlightLiteral = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

const buildSpotlightPattern = (query: string) => {
  const normalized = normalizeSearchText(query)
  if (!normalized) {
    return ''
  }

  return `*${escapeSpotlightLiteral(normalized).replace(/\s+/g, '*')}*`
}

const isNestedApplication = (appPath: string) => /\.app\/Contents\/Applications\/.+\.app$/i.test(appPath)
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

const parseMdlsBatchOutput = (stdout: string, paths: string[]) => {
  const parts = stdout.split('\0')
  const results: InstalledAppMetadata[] = []
  const fieldsPerPath = MDLS_FIELDS.length

  for (let index = 0; index < paths.length; index += 1) {
    const offset = index * fieldsPerPath
    const bundleId = parts[offset]?.trim()
    const displayName = parts[offset + 1]?.trim()
    const fsName = parts[offset + 2]?.trim()
    const fileName = fsName && fsName !== '(null)' ? fsName : basename(paths[index])
    const appName = displayName && displayName !== '(null)' ? displayName : fileName.replace(/\.app$/i, '')

    results.push({
      path: paths[index],
      name: appName,
      fileName,
      bundleId: bundleId && bundleId !== '(null)' ? bundleId : '',
    })
  }

  return results
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

class InstalledAppService {
  private iconCache = new Map<string, Promise<string | null>>()

  async search(query: string, limit = DEFAULT_RESULT_LIMIT): Promise<InstalledAppSearchResult[]> {
    if (process.platform !== 'darwin') {
      return []
    }

    const normalizedQuery = normalizeSearchText(query)
    if (!normalizedQuery) {
      return []
    }

    const candidatePaths = await this.findCandidatePaths(normalizedQuery)
    if (!candidatePaths.length) {
      return []
    }

    const metadata = await this.readMetadataBatch(candidatePaths.slice(0, MAX_QUERY_CANDIDATES))
    const ranked = metadata
      .map((item) => ({
        item,
        score: this.scoreResult(item, normalizedQuery),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name, 'zh-Hans-CN'))
      .slice(0, limit)

    return Promise.all(
      ranked.map(async ({ item }) => ({
        ...item,
        iconDataUrl: await this.getIconDataUrl(item.path),
      }))
    )
  }

  private async findCandidatePaths(query: string) {
    const pattern = buildSpotlightPattern(query)
    if (!pattern) {
      return []
    }

    const expression = [
      `kMDItemContentType == 'com.apple.application-bundle'`,
      `&&`,
      `(`,
      `kMDItemDisplayName == "${pattern}"cd`,
      `|| kMDItemFSName == "${pattern}"cd`,
      `|| kMDItemCFBundleIdentifier == "${pattern}"cd`,
      `)`,
    ].join(' ')

    try {
      const { stdout } = await execFileAsync('mdfind', [expression], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 8,
      })

      return [
        ...new Set(
          stdout
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((appPath) => !isNestedApplication(appPath))
        ),
      ]
    } catch (error) {
      mainLogger.error('[installed-app-service] mdfind failed', { query, error })
      return []
    }
  }

  private async readMetadataBatch(paths: string[]) {
    if (!paths.length) {
      return []
    }

    const args = MDLS_FIELDS.flatMap((field) => ['-raw', '-name', field]).concat(paths)

    try {
      const { stdout } = await execFileAsync('mdls', args, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 8,
      })

      return parseMdlsBatchOutput(stdout, paths)
    } catch (error) {
      mainLogger.error('[installed-app-service] mdls failed', { paths, error })
      return []
    }
  }

  private scoreResult(item: InstalledAppMetadata, normalizedQuery: string) {
    const fileBaseName = item.fileName.replace(/\.app$/i, '')
    return (
      scoreField(normalizeSearchText(item.name), normalizedQuery) +
      scoreField(normalizeSearchText(fileBaseName), normalizedQuery) +
      scoreField(normalizeSearchText(item.bundleId), normalizedQuery)
    )
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
