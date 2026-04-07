import type { MainSearchPlugin } from '@/app/plugins/main-search/types'
import type { AppLanguage } from '@/lib/capability/types'
import { translateMessage } from '@/lib/i18n/shared'

export const clipboardHistoryPluginId = 'tool.clipboard-history'

const clipboardHistoryLogo = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="20" fill="url(#bg)"/>
  <rect x="16" y="14" width="32" height="38" rx="10" fill="rgba(255,255,255,0.16)"/>
  <rect x="23" y="11" width="18" height="10" rx="5" fill="#F3F4F6"/>
  <rect x="22" y="28" width="20" height="4" rx="2" fill="#F9FAFB"/>
  <rect x="22" y="36" width="16" height="4" rx="2" fill="#D1D5DB"/>
  <rect x="22" y="44" width="12" height="4" rx="2" fill="#9CA3AF"/>
  <defs>
    <linearGradient id="bg" x1="7" y1="8" x2="56" y2="58" gradientUnits="userSpaceOnUse">
      <stop stop-color="#111827"/>
      <stop offset="0.55" stop-color="#374151"/>
      <stop offset="1" stop-color="#9CA3AF"/>
    </linearGradient>
  </defs>
</svg>
`)}`

export const createClipboardHistoryPlugin = (language: AppLanguage): MainSearchPlugin => ({
  manifest: {
    id: clipboardHistoryPluginId,
    title: translateMessage(language, 'plugin.clipboard.title'),
    handle: '@clipboard',
    slashAliases: ['/clip', '/clipboard'],
    order: 0,
    typeLabel: translateMessage(language, 'plugin.type.utility'),
    mode: 'panel',
    keywords: ['clipboard', 'history', 'paste', 'copy', '剪切板', '剪贴板', '粘贴', '复制'],
    logo: {
      src: clipboardHistoryLogo,
      alt: translateMessage(language, 'plugin.clipboard.alt'),
      background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.94) 0%, rgba(107, 114, 128, 0.94) 100%)',
    },
    description: translateMessage(language, 'plugin.clipboard.description'),
  },
  shouldDisplay() {
    return true
  },
  toResult() {
    return this.manifest
  },
  async run() {},
})
