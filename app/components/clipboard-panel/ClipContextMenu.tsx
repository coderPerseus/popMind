import { createContext, useContext } from 'react'
import {
  Check,
  ClipboardCopy,
  ClipboardPaste,
  ExternalLink,
  Eye,
  FolderSearch,
  Pencil,
  Pin,
  Plus,
  SquarePen,
  Trash2,
} from 'lucide-react'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/app/components/ui/context-menu'
import type { ClipListItem, ClipPasteMode, Pinboard } from '@/lib/clipboard/types'
import {
  canEditText,
  canOpen,
  getPinboardColor,
  type PanelTranslate,
} from '@/app/components/clipboard-panel/panel-utils'

export type PanelActionsValue = {
  t: PanelTranslate
  /** Items the menu acts on (the selection when the right-clicked card is part of it). */
  targets: ClipListItem[]
  pinboards: Pinboard[]
  paste: (mode: ClipPasteMode) => void
  copy: () => void
  preview: () => void
  rename: () => void
  edit: () => void
  open: () => void
  reveal: () => void
  remove: () => void
  togglePinboard: (pinboardId: string) => void
  newPinboard: () => void
  restoreFocus: () => void
}

export const PanelActionsContext = createContext<PanelActionsValue | null>(null)

export function ClipContextMenuContent() {
  const actions = useContext(PanelActionsContext)

  if (!actions) {
    return null
  }

  const { t, targets, pinboards } = actions
  const count = targets.length
  const single = count === 1 ? targets[0] : null

  return (
    <ContextMenuContent
      className="cp-menu w-56"
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        actions.restoreFocus()
      }}
    >
      <ContextMenuItem onSelect={() => actions.paste('default')}>
        <ClipboardPaste />
        {count > 1 ? t('clip.panel.menu.pasteCount', { count }) : t('clip.panel.menu.paste')}
        <ContextMenuShortcut>↩</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => actions.paste('plainText')}>
        <ClipboardPaste />
        {t('clip.panel.menu.pastePlain')}
        <ContextMenuShortcut>⇧↩</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={actions.copy}>
        <ClipboardCopy />
        {t('clip.panel.menu.copy')}
        <ContextMenuShortcut>⌘C</ContextMenuShortcut>
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuSub>
        <ContextMenuSubTrigger className="gap-2">
          <Pin />
          {t('clip.panel.menu.addToPinboard')}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="cp-menu w-48">
          {pinboards.map((pinboard) => {
            const included = count > 0 && targets.every((item) => item.pinboardIds.includes(pinboard.id))

            return (
              <ContextMenuItem key={pinboard.id} onSelect={() => actions.togglePinboard(pinboard.id)}>
                <i className="cp-color-dot" style={{ background: getPinboardColor(pinboard.color) }} />
                <span className="flex-1 truncate">{pinboard.name}</span>
                {included ? <Check /> : null}
              </ContextMenuItem>
            )
          })}
          {pinboards.length > 0 ? <ContextMenuSeparator /> : null}
          <ContextMenuItem onSelect={actions.newPinboard}>
            <Plus />
            {t('clip.panel.menu.newPinboard')}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSeparator />

      {single ? (
        <ContextMenuItem onSelect={actions.preview}>
          <Eye />
          {t('clip.panel.menu.quickLook')}
          <ContextMenuShortcut>Space</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      {single ? (
        <ContextMenuItem onSelect={actions.rename}>
          <Pencil />
          {t('clip.panel.menu.rename')}
          <ContextMenuShortcut>⌘R</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      {single && canEditText(single) ? (
        <ContextMenuItem onSelect={actions.edit}>
          <SquarePen />
          {t('clip.panel.menu.edit')}
          <ContextMenuShortcut>⌘E</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      {single && canOpen(single) ? (
        <ContextMenuItem onSelect={actions.open}>
          <ExternalLink />
          {single.kind === 'link' ? t('clip.panel.menu.openLink') : t('clip.panel.menu.openFile')}
          <ContextMenuShortcut>⌘O</ContextMenuShortcut>
        </ContextMenuItem>
      ) : null}
      {single?.kind === 'file' ? (
        <ContextMenuItem onSelect={actions.reveal}>
          <FolderSearch />
          {t('clip.panel.menu.reveal')}
        </ContextMenuItem>
      ) : null}

      <ContextMenuSeparator />

      <ContextMenuItem variant="destructive" onSelect={actions.remove}>
        <Trash2 />
        {count > 1 ? t('clip.panel.menu.deleteCount', { count }) : t('clip.panel.menu.delete')}
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
