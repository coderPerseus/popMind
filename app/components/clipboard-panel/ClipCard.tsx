import { memo } from 'react'
import { Files, Globe, Smartphone } from 'lucide-react'
import type { AppLanguage } from '@/lib/capability/types'
import type { ClipListItem } from '@/lib/clipboard/types'
import { cn } from '@/lib/utils'
import { AppIcon, HighlightedText, KindIcon } from '@/app/components/clipboard-panel/panel-parts'
import {
  NEUTRAL_HEADER_COLOR,
  formatBytes,
  formatRelativeTime,
  getDomain,
  readableTextColor,
  type PanelTranslate,
} from '@/app/components/clipboard-panel/panel-utils'

export type ClipCardProps = {
  item: ClipListItem
  selected: boolean
  active: boolean
  /** 1–9 quick paste number, only passed while ⌘ is held. */
  badge?: number
  now: number
  language: AppLanguage
  t: PanelTranslate
  /** pinboard id → css color */
  pinboardColors: Record<string, string>
}

const isMono = (item: ClipListItem) => item.subKind === 'code' || item.subKind === 'json'

function CardKindLabel({ item, t }: { item: ClipListItem; t: PanelTranslate }) {
  if (item.kind === 'text' && item.subKind) {
    return <>{t(`clip.panel.subKind.${item.subKind}`)}</>
  }

  if (item.kind === 'text' && item.isRich) {
    return <>{t('clip.panel.kind.richText')}</>
  }

  return <>{t(`clip.panel.kind.${item.kind}`)}</>
}

function TextBody({ item }: { item: ClipListItem }) {
  const match = item.match
  const bodyMatch = match?.field === 'body' ? match : undefined
  const titleMatch = match?.field === 'title' ? match : undefined
  const text = bodyMatch?.snippet || item.previewText
  const showTitle = Boolean(item.customTitle || titleMatch)

  return (
    <div className={cn('cp-text', isMono(item) && 'is-mono')}>
      {showTitle ? (
        <div className="cp-card-title">
          <HighlightedText text={item.title} ranges={titleMatch?.ranges} />
        </div>
      ) : null}
      <div className="cp-text-body">
        <HighlightedText text={text} ranges={bodyMatch?.ranges} />
      </div>
    </div>
  )
}

function LinkBody({ item, t }: { item: ClipListItem; t: PanelTranslate }) {
  const domain = getDomain(item.url)
  const urlMatch = item.match?.field === 'url' ? item.match : undefined
  const titleMatch = item.match?.field === 'title' ? item.match : undefined
  const hasTitle = item.title && item.title !== item.url

  return (
    <div className="cp-link">
      {item.thumbnailUrl ? <img className="cp-link-thumb" src={item.thumbnailUrl} alt="" draggable={false} /> : null}
      <div className="cp-link-title">
        {hasTitle ? <HighlightedText text={item.title} ranges={titleMatch?.ranges} /> : t('clip.panel.kind.link')}
      </div>
      <div className="cp-link-domain">
        <Globe />
        <span>{domain}</span>
      </div>
      <div className="cp-link-url">
        {urlMatch ? <HighlightedText text={urlMatch.snippet} ranges={urlMatch.ranges} /> : item.url}
      </div>
    </div>
  )
}

function ImageBody({ item, t }: { item: ClipListItem; t: PanelTranslate }) {
  const ocrMatch = item.match?.field === 'ocr' ? item.match : undefined

  return (
    <div className="cp-image">
      {item.thumbnailUrl ? (
        <img src={item.thumbnailUrl} alt={item.title} draggable={false} loading="lazy" />
      ) : (
        <KindIcon kind="image" className="cp-image-placeholder" />
      )}
      {ocrMatch ? (
        <>
          <span className="cp-ocr-badge">{t('clip.panel.card.ocrMatch')}</span>
          <div className="cp-ocr-snippet">
            <HighlightedText text={ocrMatch.snippet} ranges={ocrMatch.ranges} />
          </div>
        </>
      ) : null}
    </div>
  )
}

