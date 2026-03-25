const LEADING_WRAP_RE = /^[<({[\s"'`]+/
const TRAILING_WRAP_RE = /[>)}\]\s"'`，。！？、；：,.!?;:]+$/
const DOMAIN_LIKE_RE = /^(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s]*)?$/i

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

export const normalizeSelectedLink = (text: string) => {
  const trimmedText = stripWrappingPunctuation(text)
  if (!trimmedText || /\s/.test(trimmedText)) {
    return null
  }

  const withProtocol =
    /^https?:\/\//i.test(trimmedText) ? trimmedText : DOMAIN_LIKE_RE.test(trimmedText) ? `https://${trimmedText}` : null

  if (!withProtocol) {
    return null
  }

  try {
    const url = new URL(withProtocol)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      return null
    }

    return url.toString()
  } catch {
    return null
  }
}

export const isSelectedLink = (text: string) => normalizeSelectedLink(text) !== null
