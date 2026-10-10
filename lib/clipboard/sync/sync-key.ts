// The sync key: one pasteable string holding the R2 credentials and the end-to-end encryption key.
// Format: `pmsync1.<base64url(JSON { a: accountId, b: bucket, k: accessKeyId, s: secretAccessKey, e: encryptionKey })>`.
// Pure (no Electron).
import { createHash, randomBytes } from 'node:crypto'

export const SYNC_KEY_PREFIX = 'pmsync1.'
export const DEFAULT_SYNC_BUCKET = 'popmind-sync'

export type SyncCredentials = {
  accountId: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** 32 random bytes; never leaves the user's devices except inside the sync key. */
  encryptionKey: Buffer
}

const ACCOUNT_ID = /^[0-9a-f]{32}$/i
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/

export const generateEncryptionKey = () => randomBytes(32)

/** R2 S3 credentials of an API token: access key id = token id, secret = SHA-256 of the token value. */
export const s3SecretFromToken = (tokenValue: string) => createHash('sha256').update(tokenValue.trim()).digest('hex')

export const encodeSyncKey = (credentials: SyncCredentials) =>
  SYNC_KEY_PREFIX +
  Buffer.from(
    JSON.stringify({
      a: credentials.accountId,
      b: credentials.bucket,
      k: credentials.accessKeyId,
      s: credentials.secretAccessKey,
      e: credentials.encryptionKey.toString('base64url'),
    })
  ).toString('base64url')

/** Parses a pasted sync key (surrounding whitespace / line breaks tolerated). Returns null when malformed. */
export const parseSyncKey = (input: string): SyncCredentials | null => {
  const text = input.replace(/\s+/g, '')
  if (!text.startsWith(SYNC_KEY_PREFIX)) return null

  try {
    const json = JSON.parse(Buffer.from(text.slice(SYNC_KEY_PREFIX.length), 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
    const { a, b, k, s, e } = json
    if ([a, b, k, s, e].some((value) => typeof value !== 'string' || !value)) return null

    const encryptionKey = Buffer.from(e as string, 'base64url')
    if (!ACCOUNT_ID.test(a as string) || !BUCKET_NAME.test(b as string) || encryptionKey.length !== 32) return null

    return {
      accountId: a as string,
      bucket: b as string,
      accessKeyId: k as string,
      secretAccessKey: s as string,
      encryptionKey,
    }
  } catch {
    return null
  }
}

export const isValidAccountId = (value: string) => ACCOUNT_ID.test(value.trim())
