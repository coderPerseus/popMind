import { useMemo, useState, type ReactNode } from 'react'
import { ClipboardCopy, ClipboardPaste, ExternalLink, X } from 'lucide-react'
import type { AppLanguage } from '@/lib/capability/types'
import type { ClipDetail, ClipListItem } from '@/lib/clipboard/types'
import { Button } from '@/app/components/ui/button'
import { AppIcon, KindIcon, Spinner } from '@/app/components/clipboard-panel/panel-parts'
import {
  colorToRgbLabel,
  copyTextToClipboard,
  formatBytes,
  formatDateTime,
  getDomain,
  type PanelTranslate,
  QUICK_LOOK_TEXT_LIMIT,
} from '@/app/components/clipboard-panel/panel-utils'
import { cn } from '@/lib/utils'

const LimitedText = ({
  text,
  className,
  note,
}: {
  text: string
  className: string
  note: (count: string) => string
}) => {
  if (text.length <= QUICK_LOOK_TEXT_LIMIT) {
    return <pre className={className}>{text}</pre>
  }

  return (
    <>
      <p className="cp-ql-note">{note(QUICK_LOOK_TEXT_LIMIT.toLocaleString())}</p>
      <pre className={className}>{text.slice(0, QUICK_LOOK_TEXT_LIMIT)}…</pre>
    </>
  )
}

