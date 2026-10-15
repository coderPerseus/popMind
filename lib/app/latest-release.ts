import {
  POPMIND_LATEST_RELEASE_API_URL,
  POPMIND_RELEASES_URL,
  getReleasePkgFileName,
  getReleasePkgUrl,
  normalizeReleaseVersion,
  type LatestReleaseInfo,
} from './release'

const LATEST_RELEASE_CACHE_TTL_MS = 15 * 60 * 1000

let latestReleaseCache: {
  expiresAt: number
  value: LatestReleaseInfo | null
} | null = null

const getDebugLatestRelease = (): LatestReleaseInfo | null => {
  const version = normalizeReleaseVersion(process.env.POPMIND_DEBUG_LATEST_RELEASE_VERSION ?? '')

  if (!version) {
    return null
  }

  return {
    version,
    url: process.env.POPMIND_DEBUG_LATEST_RELEASE_URL || POPMIND_RELEASES_URL,
    downloadUrl: process.env.POPMIND_DEBUG_LATEST_RELEASE_DOWNLOAD_URL || getReleasePkgUrl(version),
    downloadSize: null,
  }
}

type GitHubReleaseAsset = { name?: unknown; size?: unknown; browser_download_url?: unknown }

const resolvePkgAsset = (version: string, assets: unknown) => {
  const fileName = getReleasePkgFileName(version)
  const list = Array.isArray(assets) ? (assets as GitHubReleaseAsset[]) : []
  const asset =
    list.find((item) => item.name === fileName) ??
    list.find((item) => typeof item.name === 'string' && item.name.toLowerCase().endsWith('.pkg'))

  if (asset && typeof asset.browser_download_url === 'string' && asset.browser_download_url) {
    return {
      downloadUrl: asset.browser_download_url,
      downloadSize: typeof asset.size === 'number' && asset.size > 0 ? asset.size : null,
    }
  }

  return { downloadUrl: getReleasePkgUrl(version), downloadSize: null }
}

export const fetchLatestRelease = async (): Promise<LatestReleaseInfo | null> => {
  const now = Date.now()
  const debugLatestRelease = getDebugLatestRelease()

  if (debugLatestRelease) {
    return debugLatestRelease
  }

  if (latestReleaseCache && latestReleaseCache.expiresAt > now) {
    return latestReleaseCache.value
  }

  try {
    const response = await fetch(POPMIND_LATEST_RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'popMind-update-check',
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub releases API returned ${response.status}`)
    }

    const payload = (await response.json()) as { tag_name?: unknown; html_url?: unknown; assets?: unknown }
    const version = typeof payload.tag_name === 'string' ? normalizeReleaseVersion(payload.tag_name) : ''
    const url = typeof payload.html_url === 'string' && payload.html_url ? payload.html_url : POPMIND_RELEASES_URL
    const value = version ? { version, url, ...resolvePkgAsset(version, payload.assets) } : null

    latestReleaseCache = {
      expiresAt: now + LATEST_RELEASE_CACHE_TTL_MS,
      value,
    }

    return value
  } catch {
    latestReleaseCache = {
      expiresAt: now + 60 * 1000,
      value: null,
    }

    return null
  }
}
