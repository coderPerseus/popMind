import {
  POPMIND_LATEST_RELEASE_API_URL,
  POPMIND_RELEASES_URL,
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
  }
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

    const payload = (await response.json()) as { tag_name?: unknown; html_url?: unknown }
    const version = typeof payload.tag_name === 'string' ? normalizeReleaseVersion(payload.tag_name) : ''
    const url = typeof payload.html_url === 'string' && payload.html_url ? payload.html_url : POPMIND_RELEASES_URL
    const value = version ? { version, url } : null

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