function ColorBody({ item }: { item: ClipListItem }) {
  const value = item.colorValue ?? item.previewText
  return (
    <div className="cp-color" style={{ background: value, color: readableTextColor(value) }}>
      <span className="cp-color-value">{value.toUpperCase()}</span>
    </div>
  )
}

function FileBody({ item, t }: { item: ClipListItem; t: PanelTranslate }) {
  const names = item.fileNames?.length ? item.fileNames : [item.title]
  const shown = names.slice(0, 4)
  const rest = Math.max(0, item.fileCount - shown.length)

  return (
    <div className="cp-files">
      {item.thumbnailUrl ? (
        <img className="cp-file-thumb" src={item.thumbnailUrl} alt="" draggable={false} loading="lazy" />
      ) : (
        <div className="cp-file-icon">{item.fileCount > 1 ? <Files /> : <KindIcon kind="file" />}</div>
      )}
      <ul className="cp-file-names">
        {shown.map((name, index) => (
          <li key={`${name}-${index}`}>{name}</li>
        ))}
        {rest > 0 ? <li className="is-more">{t('clip.panel.card.moreFiles', { count: rest })}</li> : null}
      </ul>
    </div>
  )
}

function CardFooterText({ item, t }: { item: ClipListItem; t: PanelTranslate }) {
  switch (item.kind) {
    case 'image': {
      const size = formatBytes(item.byteSize)
      return <>{item.imageWidth && item.imageHeight ? `${item.imageWidth}×${item.imageHeight} · ${size}` : size}</>
    }
    case 'file':
      return <>{`${t('clip.panel.card.files', { count: item.fileCount })} · ${formatBytes(item.byteSize)}`}</>
    case 'color':
      return <>{(item.colorValue ?? '').toUpperCase()}</>
    default:
      return <>{t('clip.panel.card.chars', { count: item.charCount })}</>
  }
}

export const ClipCard = memo(function ClipCard({
  item,
  selected,
  active,
  badge,
  now,
  language,
  t,
  pinboardColors,
}: ClipCardProps) {
  const headerColor = item.source?.color ?? NEUTRAL_HEADER_COLOR
  const headerText = readableTextColor(headerColor)
  const pinDots = item.pinboardIds.slice(0, 3)

  return (
    <div
      className="cp-card"
      data-kind={item.kind}
      data-selected={selected || undefined}
      data-active={active || undefined}
      data-clip-id={item.id}
    >
      <div className="cp-card-head" style={{ background: headerColor, color: headerText }}>
        <div className="cp-card-head-text">
          <span className="cp-card-kind">
            <CardKindLabel item={item} t={t} />
            {item.isRemote ? <Smartphone className="cp-card-remote" /> : null}
          </span>
          <span className="cp-card-time">{formatRelativeTime(t, language, item.lastCopiedAt, now)}</span>
        </div>
        {item.source ? (
          <AppIcon url={item.source.iconUrl} name={item.source.name} className="cp-card-app-icon" />
        ) : (
          <KindIcon kind={item.kind} className="cp-card-app-glyph" />
        )}
      </div>

      <div className="cp-card-body">
        {item.kind === 'text' ? <TextBody item={item} /> : null}
        {item.kind === 'link' ? <LinkBody item={item} t={t} /> : null}
        {item.kind === 'image' ? <ImageBody item={item} t={t} /> : null}
        {item.kind === 'color' ? <ColorBody item={item} /> : null}
        {item.kind === 'file' ? <FileBody item={item} t={t} /> : null}
      </div>

      <div className="cp-card-foot">
        <span className="cp-card-foot-text">
          <CardFooterText item={item} t={t} />
        </span>
        <span className="cp-card-foot-right">
          {pinDots.map((id) => (
            <i key={id} className="cp-pin-dot" style={{ background: pinboardColors[id] ?? NEUTRAL_HEADER_COLOR }} />
          ))}
          {badge ? <kbd className="cp-card-badge">{badge}</kbd> : null}
        </span>
      </div>
    </div>
  )
})