const buildSrcDoc = (html: string) =>
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: popmind-clip:; style-src 'unsafe-inline'">` +
  `<base target="_blank">` +
  `<style>html{background:#fff}body{margin:14px;color:#1d1d1f;font:13px/1.5 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;word-break:break-word}img{max-width:100%}</style>` +
  `</head><body>${html}</body></html>`

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cp-ql-meta-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function QuickLook({
  item,
  detail,
  language,
  t,
  onClose,
  onPaste,
  onOpen,
  onNotify,
}: {
  item: ClipListItem
  /** undefined while loading, null when the item no longer exists. */
  detail: ClipDetail | null | undefined
  language: AppLanguage
  t: PanelTranslate
  onClose: () => void
  onPaste: () => void
  onOpen: () => void
  onNotify: (text: string) => void
}) {
  const hasHtml = Boolean(detail?.html)
  const [mode, setMode] = useState<'rich' | 'plain'>('rich')
  const srcDoc = useMemo(() => (detail?.html ? buildSrcDoc(detail.html) : ''), [detail?.html])
  const headerColor = item.source?.color

  const copyOcr = async () => {
    if (detail?.ocrText && (await copyTextToClipboard(detail.ocrText))) {
      onNotify(t('clip.panel.quickLook.ocrCopied'))
    }
  }

  const renderMain = () => {
    switch (item.kind) {
      case 'image':
        return (
          <div className="cp-ql-image-wrap">
            <img
              className="cp-ql-image"
              src={detail?.imageUrl ?? item.thumbnailUrl}
              alt={item.title}
              draggable={false}
            />
            {detail?.ocrText ? (
              <div className="cp-ql-ocr">
                <div className="cp-ql-ocr-head">
                  <span>{t('clip.panel.quickLook.ocrText')}</span>
                  <Button variant="ghost" size="xs" onClick={copyOcr}>
                    <ClipboardCopy />
                    {t('clip.panel.quickLook.copyOcr')}
                  </Button>
                </div>
                <pre className="cp-ql-text">{detail.ocrText}</pre>
              </div>
            ) : null}
          </div>
        )
      case 'color': {
        const value = (item.colorValue ?? item.previewText).toUpperCase()
        return (
          <div className="cp-ql-color">
            <div className="cp-ql-swatch" style={{ background: value }} />
            <div className="cp-ql-color-values">
              <b>{value}</b>
              <span>{colorToRgbLabel(value)}</span>
            </div>
          </div>
        )
      }
      case 'file':
        return (
          <ul className="cp-ql-paths cp-ql-text">
            {(detail?.filePaths?.length ? detail.filePaths : (item.fileNames ?? [])).map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        )
      case 'link':
        return (
          <div className="cp-ql-link">
            {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" draggable={false} /> : null}
            {item.title && item.title !== item.url ? <h3>{item.title}</h3> : null}
            <a
              className="cp-ql-url cp-ql-text"
              href={item.url}
              onClick={(event) => {
                event.preventDefault()
                onOpen()
              }}
            >
              {item.url}
            </a>
            {detail?.plainText && detail.plainText !== item.url ? (
              <LimitedText
                text={detail.plainText}
                className="cp-ql-text"
                note={(count) => t('clip.panel.quickLook.truncated', { count })}
              />
            ) : null}
          </div>
        )
      default:
        if (hasHtml && mode === 'rich') {
          // Rich text is untrusted: no scripts, no origin, no network (see CSP inside the document).
          return <iframe className="cp-ql-frame" title={item.title} sandbox="" srcDoc={srcDoc} />
        }

        return (
          <LimitedText
            text={detail ? (detail.plainText ?? item.previewText) : item.previewText}
            className={cn('cp-ql-text', (item.subKind === 'code' || item.subKind === 'json') && 'is-mono')}
            note={(count) => t('clip.panel.quickLook.truncated', { count })}
          />
        )
    }
  }

  return (
    <div className="cp-ql-backdrop" onMouseDown={onClose}>
      <div
        className="cp-ql"
        role="region"
        aria-label={t('clip.panel.quickLook.title')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="cp-ql-head" style={headerColor ? { boxShadow: `inset 0 -2px 0 ${headerColor}` } : undefined}>
          <div className="cp-ql-head-title">
            {item.source ? (
              <AppIcon url={item.source.iconUrl} name={item.source.name} className="cp-ql-app-icon" />
            ) : (
              <KindIcon kind={item.kind} className="size-4" />
            )}
            <span className="cp-ql-title">{item.title || t(`clip.panel.kind.${item.kind}`)}</span>
            <span className="cp-ql-sub">
              {[item.source?.name, formatDateTime(language, item.lastCopiedAt)].filter(Boolean).join(' · ')}
            </span>
          </div>
          <div className="cp-ql-head-actions">
            {hasHtml && item.kind === 'text' ? (
              <div className="cp-segment">
                <button type="button" className={cn(mode === 'rich' && 'is-on')} onClick={() => setMode('rich')}>
                  {t('clip.panel.quickLook.rich')}
                </button>
                <button type="button" className={cn(mode === 'plain' && 'is-on')} onClick={() => setMode('plain')}>
                  {t('clip.panel.quickLook.plain')}
                </button>
              </div>
            ) : null}
            {item.kind === 'link' || item.kind === 'file' ? (
              <Button variant="ghost" size="sm" onClick={onOpen}>
                <ExternalLink />
                {t('clip.panel.menu.openLink')}
              </Button>
            ) : null}
            <Button size="sm" onClick={onPaste}>
              <ClipboardPaste />
              {t('clip.panel.menu.paste')}
            </Button>
            <button
              type="button"
              className="cp-icon-btn"
              aria-label={t('clip.panel.quickLook.close')}
              onClick={onClose}
            >
              <X />
            </button>
          </div>
        </header>

        <div className="cp-ql-body">
          <div className="cp-ql-main">
            {detail === undefined && item.kind === 'text' ? <Spinner className="cp-ql-loading" /> : null}
            {detail === null ? <div className="cp-ql-missing">{t('clip.panel.quickLook.missing')}</div> : renderMain()}
          </div>
          <dl className="cp-ql-meta">
            <MetaRow label={t('clip.panel.meta.kind')}>{t(`clip.panel.kind.${item.kind}`)}</MetaRow>
            {item.source ? <MetaRow label={t('clip.panel.meta.source')}>{item.source.name}</MetaRow> : null}
            {item.kind === 'link' && item.url ? (
              <MetaRow label={t('clip.panel.meta.domain')}>{getDomain(item.url)}</MetaRow>
            ) : null}
            <MetaRow label={t('clip.panel.meta.copiedAt')}>{formatDateTime(language, item.lastCopiedAt)}</MetaRow>
            <MetaRow label={t('clip.panel.meta.createdAt')}>{formatDateTime(language, item.createdAt)}</MetaRow>
            <MetaRow label={t('clip.panel.meta.copyCount')}>{item.copyCount}</MetaRow>
            {item.kind === 'image' && item.imageWidth && item.imageHeight ? (
              <MetaRow label={t('clip.panel.meta.dimensions')}>{`${item.imageWidth} × ${item.imageHeight}`}</MetaRow>
            ) : null}
            {item.kind === 'text' || item.kind === 'link' ? (
              <MetaRow label={t('clip.panel.meta.chars')}>{item.charCount}</MetaRow>
            ) : null}
            {item.kind === 'file' ? <MetaRow label={t('clip.panel.meta.files')}>{item.fileCount}</MetaRow> : null}
            <MetaRow label={t('clip.panel.meta.size')}>{formatBytes(item.byteSize)}</MetaRow>
            {detail && detail.tags.length > 0 ? (
              <MetaRow label={t('clip.panel.meta.tags')}>{detail.tags.join(', ')}</MetaRow>
            ) : null}
          </dl>
        </div>
      </div>
    </div>
  )
}
