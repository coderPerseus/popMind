import { Minus, Plus, Settings2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover'
import { Switch } from '@/app/components/ui/switch'
import type { AppLanguage } from '@/lib/capability/types'
import { todoT, type TodoI18nKey } from '@/lib/todo-focus/i18n'
import type { FocusSettings } from '@/lib/todo-focus/types'

type FocusSettingsPopoverProps = {
  settings: FocusSettings
  language: AppLanguage
  onChange: (patch: Partial<FocusSettings>) => void
  onOpenChange: (open: boolean) => void
  onPreviewCelebration: () => void
}

type NumberSetting = {
  key: 'focusMinutes' | 'shortBreakMinutes' | 'longBreakMinutes' | 'longBreakEvery'
  label: TodoI18nKey
  unit: TodoI18nKey
  step: number
  min: number
  max: number
}

const NUMBER_SETTINGS: NumberSetting[] = [
  { key: 'focusMinutes', label: 'focus.settings.focus', unit: 'focus.settings.minutes', step: 5, min: 5, max: 180 },
  {
    key: 'shortBreakMinutes',
    label: 'focus.settings.shortBreak',
    unit: 'focus.settings.minutes',
    step: 1,
    min: 1,
    max: 60,
  },
  {
    key: 'longBreakMinutes',
    label: 'focus.settings.longBreak',
    unit: 'focus.settings.minutes',
    step: 5,
    min: 5,
    max: 90,
  },
  {
    key: 'longBreakEvery',
    label: 'focus.settings.longBreakEvery',
    unit: 'focus.settings.every',
    step: 1,
    min: 2,
    max: 12,
  },
]

export function FocusSettingsPopover({
  settings,
  language,
  onChange,
  onOpenChange,
  onPreviewCelebration,
}: FocusSettingsPopoverProps) {
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className="tf-icon-button" title={todoT(language, 'focus.settings')}>
          <Settings2 size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="tf-popover"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="tf-popover-title">{todoT(language, 'focus.settings')}</div>
        {NUMBER_SETTINGS.map((setting) => {
          const value = settings[setting.key]
          return (
            <div key={setting.key} className="tf-setting-row">
              <span>{todoT(language, setting.label)}</span>
              <div className="tf-stepper">
                <button
                  type="button"
                  disabled={value <= setting.min}
                  onClick={() => onChange({ [setting.key]: Math.max(setting.min, value - setting.step) })}
                >
                  <Minus size={12} />
                </button>
                <span>{todoT(language, setting.unit, { count: value })}</span>
                <button
                  type="button"
                  disabled={value >= setting.max}
                  onClick={() => onChange({ [setting.key]: Math.min(setting.max, value + setting.step) })}
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
          )
        })}
        <div className="tf-setting-row">
          <span>{todoT(language, 'focus.settings.autoStartBreak')}</span>
          <Switch
            checked={settings.autoStartBreak}
            onCheckedChange={(autoStartBreak) => onChange({ autoStartBreak })}
          />
        </div>
        <div className="tf-setting-row">
          <span className="tf-setting-label">
            {todoT(language, 'focus.settings.celebrate')}
            <button type="button" className="tf-link" onClick={onPreviewCelebration}>
              {todoT(language, 'focus.settings.preview')}
            </button>
          </span>
          <Switch checked={settings.celebrate} onCheckedChange={(celebrate) => onChange({ celebrate })} />
        </div>
        <div className="tf-setting-row">
          <span>{todoT(language, 'focus.settings.sound')}</span>
          <Switch checked={settings.sound} onCheckedChange={(sound) => onChange({ sound })} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
