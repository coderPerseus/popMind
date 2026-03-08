const IDENTIFIER_CHAR_PATTERN = /^[\p{L}\p{N}_-]+$/u
const SEPARATOR_PATTERN = /[-_]/u
const CAMEL_CASE_BOUNDARY_PATTERN = /[\p{Ll}\p{N}][\p{Lu}]|[\p{Lu}]{2}[\p{Ll}]/u

export const isCodeLikeIdentifier = (text: string) => {
  if (!text || /\s/.test(text)) {
    return false
  }

  return IDENTIFIER_CHAR_PATTERN.test(text) && (SEPARATOR_PATTERN.test(text) || CAMEL_CASE_BOUNDARY_PATTERN.test(text))
}

export const normalizeTextForTranslation = (text: string) => {
  if (!isCodeLikeIdentifier(text)) {
    return text
  }

  return text
    .replace(/[-_]+/gu, ' ')
    .replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, '$1 $2')
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((token) => (/^[\p{Lu}\p{N}]+$/u.test(token) ? token : token.toLowerCase()))
    .join(' ')
}
