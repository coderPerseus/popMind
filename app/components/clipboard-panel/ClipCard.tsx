import { memo, useRef } from 'react'
import { Globe, KeyRound, Smartphone } from 'lucide-react'
import type { AppLanguage } from '@/lib/capability/types'
import type { ClipListItem } from '@/lib/clipboard/types'
import { cn } from '@/lib/utils'
import { AppIcon, FileTypeIcon, HighlightedText, KindIcon } from '@/app/components/clipboard-panel/panel-parts'
import { useInViewport, useLinkPreview } from '@/app/components/clipboard-panel/use-link-preview'
import {
  NEUTRAL_HEADER_COLOR,
  formatBytes,
  formatRelativeTime,
  getDomain,
  middleEllipsis,
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

function LinkBody({ item }: { item: ClipListItem }) {
  const ref = useRef<HTMLDivElement>(null)
  // Page screenshots only load for cards on screen; cards in the overscan stay plain text.
  const visible = useInViewport(ref)
  const preview = useLinkPreview(item.url, visible)
  const ready = preview?.status === 'ready' ? preview : undefined
  const domain = getDomain(item.url)
  const titleMatch = item.match?.field === 'title' ? item.match : undefined
  // Without a custom title the indexed title is the URL itself, so a title hit is a URL hit.
  const urlMatch = item.match?.field === 'url' ? item.match : !item.customTitle ? titleMatch : undefined
  // The derived title of a link is its URL; only a custom or page title is worth a separate line.
  const title = item.customTitle || ready?.title
  const imageUrl = visible ? ready?.imageUrl : undefined

  return (
    <div ref={ref} className="cp-link" data-has-image={imageUrl ? true : undefined}>
      {imageUrl ? (
        <img className="cp-link-shot" src={imageUrl} alt="" draggable={false} decoding="async" />
      ) : item.thumbnailUrl ? (
        <img className="cp-link-thumb" src={item.thumbnailUrl} alt="" draggable={false} />
      ) : null}
      {title ? (
        <div className="cp-link-title">
          <HighlightedText text={title} ranges={item.customTitle ? titleMatch?.ranges : undefined} />
        </div>
      ) : null}
      <div className="cp-link-domain">
        <Globe />
        <span>{ready?.siteName || domain}</span>
      </div>
      {/* Without a title the URL is the content; with one, only a URL search hit is shown again. */}
      {!title || urlMatch ? (
        <div className={cn('cp-link-url', !title && 'is-main')}>
          {urlMatch ? <HighlightedText text={urlMatch.snippet} ranges={urlMatch.ranges} /> : item.url}
        </div>
      ) : null}
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
  const multiple = item.fileCount > 1

  if (!multiple) {
    return (
      <div className="cp-files is-single">
        <FileTypeIcon itemId={item.id} />
        <div className="cp-file-name" title={names[0]}>
          {middleEllipsis(names[0])}
        </div>
      </div>
    )
  }

  const shown = names.slice(0, 4)
  const rest = Math.max(0, item.fileCount - shown.length)

  return (
    <div className="cp-files">
      <FileTypeIcon itemId={item.id} multiple />
      <ul className="cp-file-names">
        {shown.map((name, index) => (
          <li key={`${name}-${index}`} title={name}>
            {middleEllipsis(name, 26)}
          </li>
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
      // Text and links show their length in the header instead.
      return null
  }
}

const showsLengthInHeader = (item: ClipListItem) => item.kind === 'text' || item.kind === 'link'

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
  const pinDots = item.pinboardIds.slice(0, 3)

  return (
    <div
      className="cp-card"
      data-kind={item.kind}
      data-selected={selected || undefined}
      data-active={active || undefined}
      data-secret={item.hasSecret || undefined}
      data-clip-id={item.id}
    >
      <div className="cp-card-head">
        <div className="cp-card-head-text">
          <span className="cp-card-kind">
            <CardKindLabel item={item} t={t} />
          </span>
          {item.isRemote ? <Smartphone className="cp-card-remote" /> : null}
          {item.hasSecret ? (
            <span className="cp-card-secret" title={t('clip.panel.card.secret')}>
              <KeyRound />
            </span>
          ) : null}
          <span className="cp-card-time">
            {' · '}
            {formatRelativeTime(t, language, item.lastCopiedAt, now)}
            {showsLengthInHeader(item) ? ` · ${t('clip.panel.card.charsShort', { count: item.charCount })}` : null}
          </span>
        </div>
        {item.source ? (
          <AppIcon url={item.source.iconUrl} name={item.source.name} className="cp-card-app-icon" />
        ) : (
          <KindIcon kind={item.kind} className="cp-card-app-glyph" />
        )}
      </div>

      <div className="cp-card-body">
        {item.kind === 'text' ? <TextBody item={item} /> : null}
        {item.kind === 'link' ? <LinkBody item={item} /> : null}
        {item.kind === 'image' ? <ImageBody item={item} t={t} /> : null}
        {item.kind === 'color' ? <ColorBody item={item} /> : null}
        {item.kind === 'file' ? <FileBody item={item} t={t} /> : null}
      </div>

      {showsLengthInHeader(item) && pinDots.length === 0 ? (
        // No footer row: the ⌘ number floats over the body corner so holding ⌘ does not resize the card.
        badge ? (
          <kbd className="cp-card-badge is-floating">{badge}</kbd>
        ) : null
      ) : (
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
      )}
    </div>
  )
})
