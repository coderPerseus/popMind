import type { MainSearchPlugin } from '@/app/plugins/main-search/types'
import { TodoFocusPanel } from '@/app/components/home/TodoFocusPanel'
import type { AppLanguage } from '@/lib/capability/types'
import { translateMessage } from '@/lib/i18n/shared'

const todoFocusLogo = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="20" fill="url(#bg)"/>
  <rect x="14" y="14" width="36" height="36" rx="12" fill="white" fill-opacity="0.18"/>
  <path d="M22 27.5H42" stroke="white" stroke-width="4" stroke-linecap="round"/>
  <path d="M22 35H36" stroke="white" stroke-width="4" stroke-linecap="round"/>
  <circle cx="41.5" cy="40.5" r="7.5" fill="#FEF3C7"/>
  <path d="M41.5 36.5V41L44 42.5" stroke="#9A3412" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <defs>
    <linearGradient id="bg" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0F172A"/>
      <stop offset="0.55" stop-color="#0F766E"/>
      <stop offset="1" stop-color="#22C55E"/>
    </linearGradient>
  </defs>
</svg>
`)}`

export const createTodoFocusPlugin = (language: AppLanguage): MainSearchPlugin => ({
  manifest: {
    id: 'tool.todo-focus',
    title: translateMessage(language, 'plugin.todoFocus.title'),
    handle: '@todo_focus',
    slashAliases: ['/todo'],
    order: 0,
    typeLabel: translateMessage(language, 'plugin.type.focus'),
    mode: 'panel',
    keywords: ['todo', 'task', 'pomodoro', 'focus', '番茄钟', '待办'],
    logo: {
      src: todoFocusLogo,
      alt: translateMessage(language, 'plugin.todoFocus.alt'),
      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.94) 0%, rgba(13, 148, 136, 0.94) 100%)',
    },
    description: translateMessage(language, 'plugin.todoFocus.description'),
  },
  shouldDisplay() {
    return true
  },
  toResult() {
    return this.manifest
  },
  async run() {},
  renderPanel(context) {
    return <TodoFocusPanel query={context.query} trigger={context.trigger} setQuery={context.setQuery} />
  },
})
