// End-to-end encryption for synced objects (pure, node:crypto only).
// Object names are keyed hashes so the bucket reveals nothing about content; bodies are AES-256-GCM.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'

const FORMAT_VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16

export type SyncKeys = { content: Buffer; names: Buffer }

export const deriveSyncKeys = (master: Buffer): SyncKeys => ({
  content: Buffer.from(hkdfSync('sha256', master, 'popmind-sync', 'content-v1', 32)),
  names: Buffer.from(hkdfSync('sha256', master, 'popmind-sync', 'names-v1', 32)),
})

/** Stable opaque object name for a value in a namespace (`item`, `blob`, `pinboard`). */
export const remoteName = (keys: SyncKeys, namespace: string, value: string) =>
  createHmac('sha256', keys.names).update(`${namespace}\n${value}`).digest('hex').slice(0, 40)

export const seal = (keys: SyncKeys, plaintext: Buffer): Buffer => {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keys.content, iv)
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, body, cipher.getAuthTag()])
}

/** Throws when the data was not sealed with these keys (wrong sync key) or is corrupt. */
export const unseal = (keys: SyncKeys, data: Buffer): Buffer => {
  if (data.length < 1 + IV_BYTES + TAG_BYTES || data[0] !== FORMAT_VERSION) {
    throw new Error('unsupported sync object format')
  }
  const iv = data.subarray(1, 1 + IV_BYTES)
  const tag = data.subarray(data.length - TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', keys.content, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data.subarray(1 + IV_BYTES, data.length - TAG_BYTES)), decipher.final()])
}
