import { useEffect, useRef } from 'react'
import { FileImage, Link2, Palette, Pin, PinOff, Trash2 } from 'lucide-react'
import type { ClipboardHistoryEntry, ClipboardHistoryFilter, ClipboardHistoryListItem } from '@/lib/clipboard/types'

type ClipboardHistoryPanelCopy = {
  countLabel: (count: number) => string
  filters: {
    all: string
    text: string
    image: string
    file: string
    link: string
    color: string
  }
  loading: string
  empty: string
  previewPlaceholder: string
  sourceUnknown: string
  justNow: string
  labels: {
    image: string
    files: string
    link: string
    color: string
    text: string
    source: string
    contentType: string
    characters: string
    words: string
    payload: string
    copied: string
    paste: string
    copy: string
    pin: string
    unpin: string
    clear: string
    delete: string
  }
}

type ClipboardHistoryPanelProps = {
  items: ClipboardHistoryListItem[]
  selectedEntry: ClipboardHistoryEntry | null
  selectedId: string | null
  isLoading: boolean
  filter: ClipboardHistoryFilter
  actionHint?: string
  copy: ClipboardHistoryPanelCopy
  locale: string
  onFilterChange: (filter: ClipboardHistoryFilter) => void
  onSelect: (id: string) => void
  onPaste: () => void
  onCopy: () => void
  onDelete: () => void
  onTogglePin: () => void
  onClear: () => void
}

