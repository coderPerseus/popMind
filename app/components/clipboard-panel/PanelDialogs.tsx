import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/app/components/ui/alert-dialog'
import { Button } from '@/app/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'
import { Input } from '@/app/components/ui/input'
import { Textarea } from '@/app/components/ui/textarea'
import type { PanelTranslate } from '@/app/components/clipboard-panel/panel-utils'

/** Single line name dialog (rename an item / a pinboard). */
export function NameDialog({
  open,
  t,
  title,
  description,
  initialValue,
  placeholder,
  allowEmpty,
  onSubmit,
  onClose,
}: {
  open: boolean
  t: PanelTranslate
  title: string
  description?: string
  initialValue: string
  placeholder?: string
  /** Empty input is a valid answer (clears a custom title). */
  allowEmpty?: boolean
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) {
      setValue(initialValue)
    }
  }, [open, initialValue])

  const canSubmit = allowEmpty || value.trim().length > 0

  const submit = () => {
    if (canSubmit) {
      onSubmit(value.trim())
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="cp-dialog max-w-sm gap-3 p-4"
        showCloseButton={false}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className={description ? 'text-xs' : 'sr-only'}>{description ?? title}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
        />
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('clip.panel.dialog.cancel')}
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={submit}>
            {t('clip.panel.dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Multi-line dialog for editing a text item or creating a new one. */
export function TextDialog({
  open,
  t,
  title,
  initialValue,
  loading,
  onSubmit,
  onClose,
}: {
  open: boolean
  t: PanelTranslate
  title: string
  initialValue: string
  loading?: boolean
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) {
      setValue(initialValue)
    }
  }, [open, initialValue])

  const canSubmit = !loading && value.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="cp-dialog max-w-xl gap-3 p-4"
        showCloseButton={false}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={loading ? '' : value}
          disabled={loading}
          placeholder={loading ? t('clip.panel.state.loading') : t('clip.panel.dialog.textPlaceholder')}
          className="cp-dialog-textarea"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.metaKey && !event.nativeEvent.isComposing) {
              event.preventDefault()

              if (canSubmit) {
                onSubmit(value)
              }
            }
          }}
        />
        <DialogFooter className="gap-2 sm:gap-2">
          <span className="cp-dialog-hint">⌘↩ {t('clip.panel.dialog.save')}</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('clip.panel.dialog.cancel')}
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => onSubmit(value)}>
            {t('clip.panel.dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDialog({
  open,
  t,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean
  t: PanelTranslate
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent className="cp-dialog max-w-sm p-4" onCloseAutoFocus={(event) => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-xs">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel>{t('clip.panel.dialog.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
