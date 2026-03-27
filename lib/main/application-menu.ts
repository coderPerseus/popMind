import { Menu, app } from 'electron'
import { capabilityService } from '@/lib/capability/service'
import type { AppLanguage } from '@/lib/capability/types'
import { translateMessage } from '@/lib/i18n/shared'
import { showMainWindow } from './window-manager'

const buildApplicationMenu = (language: AppLanguage) => {
  const isMac = process.platform === 'darwin'
  const appName = app.name

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: appName,
            submenu: [
              {
                label: translateMessage(language, 'applicationMenu.openSettings'),
                accelerator: 'Command+,',
                click: () => {
                  void showMainWindow('settings')
                },
              },
              { type: 'separator' as const },
              { label: translateMessage(language, 'applicationMenu.services'), role: 'services' as const },
              { type: 'separator' as const },
              {
                label: translateMessage(language, 'applicationMenu.hide', { appName }),
                role: 'hide' as const,
              },
              { label: translateMessage(language, 'applicationMenu.hideOthers'), role: 'hideOthers' as const },
              { label: translateMessage(language, 'applicationMenu.showAll'), role: 'unhide' as const },
              { type: 'separator' as const },
              { label: translateMessage(language, 'applicationMenu.quit', { appName }), role: 'quit' as const },
            ],
          },
        ]
      : [
          {
            label: translateMessage(language, 'applicationMenu.app'),
            submenu: [
              {
                label: translateMessage(language, 'applicationMenu.openSettings'),
                accelerator: 'Ctrl+,',
                click: () => {
                  void showMainWindow('settings')
                },
              },
              { type: 'separator' as const },
              { label: translateMessage(language, 'applicationMenu.quit', { appName }), role: 'quit' as const },
            ],
          },
        ]),
    {
      label: translateMessage(language, 'applicationMenu.edit'),
      submenu: [
        { label: translateMessage(language, 'applicationMenu.undo'), role: 'undo' as const },
        { label: translateMessage(language, 'applicationMenu.redo'), role: 'redo' as const },
        { type: 'separator' as const },
        { label: translateMessage(language, 'applicationMenu.cut'), role: 'cut' as const },
        { label: translateMessage(language, 'applicationMenu.copy'), role: 'copy' as const },
        { label: translateMessage(language, 'applicationMenu.paste'), role: 'paste' as const },
        { label: translateMessage(language, 'applicationMenu.delete'), role: 'delete' as const },
        { type: 'separator' as const },
        { label: translateMessage(language, 'applicationMenu.selectAll'), role: 'selectAll' as const },
      ],
    },
    {
      label: translateMessage(language, 'applicationMenu.view'),
      submenu: [
        { label: translateMessage(language, 'applicationMenu.reload'), role: 'reload' as const },
        { label: translateMessage(language, 'applicationMenu.forceReload'), role: 'forceReload' as const },
        { label: translateMessage(language, 'applicationMenu.toggleDevTools'), role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { label: translateMessage(language, 'applicationMenu.actualSize'), role: 'resetZoom' as const },
        { label: translateMessage(language, 'applicationMenu.zoomIn'), role: 'zoomIn' as const },
        { label: translateMessage(language, 'applicationMenu.zoomOut'), role: 'zoomOut' as const },
        { type: 'separator' as const },
        { label: translateMessage(language, 'applicationMenu.toggleFullscreen'), role: 'togglefullscreen' as const },
      ],
    },
    {
      label: translateMessage(language, 'applicationMenu.window'),
      submenu: isMac
        ? [
            { label: translateMessage(language, 'applicationMenu.minimize'), role: 'minimize' as const },
            { label: translateMessage(language, 'applicationMenu.zoom'), role: 'zoom' as const },
            { type: 'separator' as const },
            { label: translateMessage(language, 'applicationMenu.closeWindow'), role: 'close' as const },
            { label: translateMessage(language, 'applicationMenu.bringAllToFront'), role: 'front' as const },
          ]
        : [
            { label: translateMessage(language, 'applicationMenu.minimize'), role: 'minimize' as const },
            { label: translateMessage(language, 'applicationMenu.closeWindow'), role: 'close' as const },
          ],
    },
  ]

  return Menu.buildFromTemplate(template)
}

export const setupApplicationMenu = async () => {
  const applyMenu = (language: AppLanguage) => {
    Menu.setApplicationMenu(buildApplicationMenu(language))
  }

  const settings = await capabilityService.getSettings()
  applyMenu(settings.appLanguage)

  return capabilityService.subscribe((nextSettings) => {
    applyMenu(nextSettings.appLanguage)
  })
}
