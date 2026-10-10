// Serialized form of synced items and pinboards (before encryption). Pure.
// Deliberately carries no timestamps or usage counters: received items are new content (docs/clipboard-sync.md §4).
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { classifyText } from '@/lib/clipboard/capture/classify'
import type { ClipIngestRecord, ClipSyncOutgoing } from '@/lib/clipboard/store/contract'
import { buildPreviewText, deriveTitle } from '@/lib/clipboard/store/text-utils'
import { clipKinds, type ClipKind, type ClipSubKind } from '@/lib/clipboard/types'

const PAYLOAD_VERSION = 1
/** Single non-text representations above this are dropped (plain text / html stay, they paste fine). */
const MAX_EXTRA_REP_BYTES = 2 * 1024 * 1024
const TEXT_UTIS = new Set(['public.utf8-plain-text', 'public.utf16-plain-text', 'public.html'])

type ItemPayload = {
  v: number
  fp: string
  kind: ClipKind
  sub?: ClipSubKind
  rich?: boolean
  title?: string
  text?: string
  html?: string
  url?: string
  color?: string
  w?: number
  h?: number
  /** Remote blob name of the PNG. */
  img?: string
  src?: { id: string; name: string }
  reps: Array<{ i: number; u: string; d: string }>
}

type PinboardPayload = { v: number; name: string; color: string; items: string[] }

const pack = (value: unknown) => deflateRawSync(Buffer.from(JSON.stringify(value), 'utf8'))
const unpack = (data: Buffer) => JSON.parse(inflateRawSync(data).toString('utf8')) as unknown

export const encodeItemPayload = (item: ClipSyncOutgoing, imageRef?: string): Buffer => {
  const reps = item.representations
    .filter((rep) => TEXT_UTIS.has(rep.uti) || rep.data.length <= MAX_EXTRA_REP_BYTES)
    .map((rep) => ({ i: rep.itemIndex, u: rep.uti, d: rep.data.toString('base64') }))

  const payload: ItemPayload = {
    v: PAYLOAD_VERSION,
    fp: item.fingerprint,
    kind: item.kind,
    sub: item.subKind,
    rich: item.isRich || undefined,
    title: item.customTitle,
    text: item.plainText,
    html: item.html,
    url: item.url,
    color: item.colorValue,
    w: item.imageWidth,
    h: item.imageHeight,
    img: imageRef,
    src: item.source ? { id: item.source.bundleId, name: item.source.name } : undefined,
    reps,
  }
  return pack(payload)
}

export type DecodedItem = {
  fingerprint: string
  kind: ClipKind
  customTitle?: string
  imageRef?: string
  /** Builds the ingest record once the image (if any) is downloaded. */
  toRecord: (copiedAt: number, imagePng?: Buffer) => ClipIngestRecord
}

/** Throws on malformed payloads. */
export const decodeItemPayload = (data: Buffer): DecodedItem => {
  const payload = unpack(data) as ItemPayload
  if (!payload || payload.v !== PAYLOAD_VERSION || typeof payload.fp !== 'string') {
    throw new Error('unsupported item payload')
  }
  if (!(clipKinds as readonly string[]).includes(payload.kind) || payload.kind === 'file') {
    throw new Error(`unsupported item kind ${String(payload.kind)}`)
  }
  if (payload.kind === 'image' && !payload.img) {
    throw new Error('image payload without image')
  }

  const reps = (Array.isArray(payload.reps) ? payload.reps : []).map((rep) => ({
    itemIndex: Number(rep.i) || 0,
    uti: String(rep.u),
    data: Buffer.from(String(rep.d), 'base64'),
  }))

  return {
    fingerprint: payload.fp,
    kind: payload.kind,
    customTitle: payload.title,
    imageRef: payload.img,
    toRecord: (copiedAt, imagePng) => {
      const fields = {
        plainText: payload.text,
        url: payload.url,
        colorValue: payload.color,
        imageWidth: payload.w,
        imageHeight: payload.h,
      }
      const representations = imagePng ? [...reps, { itemIndex: 0, uti: 'public.png', data: imagePng }] : reps
      const tags =
        payload.kind === 'text' || payload.kind === 'link' ? classifyText(payload.text ?? payload.url ?? '').tags : []

      return {
        kind: payload.kind,
        subKind: payload.sub,
        isRich: Boolean(payload.rich),
        fingerprint: payload.fp,
        title: deriveTitle(payload.kind, fields),
        previewText: buildPreviewText(payload.kind, fields),
        plainText: payload.text,
        html: payload.html,
        url: payload.url,
        colorValue: payload.color,
        filePaths: [],
        imagePng,
        imageWidth: payload.w,
        imageHeight: payload.h,
        representations,
        byteSize: representations.reduce((total, rep) => total + rep.data.length, 0),
        charCount: payload.text?.length ?? 0,
        source: payload.src ? { bundleId: payload.src.id, name: payload.src.name } : undefined,
        isRemote: false,
        tags,
        copiedAt,
      }
    },
  }
}

export const encodePinboardPayload = (pinboard: { name: string; color: string; items: string[] }) =>
  pack({
    v: PAYLOAD_VERSION,
    name: pinboard.name,
    color: pinboard.color,
    items: pinboard.items,
  } satisfies PinboardPayload)

export const decodePinboardPayload = (data: Buffer): { name: string; color: string; items: string[] } => {
  const payload = unpack(data) as PinboardPayload
  if (!payload || payload.v !== PAYLOAD_VERSION || typeof payload.name !== 'string' || !Array.isArray(payload.items)) {
    throw new Error('unsupported pinboard payload')
  }
  return {
    name: payload.name,
    color: typeof payload.color === 'string' ? payload.color : 'gray',
    items: payload.items.filter((key): key is string => typeof key === 'string'),
  }
}
