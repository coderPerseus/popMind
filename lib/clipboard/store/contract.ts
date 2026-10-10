// Contract of the clipboard store. Implemented by store/clip-store.ts (main-process proxy over a
// worker thread that owns node:sqlite). Consumed by capture/, enrich/, write/, IPC handlers and AI search.
import type { NativePasteboardItem } from '@/lib/native/macos-addon'
import type {
  ClipDetail,
  ClipKind,
  ClipListItem,
  ClipListResult,
  ClipQuery,
  ClipSourceApp,
  ClipStats,
  ClipSubKind,
  ClipboardSettings,
  Pinboard,
} from '@/lib/clipboard/types'

/** A representation as it arrives from capture. Large data is spilled to the blob store by the store. */
export type ClipIngestRepresentation = {
  itemIndex: number
  uti: string
  data: Buffer
}

export type ClipIngestRecord = {
  kind: ClipKind
  subKind?: ClipSubKind
  isRich: boolean
  /** Semantic dedupe fingerprint (see capture/normalize.ts). */
  fingerprint: string
  title: string
  previewText: string
  plainText?: string
  html?: string
  url?: string
  colorValue?: string
  filePaths: string[]
  /** PNG bytes of the image (decoded from png/tiff/jpeg/heic). */
  imagePng?: Buffer
  imageWidth?: number
  imageHeight?: number
  representations: ClipIngestRepresentation[]
  byteSize: number
  charCount: number
  source?: { bundleId: string; name: string }
  isRemote: boolean
  tags: string[]
  copiedAt: number
}

export type ClipIngestOutcome = {
  id: string
  status: 'inserted' | 'bumped'
}

/** What the writer needs to put an item back on the pasteboard. */
export type ClipWritePayload = {
  id: string
  kind: ClipKind
  items: NativePasteboardItem[]
  plainText?: string
  filePaths: string[]
  /** Absolute path of the stored PNG, for the temp-file trick (terminals). */
  imagePath?: string
}

/** Compact candidate for AI rerank (text only — Jev cannot read images). */
export type ClipAiCandidate = {
  id: string
  kind: ClipKind
  appName?: string
  lastCopiedAt: number
  /** title + plain text / OCR text, already truncated by the store (~300 chars). */
  text: string
}

export type ClipAiCandidateQuery = {
  /** Keyword query to take the top local results from. */
  keywordQuery: ClipQuery
  keywordLimit: number
  /** Extra recent items matching these filters (covers what keywords cannot recall). */
  recent: { kinds?: ClipKind[]; appBundleIds?: string[]; from?: number; to?: number; limit: number }
  /** Hard cap on the merged pool. */
  maxTotal: number
}

export type ClipEnrichJob = 'thumbnail' | 'ocr' | 'local_tags' | 'ai_tags'

export type ClipEnrichTask = {
  itemId: string
  job: ClipEnrichJob
  attempts: number
  kind: ClipKind
  imagePath?: string
  plainText?: string
}

export type ClipAssetKind = 'thumb' | 'image' | 'app-icon'

/** A local item to upload (docs/clipboard-sync.md §4). Image bytes are read from `imagePath` by the engine. */
export type ClipSyncOutgoing = {
  id: string
  fingerprint: string
  kind: ClipKind
  subKind?: ClipSubKind
  isRich: boolean
  customTitle?: string
  plainText?: string
  html?: string
  url?: string
  colorValue?: string
  imageWidth?: number
  imageHeight?: number
  imageHash?: string
  imagePath?: string
  source?: { bundleId: string; name: string }
  /** Pasteboard representations except images (sent as `imagePath`) and file URLs. */
  representations: ClipIngestRepresentation[]
}

export type ClipSyncIncoming = {
  remoteKey: string
  record: ClipIngestRecord
  customTitle?: string
}

export type ClipSyncImportResult = {
  /** Newly inserted local item ids. */
  added: string[]
  /** Remote items whose content already existed here (only linked). */
  linked: number
}

export type ClipSyncLocalPinboard = {
  id: string
  name: string
  color: string
  /** Remote keys of the members that exist remotely. */
  itemKeys: string[]
}

