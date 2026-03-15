export const POPMIND_RELEASES_URL = 'https://github.com/coderPerseus/popMind/releases'
export const POPMIND_LATEST_RELEASE_API_URL = 'https://api.github.com/repos/coderPerseus/popMind/releases/latest'

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
}
