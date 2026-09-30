import { useState, type ReactNode } from 'react'
import {
  File as FileGlyph,
  Files,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Palette,
  type LucideIcon,
} from 'lucide-react'
import type { ClipKind } from '@/lib/clipboard/types'
import { getFileIconUrl } from '@/app/components/clipboard-panel/panel-utils'
import { cn } from '@/lib/utils'

/** Text with `[start, end)` ranges wrapped in <mark>. Ranges are UTF-16 offsets into `text`. */
export function HighlightedText({ text, ranges }: { text: string; ranges?: Array<[number, number]> }) {
  if (!ranges || ranges.length === 0) {
    return <>{text}</>
  }

  const sorted = [...ranges]
    .map(([start, end]) => [Math.max(0, start), Math.min(text.length, end)] as [number, number])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0])
  const nodes: ReactNode[] = []
  let cursor = 0

  sorted.forEach(([start, end], index) => {
    if (start < cursor) {
      return
    }

    if (start > cursor) {
      nodes.push(text.slice(cursor, start))
    }

    nodes.push(
      <mark key={index} className="cp-mark">
        {text.slice(start, end)}
      </mark>
    )
    cursor = end
  })

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return <>{nodes}</>
}

export const kindIcons: Record<ClipKind, LucideIcon> = {
  text: FileText,
  link: Link2,
  image: ImageIcon,
  file: FileGlyph,
  color: Palette,
}

export function KindIcon({ kind, className }: { kind: ClipKind; className?: string }) {
  const Icon = kindIcons[kind]
  return <Icon className={className} />
}

/** Source app icon with a letter fallback when the icon is missing or fails to load. */
export function AppIcon({ url, name, className }: { url?: string; name?: string; className?: string }) {
  const [failed, setFailed] = useState(false)

  if (!url || failed) {
    return (
      <span className={cn('cp-app-icon-fallback', className)} aria-hidden>
        {(name?.trim()[0] ?? '?').toUpperCase()}
      </span>
    )
  }

  return <img className={className} src={url} alt="" draggable={false} onError={() => setFailed(true)} />
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('cp-spin', className)} aria-hidden />
}

/** The real Finder icon of the item's first file; falls back to a generic glyph when it cannot be loaded. */
export function FileTypeIcon({
  itemId,
  multiple,
  className,
}: {
  itemId: string
  multiple?: boolean
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    const Glyph = multiple ? Files : FileGlyph
    return <Glyph className={cn('cp-file-glyph', className)} aria-hidden />
  }

  return (
    <img
      className={cn('cp-file-real-icon', className)}
      src={getFileIconUrl(itemId)}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}
