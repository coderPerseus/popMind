import { translateMessage } from '@/lib/i18n/shared'
import type { AppLanguage } from '@/lib/capability/types'
import type { TitlebarMenu } from '@/app/components/window/TitlebarMenu'

export const buildTitlebarMenus = (language: AppLanguage): TitlebarMenu[] => [
  {
    name: translateMessage(language, 'titlebar.menu.file'),
    items: [
      {
        name: translateMessage(language, 'titlebar.item.exit'),
        action: 'window-close',
      },
    ],
  },
  {
    name: translateMessage(language, 'titlebar.menu.edit'),
    items: [
      {
        name: translateMessage(language, 'titlebar.item.undo'),
        action: 'web-undo',
        shortcut: 'Ctrl+Z',
      },
      {
        name: translateMessage(language, 'titlebar.item.redo'),
        action: 'web-redo',
        shortcut: 'Ctrl+Y',
      },
      {
        name: '---',
      },
      {
        name: translateMessage(language, 'titlebar.item.cut'),
        action: 'web-cut',
        shortcut: 'Ctrl+X',
      },
      {
        name: translateMessage(language, 'titlebar.item.copy'),
        action: 'web-copy',
        shortcut: 'Ctrl+C',
      },
      {
        name: translateMessage(language, 'titlebar.item.paste'),
        action: 'web-paste',
        shortcut: 'Ctrl+V',
      },
      {
        name: translateMessage(language, 'titlebar.item.delete'),
        action: 'web-delete',
      },
      {
        name: '---',
      },
      {
        name: translateMessage(language, 'titlebar.item.selectAll'),
        action: 'web-select-all',
        shortcut: 'Ctrl+A',
      },
    ],
  },
  {
    name: translateMessage(language, 'titlebar.menu.view'),
    items: [
      {
        name: translateMessage(language, 'titlebar.item.reload'),
        action: 'web-reload',
        shortcut: 'Ctrl+R',
      },
      {
        name: translateMessage(language, 'titlebar.item.forceReload'),
        action: 'web-force-reload',
        shortcut: 'Ctrl+Shift+R',
      },
      {
        name: translateMessage(language, 'titlebar.item.toggleDevTools'),
        action: 'web-toggle-devtools',
        shortcut: 'Ctrl+Shift+I',
      },
      {
        name: '---',
      },
      {
        name: translateMessage(language, 'titlebar.item.actualSize'),
        action: 'web-actual-size',
        shortcut: 'Ctrl+0',
      },
      {
        name: translateMessage(language, 'titlebar.item.zoomIn'),
        action: 'web-zoom-in',
        shortcut: 'Ctrl++',
      },
      {
        name: translateMessage(language, 'titlebar.item.zoomOut'),
        action: 'web-zoom-out',
        shortcut: 'Ctrl+-',
      },
      {
        name: '---',
      },
      {
        name: translateMessage(language, 'titlebar.item.toggleFullscreen'),
        action: 'web-toggle-fullscreen',
        shortcut: 'F11',
      },
    ],
  },
  {
    name: translateMessage(language, 'titlebar.menu.window'),
    items: [
      {
        name: translateMessage(language, 'titlebar.item.toggleDarkMode'),
        action: 'window-darkmode-toggle',
        shortcut: translateMessage(language, 'titlebar.item.toggle'),
        actionCallback: () => {
          document.documentElement.classList.toggle('dark')
        },
      },
      {
        name: '---',
      },
      {
        name: translateMessage(language, 'titlebar.item.maximize'),
        action: 'window-maximize-toggle',
        shortcut: translateMessage(language, 'titlebar.item.toggle'),
      },
      {
        name: translateMessage(language, 'titlebar.item.minimize'),
        action: 'window-minimize',
        shortcut: 'Ctrl+M',
      },
      {
        name: translateMessage(language, 'titlebar.item.close'),
        action: 'window-close',
        shortcut: 'Ctrl+W',
      },
    ],
  },
  {
    name: translateMessage(language, 'titlebar.menu.credits'),
    items: [
      {
        name: 'Guasam',
        action: 'web-open-url',
        actionParams: ['https://github.com/guasam'],
        shortcut: '@guasam',
      },
    ],
  },
]
