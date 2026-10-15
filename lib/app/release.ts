export const POPMIND_RELEASES_URL = 'https://github.com/coderPerseus/popMind/releases'
export const POPMIND_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/coderPerseus/popMind/releases/latest'

/** Name of the macOS installer that electron-builder attaches to each release (`pkg.artifactName`). */
export const getReleasePkgFileName = (version: string) => `popmind-${normalizeReleaseVersion(version)}.pkg`

/** Direct download link of the installer, derived from the release tag. */
export const getReleasePkgUrl = (version: string) => {
  const normalized = normalizeReleaseVersion(version)
  return `${POPMIND_RELEASES_URL}/download/v${normalized}/${getReleasePkgFileName(normalized)}`
}

const normalizeSegment = (segment: string) => {
  const value = Number.parseInt(segment, 10)
  return Number.isFinite(value) ? value : 0
}

export const normalizeReleaseVersion = (version: string) => {
  return version.trim().replace(/^v/i, '').split('-')[0] ?? ''
}

export const compareReleaseVersions = (left: string, right: string) => {
  const leftParts = normalizeReleaseVersion(left).split('.')
  const rightParts = normalizeReleaseVersion(right).split('.')
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = normalizeSegment(leftParts[index] ?? '0')
    const rightValue = normalizeSegment(rightParts[index] ?? '0')

    if (leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1
    }
  }

  return 0
}

export type LatestReleaseInfo = {
  version: string
  url: string
  /** Direct link to the macOS installer (.pkg) of this release. */
  downloadUrl: string
  /** Installer size in bytes when GitHub reports it, used to verify the download. */
  downloadSize: number | null
}

export const UPDATE_DOWNLOAD_STATE_CHANNEL = 'app:update-download-state'

export type UpdateDownloadState =
  | { status: 'idle' }
  | { status: 'downloading'; version: string; receivedBytes: number; totalBytes: number | null }
  | { status: 'installing'; version: string; filePath: string }
  | { status: 'failed'; version: string | null; message: string }
