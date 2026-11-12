// Turns the lucide icons the views use into SVG files embedded by internal/views/icons (go:embed).
// Run: node scripts/gen-icons.mjs  (reads lucide-react from the archived Electron app's node_modules)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const lucide = resolve(here, '../archive/electron/node_modules/lucide-react/dist/esm/icons')
const out = resolve(here, '../internal/views/icons')

// Only the icons the views draw: add a name here when a view starts using one.
const names = `languages circle-question-mark copy message-square ban external-link search x check chevron-down chevron-right
settings pin refresh-cw volume-2 square send-horizontal sparkles globe
calculator app-window clipboard clipboard-list plus info list-filter
ellipsis grip-horizontal grip-vertical keyboard shield-alert key-round search-x
file image link type history
sliders-horizontal pause file-text link-2 files palette calendar-days smartphone square-pen
clipboard-copy clipboard-paste arrow-right`.split(/\s+/).filter(Boolean)

const attrs = (o) => Object.entries(o).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')
for (const name of names) {
  const source = readFileSync(resolve(lucide, `${name}.js`), 'utf8')
  const match = source.match(/const __iconNode = (\[[\s\S]*?\]);\n/)
  if (!match) throw new Error(`no icon node in ${name}`)
  const nodes = Function(`return ${match[1]}`)()
  const body = nodes.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`
  writeFileSync(resolve(out, `${name}.svg`), svg)
}
console.log(`wrote ${names.length} icons`)
