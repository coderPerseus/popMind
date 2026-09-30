import { useEffect, useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/app/components/ui/dialog'
import { tagHue } from '@/app/components/todo-focus/todo-model'
import type { AppLanguage } from '@/lib/capability/types'
import { addDays, startOfWeek, toDayKey } from '@/lib/todo-focus/dates'
import { todoT } from '@/lib/todo-focus/i18n'
import type { TodoPriority, TodoTask } from '@/lib/todo-focus/types'
import { cn } from '@/lib/utils'

export type TaskEdit = {
  title: string
  notes: string
  dueDate: string | null
  dueTime: string | null
  priority: TodoPriority
  tags: string[]
  estimate: number | null
}

type EditTaskDialogProps = {
  task: TodoTask | null
  language: AppLanguage
  onCancel: () => void
  onSave: (task: TodoTask, edit: TaskEdit) => void
}

const PRIORITIES: TodoPriority[] = [0, 1, 2, 3]

export function EditTaskDialog({ task, language, onCancel, onSave }: EditTaskDialogProps) {
  const t = (key: Parameters<typeof todoT>[1], params?: Record<string, string | number>) => todoT(language, key, params)
  const [edit, setEdit] = useState<TaskEdit | null>(null)
  const [tagDraft, setTagDraft] = useState('')

  useEffect(() => {
    setTagDraft('')
    setEdit(
      task
        ? {
            title: task.title,
            notes: task.notes ?? '',
            dueDate: task.dueDate ?? null,
            dueTime: task.dueTime ?? null,
            priority: task.priority,
            tags: task.tags,
            estimate: task.estimate ?? null,
          }
        : null
    )
  }, [task])

  if (!task || !edit) return <Dialog open={false} />

  const patch = (next: Partial<TaskEdit>) => setEdit((current) => (current ? { ...current, ...next } : current))
  const today = new Date()
  const quickDates = [
    { label: todoT(language, 'day.today'), value: toDayKey(today) },
    { label: todoT(language, 'day.tomorrow'), value: toDayKey(addDays(today, 1)) },
    { label: t('edit.nextWeek'), value: toDayKey(addDays(startOfWeek(today), 7)) },
  ]
  const commitTag = () => {
    const tag = tagDraft.trim().replace(/^[#＃]/, '')
    if (tag && !edit.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) {
      patch({ tags: [...edit.tags, tag] })
    }
    setTagDraft('')
  }
  const save = () => {
    if (edit.title.trim()) onSave(task, { ...edit, title: edit.title.trim() })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="tf-dialog"
        showCloseButton={false}
        aria-describedby={undefined}
        // Esc closes only the dialog, not the whole launcher (MainSearch hides on any Esc).
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.metaKey) {
            event.preventDefault()
            save()
          }
        }}
      >
        <DialogTitle className="tf-dialog-title">{t('edit.title')}</DialogTitle>

        <input
          className="tf-field tf-field-title"
          value={edit.title}
          autoFocus
          onChange={(event) => patch({ title: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.metaKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              save()
            }
          }}
          aria-label={t('edit.name')}
        />
        <textarea
          className="tf-field tf-field-notes"
          value={edit.notes}
          placeholder={t('edit.notesPlaceholder')}
          rows={3}
          onChange={(event) => patch({ notes: event.target.value })}
          aria-label={t('edit.notes')}
        />

        <div className="tf-form-row">
          <span className="tf-form-label">{t('edit.date')}</span>
          <div className="tf-form-controls">
            <div className="tf-segmented">
              {quickDates.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className={cn(edit.dueDate === option.value && 'is-active')}
                  onClick={() => patch({ dueDate: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <input
              type="date"
              className="tf-field tf-field-date"
              value={edit.dueDate ?? ''}
              onChange={(event) => patch({ dueDate: event.target.value || null })}
            />
            {edit.dueDate ? (
              <input
                type="time"
                className="tf-field tf-field-time"
                value={edit.dueTime ?? ''}
                onChange={(event) => patch({ dueTime: event.target.value || null })}
                aria-label={t('edit.time')}
              />
            ) : null}
            {edit.dueDate ? (
              <button
                type="button"
                className="tf-icon-button"
                title={t('edit.clear')}
                onClick={() => patch({ dueDate: null, dueTime: null })}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="tf-form-row">
          <span className="tf-form-label">{t('edit.priority')}</span>
          <div className="tf-segmented">
            {PRIORITIES.map((priority) => (
              <button
                key={priority}
                type="button"
                className={cn(edit.priority === priority && 'is-active')}
                onClick={() => patch({ priority })}
              >
                {priority ? <span className={cn('tf-priority-dot', `is-p${priority}`)} /> : null}
                {priority ? t(`priority.${priority}` as 'priority.1') : t('priority.none')}
              </button>
            ))}
          </div>
        </div>

        <div className="tf-form-row">
          <span className="tf-form-label">{t('edit.tags')}</span>
          <div className="tf-form-controls tf-tag-editor">
            {edit.tags.map((tag) => (
              <span key={tag} className="tf-tag is-chip" style={{ '--tf-tag-hue': tagHue(tag) } as React.CSSProperties}>
                #{tag}
                <button type="button" onClick={() => patch({ tags: edit.tags.filter((item) => item !== tag) })}>
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              className="tf-tag-input"
              value={tagDraft}
              placeholder={t('edit.tagsPlaceholder')}
              onChange={(event) => setTagDraft(event.target.value)}
              onBlur={commitTag}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                  event.preventDefault()
                  commitTag()
                } else if (event.key === 'Backspace' && !tagDraft && edit.tags.length) {
                  patch({ tags: edit.tags.slice(0, -1) })
                }
              }}
            />
          </div>
        </div>

        <div className="tf-form-row">
          <span className="tf-form-label">{t('edit.estimate')}</span>
          <div className="tf-stepper">
            <button
              type="button"
              onClick={() => patch({ estimate: edit.estimate && edit.estimate > 1 ? edit.estimate - 1 : null })}
            >
              <Minus size={12} />
            </button>
            <span>{edit.estimate ?? '—'}</span>
            <button type="button" onClick={() => patch({ estimate: Math.min((edit.estimate ?? 0) + 1, 99) })}>
              <Plus size={12} />
            </button>
          </div>
          {task.focusMinutes > 0 ? (
            <span className="tf-form-note">
              {t('task.focusTotal', { minutes: task.focusMinutes, pomodoros: task.pomodoros })}
            </span>
          ) : null}
        </div>

        <div className="tf-dialog-footer">
          <button type="button" className="tf-button" onClick={onCancel}>
            {t('edit.cancel')}
          </button>
          <button type="button" className="tf-button is-primary" disabled={!edit.title.trim()} onClick={save}>
            {t('edit.save')}
            <kbd>⌘↩</kbd>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
