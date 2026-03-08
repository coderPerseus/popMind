import { Menu, app } from 'electron'
import { showMainWindow } from './window-manager'

export const setupApplicationMenu = () => {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              {
                label: '打开配置页面',
                accelerator: 'Command+,',
                click: () => {
                  void showMainWindow('settings')
                },
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : [
          {
            label: '应用',
            submenu: [
              {
                label: '打开配置页面',
                accelerator: 'Ctrl+,',
                click: () => {
                  void showMainWindow('settings')
                },
              },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
