import type { ClipDatePreset, ClipSourceApp } from '@/lib/clipboard/types'
import { cn } from '@/lib/utils'
import { AppIcon } from '@/app/components/clipboard-panel/panel-parts'
import { datePresetOptions, type PanelTranslate } from '@/app/components/clipboard-panel/panel-utils'

/** Second row under the search bar (⌘F pressed twice): date presets and source apps. */
export function FilterRow({
  t,
  apps,
  appIds,
  datePreset,
  onToggleApp,
  onDateChange,
}: {
  t: PanelTranslate
  apps: ClipSourceApp[]
  appIds: string[]
  datePreset: ClipDatePreset | null
  onToggleApp: (bundleId: string) => void
  onDateChange: (preset: ClipDatePreset | null) => void
}) {
  return (
    <div className="cp-filterrow">
      <div className="cp-filter-group">
        <span className="cp-filter-label">{t('clip.panel.filter.time')}</span>
        {datePresetOptions.map((preset) => (
          <button
            key={preset}
            type="button"
            className={cn('cp-filter-btn', datePreset === preset && 'is-on')}
            onClick={() => onDateChange(datePreset === preset ? null : preset)}
          >
            {t(`clip.panel.date.${preset}`)}
          </button>
        ))}
      </div>
      {apps.length > 0 ? (
        <>
          <div className="cp-filter-sep" />
          <div className="cp-filter-group is-apps">
            <span className="cp-filter-label">{t('clip.panel.filter.app')}</span>
            {apps.slice(0, 16).map((app) => (
              <button
                key={app.bundleId}
                type="button"
                className={cn('cp-filter-btn', appIds.includes(app.bundleId) && 'is-on')}
                onClick={() => onToggleApp(app.bundleId)}
              >
                <AppIcon url={app.iconUrl} name={app.name} className="cp-filter-app-icon" />
                {app.name}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
