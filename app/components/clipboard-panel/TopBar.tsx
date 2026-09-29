import type { ComponentProps, ReactNode } from 'react'
import { Ellipsis, ListFilter, Pause, Play, Settings, SlidersHorizontal, Sparkles, Layers } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import { PinboardTabs } from '@/app/components/clipboard-panel/PinboardTabs'
import { SearchField } from '@/app/components/clipboard-panel/SearchField'
import { KindIcon, Spinner } from '@/app/components/clipboard-panel/panel-parts'
import { kindOptions, type PanelTranslate } from '@/app/components/clipboard-panel/panel-utils'
import type { AiSearchState } from '@/app/components/clipboard-panel/use-ai-search'
import type { ClipKind } from '@/lib/clipboard/types'
import { cn } from '@/lib/utils'

export type PauseChoice = '15m' | '1h' | 'forever'

type TopBarProps = {
  t: PanelTranslate
  search: ComponentProps<typeof SearchField>
  tabs: ComponentProps<typeof PinboardTabs>
  kinds: ClipKind[]
  onKindChange: (kind: ClipKind | null) => void
  filterRowOpen: boolean
  onToggleFilterRow: () => void
  ai: {
    enabled: boolean
    status: AiSearchState['status']
    dismissed: boolean
    canRun: boolean
    onRun: () => void
    onToggleDismissed: () => void
  }
  paused: boolean
  pausedLabel: string
  onResume: () => void
  onPause: (choice: PauseChoice) => void
  stackActive: boolean
  stackIndicator: ReactNode
  onToggleStack: () => void
  onOpenSettings: () => void
  restoreFocus: () => void
}

export function TopBar({
  t,
  search,
  tabs,
  kinds,
  onKindChange,
  filterRowOpen,
  onToggleFilterRow,
  ai,
  paused,
  pausedLabel,
  onResume,
  onPause,
  stackActive,
  stackIndicator,
  onToggleStack,
  onOpenSettings,
  restoreFocus,
}: TopBarProps) {
  const kindValue = kinds.length === 1 ? kinds[0] : 'all'
  const closeFocus = (event: Event) => {
    event.preventDefault()
    restoreFocus()
  }

  return (
    <div className="cp-topbar">
      <SearchField {...search} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn('cp-pill-btn', kinds.length > 0 && 'is-on')}
            title={t('clip.panel.filter.type')}
          >
            {kindValue === 'all' ? <ListFilter /> : <KindIcon kind={kindValue} />}
            <span>{kindValue === 'all' ? t('clip.panel.filter.type') : t(`clip.panel.kind.${kindValue}`)}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="cp-menu w-40" onCloseAutoFocus={closeFocus}>
          <DropdownMenuRadioGroup
            value={kindValue}
            onValueChange={(value) => onKindChange(value === 'all' ? null : (value as ClipKind))}
          >
            <DropdownMenuRadioItem value="all">{t('clip.panel.filter.allTypes')}</DropdownMenuRadioItem>
            {kindOptions.map((kind) => (
              <DropdownMenuRadioItem key={kind} value={kind}>
                <KindIcon kind={kind} className="size-3.5" />
                {t(`clip.panel.kind.${kind}`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        className={cn('cp-icon-btn', filterRowOpen && 'is-on')}
        title={`${t('clip.panel.filter.more')} (⌘F ⌘F)`}
        aria-pressed={filterRowOpen}
        onClick={onToggleFilterRow}
      >
        <SlidersHorizontal />
      </button>

      {ai.enabled ? (
        ai.status === 'loading' ? (
          <span className="cp-ai-pill is-loading">
            <Spinner />
            {t('clip.panel.ai.loading')}
          </span>
        ) : ai.status === 'ready' ? (
          <button
            type="button"
            className={cn('cp-ai-pill', !ai.dismissed && 'is-on')}
            title={ai.dismissed ? t('clip.panel.ai.showSmart') : t('clip.panel.ai.showTime')}
            onClick={ai.onToggleDismissed}
          >
            <Sparkles />
            {ai.dismissed ? t('clip.panel.ai.showSmart') : t('clip.panel.ai.showTime')}
          </button>
        ) : (
          <button
            type="button"
            className="cp-icon-btn"
            disabled={!ai.canRun}
            title={`${t('clip.panel.ai.run')} (⌘↩)`}
            onClick={ai.onRun}
          >
            <Sparkles />
          </button>
        )
      ) : null}

      <div className="cp-topbar-divider" />

      <PinboardTabs {...tabs} />

      {paused ? (
        <button type="button" className="cp-paused" title={t('clip.panel.pause.resume')} onClick={onResume}>
          <Pause />
          <span>{pausedLabel}</span>
        </button>
      ) : null}

      {stackIndicator}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="cp-icon-btn" title={t('clip.panel.more.title')}>
            <Ellipsis />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="cp-menu w-56" onCloseAutoFocus={closeFocus}>
          {paused ? (
            <DropdownMenuItem onSelect={onResume}>
              <Play />
              {t('clip.panel.pause.resume')}
              <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Pause />
                {t('clip.panel.pause.title')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="cp-menu w-44">
                <DropdownMenuItem onSelect={() => onPause('15m')}>{t('clip.panel.pause.15m')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onPause('1h')}>{t('clip.panel.pause.1h')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onPause('forever')}>
                  {t('clip.panel.pause.forever')}
                  <DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuCheckboxItem checked={stackActive} onCheckedChange={onToggleStack}>
            <Layers />
            {t('clip.panel.stack.toggle')}
            <DropdownMenuShortcut>⇧⌘C</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenSettings}>
            <Settings />
            {t('clip.panel.more.settings')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
