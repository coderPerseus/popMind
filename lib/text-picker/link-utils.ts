const LEADING_WRAP_RE = /^[<({[\s"'`]+/
const TRAILING_WRAP_RE = /[>)}\]\s"'`，。！？、；：,.!?;:]+$/
const BARE_LINK_RE = /^(?<host>\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?(?:[/?#][^\s]*)?$/i
const HOSTNAME_LABEL_RE = /^[a-z0-9-]+$/i
const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const COMMON_GENERIC_TLDS = new Set([
  'app',
  'art',
  'blog',
  'cc',
  'cloud',
  'club',
  'cn',
  'co',
  'com',
  'dev',
  'digital',
  'email',
  'fm',
  'gg',
  'group',
  'guide',
  'info',
  'io',
  'live',
  'me',
  'media',
  'mobi',
  'name',
  'net',
  'news',
  'online',
  'org',
  'page',
  'pro',
  'shop',
  'site',
  'software',
  'space',
  'store',
  'studio',
  'tech',
  'today',
  'tools',
  'top',
  'tv',
  'uk',
  'us',
  'vip',
  'wiki',
  'work',
  'works',
  'world',
  'xyz',
  'zone',
])

const stripWrappingPunctuation = (value: string) => {
  let nextValue = value.trim()

  while (nextValue && LEADING_WRAP_RE.test(nextValue)) {
    nextValue = nextValue.replace(LEADING_WRAP_RE, '')
  }

  while (nextValue && TRAILING_WRAP_RE.test(nextValue)) {
    nextValue = nextValue.replace(TRAILING_WRAP_RE, '')
  }

  return nextValue
}

const isLikelyWebHostname = (hostname: string) => {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, '')
  if (!normalizedHostname) {
    return false
  }

  if (
    normalizedHostname === 'localhost' ||
    IPV4_RE.test(normalizedHostname) ||
    (normalizedHostname.startsWith('[') && normalizedHostname.endsWith(']'))
  ) {
    return true
  }

  const labels = normalizedHostname.split('.')
  if (labels.length < 2) {
    return false
  }

  if (
    labels.some((label) => !label || label.startsWith('-') || label.endsWith('-') || !HOSTNAME_LABEL_RE.test(label))
  ) {
    return false
  }

  const tld = labels[labels.length - 1]
  return tld.length === 2 || tld.startsWith('xn--') || COMMON_GENERIC_TLDS.has(tld)
}

export const normalizeSelectedLink = (text: string) => {
  const trimmedText = stripWrappingPunctuation(text)
  if (!trimmedText || /\s/.test(trimmedText)) {
    return null
  }

  const withProtocol = (() => {
    if (/^https?:\/\//i.test(trimmedText)) {
      return trimmedText
    }

    const bareLinkMatch = trimmedText.match(BARE_LINK_RE)
    if (!bareLinkMatch?.groups?.host || !isLikelyWebHostname(bareLinkMatch.groups.host)) {
      return null
    }

    return `https://${trimmedText}`
  })()

  if (!withProtocol) {
    return null
  }

  try {
    const url = new URL(withProtocol)
    if (!['http:', 'https:'].includes(url.protocol) || !isLikelyWebHostname(url.hostname)) {
      return null
    }

    return url.toString()
  } catch {
    return null
  }
}

export const isSelectedLink = (text: string) => normalizeSelectedLink(text) !== null