export type ClipSyncRemotePinboard = {
  pinboardKey: string
  name: string
  color: string
  itemKeys: string[]
}

export interface ClipStore {
  init(): Promise<void>
  close(): Promise<void>

  // capture
  ingest(record: ClipIngestRecord): Promise<ClipIngestOutcome>
  /** Called when popMind itself wrote the item back (marker seen) or pasted it. Moves it to the top. */
  markUsed(id: string): Promise<void>

  // read
  list(query: ClipQuery): Promise<ClipListResult>
  getDetail(id: string): Promise<ClipDetail | null>
  getItemsByIds(ids: string[]): Promise<ClipListItem[]>
  getWritePayload(id: string): Promise<ClipWritePayload | null>
  getAiCandidates(query: ClipAiCandidateQuery): Promise<ClipAiCandidate[]>
  listApps(): Promise<ClipSourceApp[]>
  stats(): Promise<ClipStats>

  // edit
  rename(id: string, title: string | null): Promise<ClipListItem | null>
  updateText(id: string, text: string): Promise<ClipListItem | null>
  createTextItem(text: string): Promise<ClipListItem>
  /** Soft delete; returns an undo token valid until purgeDeleted runs. */
  softDelete(ids: string[]): Promise<{ deletedIds: string[]; undoToken: string }>
  undoDelete(undoToken: string): Promise<string[]>
  purgeDeleted(olderThanMs: number): Promise<number>
  /** Deletes all history items that are not in any pinboard. */
  clearHistory(): Promise<number>

  // pinboards
  listPinboards(): Promise<Pinboard[]>
  createPinboard(name: string, color: string): Promise<Pinboard>
  updatePinboard(id: string, patch: { name?: string; color?: string }): Promise<Pinboard | null>
  deletePinboard(id: string): Promise<void>
  reorderPinboards(ids: string[]): Promise<void>
  addToPinboard(pinboardId: string, itemIds: string[]): Promise<void>
  removeFromPinboard(pinboardId: string, itemIds: string[]): Promise<void>
  reorderPinboardItems(pinboardId: string, itemIds: string[]): Promise<void>

  // apps
  upsertApp(app: { bundleId: string; name: string; iconPath?: string; color?: string }): Promise<void>

  // enrichment
  takeEnrichTasks(job: ClipEnrichJob, limit: number): Promise<ClipEnrichTask[]>
  completeEnrichTask(
    itemId: string,
    job: ClipEnrichJob,
    result: { ok: true; ocrText?: string; tags?: string[] } | { ok: false; error: string }
  ): Promise<void>

  // assets for the popmind-clip:// protocol (absolute file paths)
  resolveAsset(kind: ClipAssetKind, id: string): Promise<string | null>

  // sync (docs/clipboard-sync.md)
  /** Unsynced, non-file, non-deleted items copied at/after `since` or in any pinboard; oldest first. */
  syncPendingUploadIds(since: number): Promise<string[]>
  syncLoadOutgoing(ids: string[]): Promise<ClipSyncOutgoing[]>
  syncMarkUploaded(entries: Array<{ itemId: string; remoteKey: string }>, origin?: 'local' | 'skipped'): Promise<void>
  syncReset(): Promise<void>
  /** Remote item keys this device already has or has already looked at. */
  syncKnownKeys(): Promise<string[]>
  syncMarkSeen(remoteKeys: string[]): Promise<void>
  syncImportItems(items: ClipSyncIncoming[]): Promise<ClipSyncImportResult>
  syncLocalPinboards(): Promise<ClipSyncLocalPinboard[]>
  /** Adds memberships not applied before; returns whether a pinboard was created and how many items were added. */
  syncApplyPinboard(pinboard: ClipSyncRemotePinboard): Promise<{ created: boolean; added: number }>
  syncMarkPinboardMembers(pinboardKey: string, itemKeys: string[]): Promise<void>

  // maintenance
  runRetention(settings: Pick<ClipboardSettings, 'retention' | 'maxStorageMb'>): Promise<{ deletedCount: number }>
}
