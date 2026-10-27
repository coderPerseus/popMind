// Runs the Electron app's own sync code (archive/electron/lib/clipboard/sync, kept locally) to check the Go port against it.
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { encodeSyncKey } from '../../../archive/electron/lib/clipboard/sync/sync-key.ts'
import { deriveSyncKeys, remoteName, seal, unseal } from '../../../archive/electron/lib/clipboard/sync/sync-crypto.ts'
import { R2Client } from '../../../archive/electron/lib/clipboard/sync/r2-client.ts'

const goSealed = process.argv[2] ?? ''
const creds = {
  accountId: '0123456789abcdef0123456789abcdef',
  bucket: 'popmind-sync',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'secret-value',
  encryptionKey: Buffer.alloc(32, 7),
}
const keys = deriveSyncKeys(creds.encryptionKey)
let auth = ''
const client = new R2Client(
  creds,
  async (_url, init) => {
    auth = init.headers.authorization
    return { status: 200, ok: true, arrayBuffer: async () => new ArrayBuffer(0), text: async () => '' }
  },
  () => new Date('2026-01-02T03:04:05.000Z')
)
await client.put('items/a b+c', Buffer.from('hi'))
const item = deflateRawSync(Buffer.from(JSON.stringify({ v: 1, fp: 'txt:abc', kind: 'text', text: '你好 sync', reps: [] })))
console.log(
  JSON.stringify({
    key: encodeSyncKey(creds),
    name: remoteName(keys, 'item', 'txt:abc'),
    check: seal(keys, Buffer.from('popmind-sync-check-v1')).toString('base64'),
    item: seal(keys, item).toString('base64'),
    auth,
    fromGo: goSealed ? JSON.parse(inflateRawSync(unseal(keys, Buffer.from(goSealed, 'base64'))).toString()).text : '',
  })
)