const formatTime = (timestamp: number | undefined, locale: string, justNow: string) => {
  if (!timestamp) {
    return justNow
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

const formatBytes = (value: number) => {
  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const KindIcon = ({ kind }: { kind: ClipboardHistoryListItem['kind'] }) => {
  if (kind === 'image') {
    return <FileImage size={16} />
  }

  if (kind === 'link') {
    return <Link2 size={16} />
  }

  if (kind === 'color') {
    return <Palette size={16} />
  }

  return <span className="ms-clipboard-kind-letter">{kind === 'file' ? 'F' : 'T'}</span>
}

export function ClipboardHistoryPanel({
  items,
  selectedEntry,
  selectedId,
  isLoading,
  filter,
  actionHint,
  copy,
  locale,
  onFilterChange,
  onSelect,
  onPaste,
  onCopy,
  onDelete,
  onTogglePin,
  onClear,
}: ClipboardHistoryPanelProps) {
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const infoItems = selectedEntry
    ? [
        { label: copy.labels.source, value: selectedEntry.sourceApp?.name ?? copy.sourceUnknown },
        { label: copy.labels.characters, value: String(selectedEntry.characterCount) },
        { label: copy.labels.payload, value: formatBytes(selectedEntry.bytes) },
        { label: copy.labels.copied, value: formatTime(selectedEntry.copiedAt, locale, copy.justNow) },
      ]
    : []

  useEffect(() => {
    if (!selectedId) {
      return
    }

    rowRefs.current[selectedId]?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [selectedId])

  return (
    <div className="ms-clipboard-shell">
      <div className="ms-clipboard-surface">
        <aside className="ms-clipboard-sidebar">
          <div className="ms-clipboard-sidebar-head">
            <div>
              <div className="ms-clipboard-count">{copy.countLabel(items.length)}</div>
            </div>

            <select
              className="ms-clipboard-filter"
              value={filter}
              onChange={(event) => onFilterChange(event.target.value as ClipboardHistoryFilter)}
            >
              <option value="all">{copy.filters.all}</option>
              <option value="text">{copy.filters.text}</option>
              <option value="image">{copy.filters.image}</option>
              <option value="file">{copy.filters.file}</option>
              <option value="link">{copy.filters.link}</option>
              <option value="color">{copy.filters.color}</option>
            </select>
          </div>

          <div className="ms-clipboard-list">
            {items.map((item) => (
              <button
                key={item.id}
                ref={(node) => {
                  if (node) {
                    rowRefs.current[item.id] = node
                    return
                  }

                  delete rowRefs.current[item.id]
                }}
                type="button"
                className={`ms-clipboard-row ${item.id === selectedId ? 'is-active' : ''}`}
                onClick={() => onSelect(item.id)}
              >
                <span className="ms-clipboard-row-icon">
                  {item.image?.thumbnailDataUrl ? (
                    <img src={item.image.thumbnailDataUrl} alt={item.title} className="ms-clipboard-row-image" />
                  ) : (
                    <KindIcon kind={item.kind} />
                  )}
                </span>

                <span className="ms-clipboard-row-copy">
                  <span className="ms-clipboard-row-title">
                    <span className="ms-clipboard-row-title-text">{item.title}</span>
                    {item.isPinned ? <Pin size={12} className="ms-clipboard-row-pin" /> : null}
                  </span>
                </span>
              </button>
            ))}

            {!items.length ? <div className="ms-clipboard-empty">{isLoading ? copy.loading : copy.empty}</div> : null}
          </div>
        </aside>

        <section className="ms-clipboard-detail">
          {selectedEntry ? (
            <>
              <div className="ms-clipboard-detail-head">
                <div className="ms-clipboard-detail-summary">
                  <div className="ms-clipboard-detail-title">{selectedEntry.title}</div>
                </div>

                <div className="ms-clipboard-detail-actions">
                  <button
                    type="button"
                    className="ms-clipboard-icon-button"
                    onClick={onTogglePin}
                    aria-label={selectedEntry.isPinned ? copy.labels.unpin : copy.labels.pin}
                  >
                    {selectedEntry.isPinned ? <PinOff size={15} /> : <Pin size={15} />}
                  </button>
                  <button
                    type="button"
                    className="ms-clipboard-icon-button"
                    onClick={onDelete}
                    aria-label={copy.labels.delete}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div className="ms-clipboard-preview-card">
                {selectedEntry.imageDataUrl ? (
                  <img
                    src={selectedEntry.imageDataUrl}
                    alt={selectedEntry.title}
                    className="ms-clipboard-preview-image"
                  />
                ) : selectedEntry.kind === 'color' && selectedEntry.primaryValue ? (
                  <div className="ms-clipboard-color-preview">
                    <span className="ms-clipboard-color-swatch" style={{ background: selectedEntry.primaryValue }} />
                    <span>{selectedEntry.primaryValue}</span>
                  </div>
                ) : selectedEntry.filePaths.length ? (
                  <div className="ms-clipboard-file-list">
                    {selectedEntry.filePaths.map((filePath) => (
                      <div key={filePath} className="ms-clipboard-file-item">
                        {filePath}
                      </div>
                    ))}
                  </div>
                ) : (
                  <pre className="ms-clipboard-preview-text">
                    {selectedEntry.textContent || selectedEntry.previewText}
                  </pre>
                )}
              </div>

              <div className="ms-clipboard-info-grid">
                {infoItems.map((item) => (
                  <div key={item.label} className="ms-clipboard-info-item">
                    <span className="ms-clipboard-info-label">{item.label}</span>
                    <span className="ms-clipboard-info-value" title={item.value}>
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="ms-clipboard-placeholder">{copy.previewPlaceholder}</div>
          )}
        </section>
      </div>

      <div className="ms-clipboard-footer">
        <div className="ms-clipboard-footer-label">{copy.countLabel(items.length)}</div>
        <div className="ms-clipboard-footer-actions">
          <button type="button" className="ms-clipboard-footer-button" onClick={onPaste} disabled={!selectedEntry}>
            {copy.labels.paste}
          </button>
          <button type="button" className="ms-clipboard-footer-button" onClick={onCopy} disabled={!selectedEntry}>
            {copy.labels.copy}
          </button>
          <button type="button" className="ms-clipboard-footer-button is-danger" onClick={onClear}>
            {copy.labels.clear}
          </button>
        </div>
        <div className="ms-clipboard-footer-note">{actionHint ?? ''}</div>
      </div>
    </div>
  )
}
