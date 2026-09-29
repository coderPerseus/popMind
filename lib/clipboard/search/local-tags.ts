// Regex based local tags (spec §6.2). Called for every copy, so: bounded input, precompiled patterns, conservative rules.
// Every tag carries zh + en synonyms so that searching "电话" / "phone" finds a bare number.
import type { ClipLocalTagFn, ClipLocalTagResult } from '@/lib/clipboard/search/contract'
import type { ClipSubKind } from '@/lib/clipboard/types'

/** Only the beginning of long texts is scanned. */
const MAX_SCAN_CHARS = 8000
const MAX_JSON_CHARS = 200_000

const TAG_WORDS = {
  phone: ['phone', '电话', '手机'],
  email: ['email', '邮箱', '邮件'],
  url: ['url', 'link', '链接', '网址'],
  ip: ['ip', 'ip地址'],
  'id-card': ['id-card', '身份证', '身份证号'],
  'bank-card': ['bank-card', '银行卡', '卡号'],
  tracking: ['tracking', '快递', '单号', '快递单号', '物流'],
  amount: ['amount', '金额', '价格'],
  date: ['date', '日期'],
  otp: ['otp', '验证码', 'verification-code'],
  code: ['code', '代码'],
  json: ['json'],
  markdown: ['markdown', 'md'],
  path: ['path', '路径', '文件路径'],
} as const

type TagName = keyof typeof TAG_WORDS

// ---- patterns -------------------------------------------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/
const EMAIL_FULL = new RegExp(`^${EMAIL.source}$`)

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[A-Za-z0-9-]+\.[A-Za-z]{2,}[^\s<>"']*/i

const IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])/

// Mainland mobile (optionally +86 / spaces / dashes), landline with area code, US-style number.
const PHONE_CN_MOBILE = /(?<![\d-])(?:\+?86[ -]?)?1[3-9]\d[ -]?\d{4}[ -]?\d{4}(?![\d-])/
const PHONE_CN_LANDLINE = /(?<![\d-])0\d{2,3}-\d{7,8}(?![\d-])/
const PHONE_INTL = /(?<![\w-])\+\d{1,3}[ -]\(?\d{2,4}\)?[ -]\d{3,4}[ -]?\d{3,4}(?![\d-])/
const PHONE_US = /(?<![\w-])\(?\d{3}\)?[ -]\d{3}-\d{4}(?![\d-])/
const PHONE_FULL =
  /^(?:\+?86[ -]?)?1[3-9]\d[ -]?\d{4}[ -]?\d{4}$|^0\d{2,3}-\d{7,8}$|^\+\d{1,3}[ -]\(?\d{2,4}\)?[ -]\d{3,4}[ -]?\d{3,4}$|^\(?\d{3}\)?[ -]\d{3}-\d{4}$/

const ID_CARD =
  /(?<![\dA-Za-z])[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?![\dA-Za-z])/g
const CARD_CANDIDATE = /(?<![\d-])\d(?:[ -]?\d){15,18}(?![\d-])/g

const TRACKING_PREFIXED =
  /(?<![A-Za-z0-9])(?:SF\d{12,15}|YT\d{13}|YD\d{13}|ZTO\d{12,14}|STO\d{10,14}|JT\d{13,15}|JD[A-Z]{0,3}\d{10,15}|DPK\d{11,14}|JDVA\d{10,14})(?![A-Za-z0-9])/i
const TRACKING_EMS = /(?<![A-Za-z0-9])[A-Z]{2}\d{9}[A-Z]{2}(?![A-Za-z0-9])/
const TRACKING_CONTEXT =
  /快递|运单|单号|物流|顺丰|中通|圆通|申通|韵达|极兔|京东|邮政|EMS|tracking|waybill|parcel|shipment/i
const TRACKING_BARE = /(?<![\d.])(?:\d{12}|\d{13}|\d{14}|\d{15})(?![\d.])/

const AMOUNT_SYMBOL = /[¥￥$€£]\s?\d[\d,]*(?:\.\d{1,2})?/
const AMOUNT_UNIT = /\d[\d,]*(?:\.\d{1,2})?\s?(?:元|块钱|万元|USD|CNY|RMB|EUR|美元|人民币)/i

const DATE_PATTERNS = [
  /(?<!\d)(?:19|20)\d{2}[-/.年]\s?\d{1,2}[-/.月]\s?\d{1,2}[日号]?(?!\d)/,
  /(?<!\d)\d{1,2}月\s?\d{1,2}[日号]/,
]

