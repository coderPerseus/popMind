// Writes the Electron app's default settings as JSON for the Go backend, so both builds share one source of
// truth: internal/settings/defaults/*.json, embedded by the Go code. Run after changing lib/**/shared.ts defaults.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
// The Electron app's sources, archived locally (archive/ is not committed).
const repo = resolve(here, '../archive/electron')
const out = resolve(here, '../internal/settings/defaults')

const server = await createServer({
  configFile: false,
  root: repo,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  resolve: {
    alias: [
      { find: /^electron$/, replacement: resolve(here, 'electron-stub.mjs') },
      { find: '@/lib', replacement: resolve(repo, 'lib') },
      { find: '@/app', replacement: resolve(repo, 'app') },
    ],
  },
  ssr: { noExternal: true },
  optimizeDeps: { noDiscovery: true, entries: [] },
})

try {
  const capability = await server.ssrLoadModule('/lib/capability/shared.ts')
  const shortcuts = await server.ssrLoadModule('/lib/shortcuts/shared.ts')
  const translation = await server.ssrLoadModule('/lib/translation/shared.ts')
  mkdirSync(out, { recursive: true })
  const write = (name, value) => writeFileSync(resolve(out, name), JSON.stringify(value, null, 2) + '\n')
  write('capability-settings.json', capability.defaultCapabilitySettings)
  write('shortcuts.json', shortcuts.defaultShortcutBindings)
  const exported = Object.fromEntries(
    Object.entries(translation).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value) ? true : Array.isArray(value))
  )
  write('translation-shared.json', exported)
  const i18n = await server.ssrLoadModule('/lib/i18n/shared.ts')
  const clipPanel = await server.ssrLoadModule('/lib/clipboard/i18n/panel.ts')
  const clipSettings = await server.ssrLoadModule('/lib/clipboard/i18n/settings.ts')
  const catalogs = {}
  const skipped = []
  for (const lang of ['zh-CN', 'en']) {
    const merged = { ...i18n.messages[lang], ...clipPanel.clipPanelMessages[lang], ...clipSettings.clipSettingsMessages[lang] }
    catalogs[lang] = Object.fromEntries(
      Object.entries(merged).filter(([key, value]) => (typeof value === 'string' ? true : (skipped.push(key), false)))
    )
  }
  writeFileSync(resolve(here, '../internal/i18n/messages.json'), JSON.stringify(catalogs, null, 2) + '\n')
  if (skipped.length) console.log('skipped function messages:', [...new Set(skipped)].join(', '))
  console.log('wrote defaults to', out)
} finally {
  await server.close()
}
