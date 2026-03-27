import { CalculatorPanel } from '@/app/components/home/CalculatorPanel'
import type { MainSearchPlugin } from '@/app/plugins/main-search/types'
import type { AppLanguage } from '@/lib/capability/types'
import { translateMessage } from '@/lib/i18n/shared'

const calculatorLogo = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="20" fill="url(#bg)"/>
  <rect x="16" y="12" width="32" height="40" rx="10" fill="white" fill-opacity="0.16"/>
  <rect x="22" y="18" width="20" height="8" rx="4" fill="#FDE68A"/>
  <circle cx="25" cy="34" r="3.5" fill="white"/>
  <circle cx="32" cy="34" r="3.5" fill="white"/>
  <circle cx="39" cy="34" r="3.5" fill="white"/>
  <circle cx="25" cy="43" r="3.5" fill="white"/>
  <path d="M32 39.5H39.5" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <path d="M35.75 36V43.5" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <circle cx="25" cy="43" r="3.5" fill="white"/>
  <path d="M29 43H35" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <defs>
    <linearGradient id="bg" x1="8" y1="10" x2="56" y2="56" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0F172A"/>
      <stop offset="0.5" stop-color="#1D4ED8"/>
      <stop offset="1" stop-color="#0891B2"/>
    </linearGradient>
  </defs>
</svg>
`)}`

export const createCalculatorPlugin = (language: AppLanguage): MainSearchPlugin => ({
  manifest: {
    id: 'tool.calculator',
    title: translateMessage(language, 'plugin.calculator.title'),
    handle: '@calculator',
    slashAliases: ['/cal'],
    order: 0,
    typeLabel: translateMessage(language, 'plugin.type.utility'),
    mode: 'panel',
    keywords: ['calculator', 'calc', 'math', 'compute', 'number', '计算器', '计算'],
    logo: {
      src: calculatorLogo,
      alt: translateMessage(language, 'plugin.calculator.alt'),
      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.94) 0%, rgba(29, 78, 216, 0.94) 100%)',
    },
    description: translateMessage(language, 'plugin.calculator.description'),
  },
  shouldDisplay() {
    return true
  },
  toResult() {
    return this.manifest
  },
  async run() {},
  renderPanel(context) {
    return <CalculatorPanel query={context.query} trigger={context.trigger} setQuery={context.setQuery} />
  },
})
