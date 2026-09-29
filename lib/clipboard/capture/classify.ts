// Text classification for spec §5.2 (color / link / text). Pure.
import { computeLocalTags } from '@/lib/clipboard/search'
import type { ClipIngestRecord } from '@/lib/clipboard/store/contract'
import { buildPreviewText, deriveTitle, normalizeText, textFingerprint } from '@/lib/clipboard/store/text-utils'
import type { ClipKind, ClipSubKind } from '@/lib/clipboard/types'

const HEX_WITH_HASH = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i
const HEX_BARE_SIX = /^[\da-f]{6}$/i
const CSS_COLOR_FUNCTION = /^(?:rgb|hsl)a?\(\s*[\d.%\s,/a-z-]+\)$/i
const HTTP_URL = /^https?:\/\/\S+$/i
const ANY_SCHEME_URL = /^[a-z][a-z\d+.-]*:\/\/\S+$/i
const MAX_URL_LENGTH = 4096
const TAG_TEXT_MAX_CHARS = 20_000

/**
 * Paste rules: `#` + 3/4/6/8 hex digits; bare 6 hex digits only when at least one A-F letter is present
 * (so a numeric verification code such as `235442` stays text); rgb()/rgba()/hsl()/hsla().
 */
export const isColorText = (value: string) => {
  const candidate = value.trim()
  if (!candidate || candidate.length > 64) {
    return false
  }

  if (HEX_WITH_HASH.test(candidate) || CSS_COLOR_FUNCTION.test(candidate)) {
    return true
  }

  return HEX_BARE_SIX.test(candidate) && /[a-f]/i.test(candidate)
}

export const normalizeColorValue = (value: string) => {
  const candidate = value.trim()
  if (HEX_BARE_SIX.test(candidate)) {
    return `#${candidate.toLowerCase()}`
  }

  return HEX_WITH_HASH.test(candidate) ? candidate.toLowerCase() : candidate
}

export const isHttpUrlText = (value: string) => {
  const candidate = value.trim()
  return candidate.length <= MAX_URL_LENGTH && HTTP_URL.test(candidate)
}

export const isUrlValue = (value: string) => {
  const candidate = value.trim()
  return candidate.length <= MAX_URL_LENGTH && ANY_SCHEME_URL.test(candidate)
}

export type TextClassification = {
  kind: Extract<ClipKind, 'text' | 'link' | 'color'>
  url?: string
  colorValue?: string
  /** Fingerprint of the semantic value. */
  fingerprint: string
  subKind?: ClipSubKind
  tags: string[]
}

const safeLocalTags = (text: string) => {
  try {
    const result = computeLocalTags(text.slice(0, TAG_TEXT_MAX_CHARS))
    return { tags: result.tags, subKind: result.subKind }
  } catch {
    return { tags: [] as string[], subKind: undefined }
  }
}

/** Classifies a plain text value. `urlHint` is a `public.url` representation, which forces a link. */
export const classifyText = (plainText: string, urlHint?: string): TextClassification => {
  const text = normalizeText(plainText)
  const hint = urlHint?.trim()

  if (hint && isUrlValue(hint)) {
    return { kind: 'link', url: hint, fingerprint: textFingerprint(hint), tags: safeLocalTags(hint).tags }
  }

  if (isColorText(text)) {
    const colorValue = normalizeColorValue(text)
    return { kind: 'color', colorValue, fingerprint: textFingerprint(colorValue), tags: [] }
  }

  if (isHttpUrlText(text)) {
    return { kind: 'link', url: text, fingerprint: textFingerprint(text), tags: safeLocalTags(text).tags }
  }

  const local = safeLocalTags(text)
  return { kind: 'text', fingerprint: textFingerprint(text), subKind: local.subKind, tags: local.tags }
}

/** Builds an ingest record for user-authored text (new item), classified like captured text. */
export const buildTextIngestRecord = (text: string, copiedAt: number): ClipIngestRecord => {
  const normalized = normalizeText(text)
  const classification = classifyText(normalized)
  const data = Buffer.from(normalized, 'utf8')
  const fields = { plainText: normalized, url: classification.url, colorValue: classification.colorValue }

  return {
    kind: classification.kind,
    subKind: classification.subKind,
    isRich: false,
    fingerprint: classification.fingerprint,
    title: deriveTitle(classification.kind, fields),
    previewText: buildPreviewText(classification.kind, fields),
    plainText: normalized,
    url: classification.url,
    colorValue: classification.colorValue,
    filePaths: [],
    representations: [{ itemIndex: 0, uti: 'public.utf8-plain-text', data }],
    byteSize: data.length,
    charCount: normalized.length,
    isRemote: false,
    tags: classification.tags,
    copiedAt,
  }
}
