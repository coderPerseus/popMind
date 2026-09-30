import { useState, type DragEvent } from 'react'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/app/components/ui/context-menu'
import { Input } from '@/app/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { pinboardColors, type Pinboard } from '@/lib/clipboard/types'
import { cn } from '@/lib/utils'
import {
  getPinboardColor,
  pinboardColorValues,
  type PanelTranslate,
} from '@/app/components/clipboard-panel/panel-utils'

export const CLIP_DRAG_TYPE = 'application/x-popmind-clip'

function ColorPicker({ value, onChange, t }: { value: string; onChange: (color: string) => void; t: PanelTranslate }) {
  return (
    <div className="cp-color-picker" role="radiogroup">
      {pinboardColors.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={t(`clip.panel.color.${color}`)}
          title={t(`clip.panel.color.${color}`)}
          className={cn('cp-color-swatch', value === color && 'is-selected')}
          style={{ background: pinboardColorValues[color] }}
          onClick={() => onChange(color)}
        >
          {value === color ? <Check /> : null}
        </button>
      ))}
    </div>
  )
}

function NewPinboardPopover({
  open,
  onOpenChange,
  t,
  onCreate,
  restoreFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  t: PanelTranslate
  onCreate: (name: string, color: string) => void
  restoreFocus: () => void
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>('blue')

  const submit = () => {
    const trimmed = name.trim()

    if (!trimmed) {
      return
    }

    onCreate(trimmed, color)
    onOpenChange(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName('')
          setColor(pinboardColors[Math.floor(Math.random() * (pinboardColors.length - 1))])
        }

        onOpenChange(next)
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="cp-tab cp-tab-add" title={`${t('clip.panel.pinboard.new')} (⇧⌘N)`}>
          <Plus />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="cp-popover w-64"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restoreFocus()
        }}
      >
        <div className="cp-popover-title">{t('clip.panel.pinboard.new')}</div>
        <Input
          autoFocus
          value={name}
          placeholder={t('clip.panel.pinboard.namePlaceholder')}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <ColorPicker value={color} onChange={setColor} t={t} />
        <div className="cp-popover-actions">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t('clip.panel.dialog.cancel')}
          </Button>
          <Button size="sm" disabled={!name.trim()} onClick={submit}>
            {t('clip.panel.pinboard.create')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function PinboardTabs({
  pinboards,
  scopeId,
  t,
  newOpen,
  onNewOpenChange,
  onSelect,
  onCreate,
  onRename,
  onRecolor,
  onDelete,
  onDropItems,
  restoreFocus,
}: {
  pinboards: Pinboard[]
  scopeId: string | null
  t: PanelTranslate
  newOpen: boolean
  onNewOpenChange: (open: boolean) => void
  onSelect: (id: string | null) => void
  onCreate: (name: string, color: string) => void
  onRename: (pinboard: Pinboard) => void
  onRecolor: (pinboard: Pinboard, color: string) => void
  onDelete: (pinboard: Pinboard) => void
  onDropItems: (pinboardId: string, ids: string[]) => void
  restoreFocus: () => void
}) {
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const handleDragOver = (event: DragEvent, id: string) => {
    if (event.dataTransfer.types.includes(CLIP_DRAG_TYPE)) {
      event.preventDefault()
      setDropTarget(id)
    }
  }

  const handleDrop = (event: DragEvent, id: string) => {
    setDropTarget(null)
    const raw = event.dataTransfer.getData(CLIP_DRAG_TYPE)

    if (!raw) {
      return
    }

    event.preventDefault()

    try {
      const ids = JSON.parse(raw) as string[]

      if (Array.isArray(ids) && ids.length > 0) {
        onDropItems(id, ids)
      }
    } catch {
      // ignore malformed drag payloads
    }
  }

  return (
    <div className="cp-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={scopeId === null}
        className={cn('cp-tab', scopeId === null && 'is-active')}
        onClick={() => onSelect(null)}
      >
        {t('clip.panel.tab.history')}
      </button>
      {pinboards.map((pinboard) => (
        <ContextMenu key={pinboard.id}>
          <ContextMenuTrigger asChild>
            <button
              type="button"
              role="tab"
              aria-selected={scopeId === pinboard.id}
              className={cn('cp-tab', scopeId === pinboard.id && 'is-active', dropTarget === pinboard.id && 'is-drop')}
              onClick={() => onSelect(pinboard.id)}
              onDragOver={(event) => handleDragOver(event, pinboard.id)}
              onDragLeave={() => setDropTarget((current) => (current === pinboard.id ? null : current))}
              onDrop={(event) => handleDrop(event, pinboard.id)}
            >
              <i className="cp-color-dot" style={{ background: getPinboardColor(pinboard.color) }} />
              <span className="cp-tab-name">{pinboard.name}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent
            className="cp-menu w-48"
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              restoreFocus()
            }}
          >
            <ContextMenuItem onSelect={() => onRename(pinboard)}>
              <Pencil />
              {t('clip.panel.pinboard.rename')}
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2">
                <i className="cp-color-dot" style={{ background: getPinboardColor(pinboard.color) }} />
                {t('clip.panel.pinboard.color')}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="cp-menu w-40">
                {pinboardColors.map((color) => (
                  <ContextMenuCheckboxItem
                    key={color}
                    checked={pinboard.color === color}
                    onSelect={() => onRecolor(pinboard, color)}
                  >
                    <i className="cp-color-dot" style={{ background: pinboardColorValues[color] }} />
                    <span className="flex-1">{t(`clip.panel.color.${color}`)}</span>
                  </ContextMenuCheckboxItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => onDelete(pinboard)}>
              <Trash2 />
              {t('clip.panel.pinboard.delete')}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
      <NewPinboardPopover
        open={newOpen}
        onOpenChange={onNewOpenChange}
        t={t}
        onCreate={onCreate}
        restoreFocus={restoreFocus}
      />
    </div>
  )
}
