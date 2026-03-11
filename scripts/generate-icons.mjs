import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const png2icons = require('png2icons')

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const rootDir = resolve(__dirname, '..')
const sourcePath = resolve(rootDir, process.argv[2] ?? 'app/assets/logo-mini-size.png')
const buildDir = resolve(rootDir, 'resources/build')

function getPngSize(buffer) {
  const pngSignature = '89504e470d0a1a0a'

  if (buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error(`Expected a PNG source file, got: ${sourcePath}`)
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function buildEmbeddedSvg({ width, height, dataUri, renderedSize }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${renderedSize}" height="${renderedSize}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <image href="${dataUri}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>
</svg>
`
}

mkdirSync(buildDir, { recursive: true })

const pngBuffer = readFileSync(sourcePath)
const { width, height } = getPngSize(pngBuffer)
const pngBase64 = pngBuffer.toString('base64')
const dataUri = `data:image/png;base64,${pngBase64}`

copyFileSync(sourcePath, resolve(buildDir, 'icon.png'))
writeFileSync(resolve(buildDir, 'icon.svg'), buildEmbeddedSvg({ width, height, dataUri, renderedSize: '100%' }))
writeFileSync(resolve(buildDir, 'tray-icon-template.svg'), buildEmbeddedSvg({ width, height, dataUri, renderedSize: '22' }))

const icnsBuffer = png2icons.createICNS(pngBuffer, png2icons.BICUBIC2, 0)
if (!icnsBuffer) {
  throw new Error('png2icons failed to generate icon.icns')
}

const icoBuffer = png2icons.createICO(pngBuffer, png2icons.BICUBIC2, 0, false, true)
if (!icoBuffer) {
  throw new Error('png2icons failed to generate icon.ico')
}

writeFileSync(resolve(buildDir, 'icon.icns'), icnsBuffer)
writeFileSync(resolve(buildDir, 'icon.ico'), icoBuffer)

console.log(`Generated icon assets from ${sourcePath}`)
