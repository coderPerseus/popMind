import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Ellipsis, ListFilter, Pause, Play, Settings, SlidersHorizontal, Sparkles } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
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
  /** Light gray item count shown next to the ⋯ button. */
  countLabel: string
  countHighlighted: boolean
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
  countLabel,
  countHighlighted,
  onToggleStack,
  onOpenSettings,
  restoreFocus,
}: TopBarProps) {
  const kindValue = kinds.length === 1 ? kinds[0] : 'all'
  const rightRef = useRef<HTMLDivElement | null>(null)
  const [sideWidth, setSideWidth] = useState(120)

  // The right group is absolutely positioned; the centered group reserves the same room on both sides so it
  // never shifts when indicators appear.
  useLayoutEffect(() => {
    const element = rightRef.current

    if (!element) {
      return
    }

    const update = () => setSideWidth(Math.ceil(element.getBoundingClientRect().width) + 20)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  const closeFocus = (event: Event) => {
    event.preventDefault()
    restoreFocus()
  }

  return (
    <div className="cp-topbar" style={{ ['--cp-side' as string]: `${sideWidth}px` }}>
      <div className="cp-topbar-center">
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
            <DropdownMenuCheckboxItem checked={kindValue === 'all'} onCheckedChange={() => onKindChange(null)}>
              {t('clip.panel.filter.allTypes')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {kindOptions.map((kind) => (
              <DropdownMenuCheckboxItem
                key={kind}
                checked={kindValue === kind}
                onCheckedChange={() => onKindChange(kind)}
              >
                <KindIcon kind={kind} className="size-3.5" />
                {t(`clip.panel.kind.${kind}`)}
              </DropdownMenuCheckboxItem>
            ))}
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
          // One icon button for every state: spinner while ranking, highlighted while smart ranking is shown.
          <button
            type="button"
            className={cn('cp-icon-btn', ai.status === 'ready' && !ai.dismissed && 'is-on')}
            disabled={ai.status !== 'loading' && ai.status !== 'ready' && !ai.canRun}
            aria-busy={ai.status === 'loading'}
            aria-pressed={ai.status === 'ready' && !ai.dismissed}
            title={
              ai.status === 'loading'
                ? t('clip.panel.ai.loading')
                : ai.status === 'ready'
                  ? ai.dismissed
                    ? t('clip.panel.ai.showSmart')
                    : t('clip.panel.ai.showTime')
                  : `${t('clip.panel.ai.run')} (⌘↩)`
            }
            onClick={ai.status === 'ready' ? ai.onToggleDismissed : ai.status === 'loading' ? undefined : ai.onRun}
          >
            {ai.status === 'loading' ? <Spinner /> : <Sparkles />}
          </button>
        ) : null}

        <div className="cp-topbar-divider" />

        <PinboardTabs {...tabs} />
      </div>

      <div ref={rightRef} className="cp-topbar-right">
        {paused ? (
          <button type="button" className="cp-paused" title={t('clip.panel.pause.resume')} onClick={onResume}>
            <Pause />
            <span>{pausedLabel}</span>
          </button>
        ) : null}

        {stackIndicator}

        <span className={cn('cp-count', countHighlighted && 'is-highlighted')}>{countLabel}</span>

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
    </div>
  )
}