const OTP_BEFORE =
  /(?:验证码|校验码|动态码|确认码|安全码|verification code|security code|passcode|otp|code)[^\d\n]{0,20}(?<!\d)(\d{4,8})(?!\d)/i
const OTP_AFTER = /(?<!\d)(\d{4,8})(?!\d)[^\d\n]{0,12}(?:是您的|为您的|是你的)?(?:验证码|校验码|动态码)/i

const PATH_UNIX = /(?:^|[\s"'(])(?:~|\.{1,2})?\/(?:[\w.@+-]+\/)+[\w.@+-]*/m
const PATH_HOME = /(?:^|[\s"'(])~\/[\w.@+-]+/m
const PATH_WINDOWS = /(?:^|[\s"'(])[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/m
const PATH_FULL = /^(?:~|\.{1,2})?\/(?:[^\s/\0]+\/)*[^\s/\0]+\/?$|^[A-Za-z]:\\[^\r\n]+$/

const CODE_KEYWORDS =
  /\b(?:function|const|let|var|return|import|export|class|interface|async|await|def|elif|lambda|print|public|private|static|void|struct|impl|fn|pub|package|namespace|using|include|SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|CREATE TABLE|console\.log|if|else|for|while|try|catch|throw|new)\b/g
const CODE_SYMBOLS = /[{}();=<>[\]]|=>|->|::|\/\/|\/\*|\*\//g

const MD_HEADING = /^#{1,6}\s+\S/m
const MD_LIST = /^\s*(?:[-*+]|\d+\.)\s+\S/m
const MD_LINK = /\[[^\]\n]+\]\([^)\s]+\)/
const MD_BOLD = /\*\*[^*\n]+\*\*|__[^_\n]+__/
const MD_FENCE = /^```/m
const MD_QUOTE = /^>\s+\S/m
const MD_TABLE = /^\|.+\|\s*\n\|?\s*:?-{3,}/m

const NUMBER_ONLY = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/

// ---- helpers --------------------------------------------------------------------------------

const luhn = (digits: string): boolean => {
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index--) {
    let value = digits.charCodeAt(index) - 48
    if (double) {
      value *= 2
      if (value > 9) value -= 9
    }
    sum += value
    double = !double
  }
  return sum % 10 === 0
}

const ID_CARD_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CARD_CHECK = '10X98765432'
const validIdCard = (value: string): boolean => {
  let sum = 0
  for (let index = 0; index < 17; index++) sum += (value.charCodeAt(index) - 48) * ID_CARD_WEIGHTS[index]
  return ID_CARD_CHECK[sum % 11] === value[17].toUpperCase()
}

const hasValidIdCard = (text: string): boolean => {
  ID_CARD.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ID_CARD.exec(text))) if (validIdCard(match[0])) return true
  return false
}

const hasBankCard = (text: string): boolean => {
  CARD_CANDIDATE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = CARD_CANDIDATE.exec(text))) {
    const digits = match[0].replace(/[ -]/g, '')
    if (digits.length < 16 || digits.length > 19) continue
    // A valid 18-digit id card number is not a bank card, and pure timestamps / repeated digits are noise.
    if (digits.length === 18 && validIdCard(digits) && /^[1-9]\d{5}(?:18|19|20)\d{2}/.test(digits)) continue
    if (/^(\d)\1+$/.test(digits)) continue
    if (luhn(digits)) return true
  }
  return false
}

const looksLikeJson = (text: string): boolean => {
  const trimmed = text.trim()
  if (trimmed.length < 2 || trimmed.length > MAX_JSON_CHARS) return false
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) return false
  try {
    const value = JSON.parse(trimmed)
    // `[1]` or `[]` alone is more likely prose / a placeholder than a JSON document.
    return typeof value === 'object' && value !== null && (Array.isArray(value) ? value.length > 0 : true)
  } catch {
    return false
  }
}

const countMatches = (text: string, pattern: RegExp, cap = 1000): number => {
  pattern.lastIndex = 0
  let count = 0
  while (pattern.exec(text) && count < cap) count++
  return count
}

const looksLikeCode = (text: string): boolean => {
  if (text.length < 15) return false
  const keywordHits = countMatches(text, CODE_KEYWORDS)
  const symbolHits = countMatches(text, CODE_SYMBOLS)
  const lines = text.split('\n')
  const density = symbolHits / text.length
  const indented = lines.filter((line) => /^(?: {2,}|\t)\S/.test(line)).length
  const lineEnders = lines.filter((line) => /[;{}]\s*$/.test(line)).length
  if (keywordHits >= 2 && density > 0.03 && (lines.length > 1 || symbolHits >= 4)) return true
  if (keywordHits >= 1 && density > 0.06 && lines.length > 1) return true
  if (lines.length >= 3 && lineEnders >= 2 && density > 0.03) return true
  if (indented >= 2 && keywordHits >= 1 && density > 0.02) return true
  return false
}

const looksLikeMarkdown = (text: string): boolean => {
  let signals = 0
  if (MD_HEADING.test(text)) signals++
  if (MD_LIST.test(text)) signals++
  if (MD_LINK.test(text)) signals++
  if (MD_BOLD.test(text)) signals++
  if (MD_QUOTE.test(text)) signals++
  if (MD_TABLE.test(text)) signals++
  const fenced = MD_FENCE.test(text)
  return signals >= 2 || (fenced && signals >= 1) || (MD_HEADING.test(text) && text.split('\n').length >= 3)
}

const hasOtp = (text: string): boolean => OTP_BEFORE.test(text) || OTP_AFTER.test(text)

const hasTracking = (text: string): boolean => {
  if (TRACKING_PREFIXED.test(text) || TRACKING_EMS.test(text)) return true
  return TRACKING_CONTEXT.test(text) && TRACKING_BARE.test(text)
}

const hasPhone = (text: string): boolean =>
  PHONE_CN_MOBILE.test(text) || PHONE_CN_LANDLINE.test(text) || PHONE_INTL.test(text) || PHONE_US.test(text)

const hasPath = (text: string): boolean => PATH_UNIX.test(text) || PATH_HOME.test(text) || PATH_WINDOWS.test(text)

// ---- entry ----------------------------------------------------------------------------------

export const computeLocalTags: ClipLocalTagFn = (input: string): ClipLocalTagResult => {
  const raw = (input ?? '').trim()
  if (!raw) return { tags: [] }
  const text = raw.length > MAX_SCAN_CHARS ? raw.slice(0, MAX_SCAN_CHARS) : raw

  const found = new Set<TagName>()
  const isJson = looksLikeJson(raw)
  if (isJson) found.add('json')

  const singleLine = !text.includes('\n')
  const isEmail = singleLine && EMAIL_FULL.test(text)
  const isPhone = singleLine && PHONE_FULL.test(text)
  const isPath = singleLine && PATH_FULL.test(text) && !/^\/\//.test(text)

  if (EMAIL.test(text)) found.add('email')
  if (URL_PATTERN.test(text)) found.add('url')
  if (IPV4.test(text)) found.add('ip')
  if (hasPhone(text)) found.add('phone')
  if (hasValidIdCard(text)) found.add('id-card')
  if (hasBankCard(text)) found.add('bank-card')
  if (hasTracking(text)) found.add('tracking')
  if (AMOUNT_SYMBOL.test(text) || AMOUNT_UNIT.test(text)) found.add('amount')
  if (DATE_PATTERNS.some((pattern) => pattern.test(text))) found.add('date')
  if (hasOtp(text)) found.add('otp')
  if (isPath || (!isJson && hasPath(text) && !URL_PATTERN.test(text))) found.add('path')

  const isCode = !isJson && looksLikeCode(text)
  if (isCode) found.add('code')
  const isMarkdown = !isJson && !isCode && looksLikeMarkdown(text)
  if (isMarkdown) found.add('markdown')

  // A bare 11-digit "phone" that is really a tracking / card number is ambiguous; keep both tags, they are only search hints.

  let subKind: ClipSubKind | undefined
  if (isJson) subKind = 'json'
  else if (isEmail) subKind = 'email'
  else if (isPhone) subKind = 'phone'
  else if (isPath) subKind = 'path'
  else if (isCode) subKind = 'code'
  else if (isMarkdown) subKind = 'markdown'
  else if (singleLine && NUMBER_ONLY.test(text)) subKind = 'number'

  const tags: string[] = []
  for (const name of found) for (const word of TAG_WORDS[name]) if (!tags.includes(word)) tags.push(word)
  return subKind ? { tags, subKind } : { tags }
}
