import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

if (process.platform !== 'darwin') {
  console.log('[selection-bridge] skipped: macOS only')
  process.exit(0)
}

const require = createRequire(import.meta.url)
const nodeGypBin = require.resolve('node-gyp/bin/node-gyp.js')
const result = spawnSync(process.execPath, [nodeGypBin, 'rebuild'], {
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
