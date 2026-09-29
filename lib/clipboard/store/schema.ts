// SQLite schema v1 for clipboard.sqlite. Shared contract between the store (writes) and search (reads).
// Migrations live in migrations.ts and are keyed by PRAGMA user_version.

export const CLIP_SCHEMA_VERSION = 1

export const CLIP_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS apps (
  bundle_id    TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  icon_path    TEXT,
  color        TEXT,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clip_items (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL,
  sub_kind         TEXT,
  is_rich          INTEGER NOT NULL DEFAULT 0,
  fingerprint      TEXT NOT NULL UNIQUE,
  custom_title     TEXT,
  preview_text     TEXT NOT NULL,
  plain_text       TEXT,
  html             TEXT,
  url              TEXT,
  color_value      TEXT,
  file_count       INTEGER NOT NULL DEFAULT 0,
  image_width      INTEGER,
  image_height     INTEGER,
  image_blob_hash  TEXT,
  byte_size        INTEGER NOT NULL DEFAULT 0,
  char_count       INTEGER NOT NULL DEFAULT 0,
  source_bundle_id TEXT REFERENCES apps(bundle_id) ON DELETE SET NULL,
  is_remote        INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  last_copied_at   INTEGER NOT NULL,
  last_used_at     INTEGER,
  copy_count       INTEGER NOT NULL DEFAULT 1,
  use_count        INTEGER NOT NULL DEFAULT 0,
  deleted_at       INTEGER,
  ocr_text         TEXT,
  ocr_status       TEXT NOT NULL DEFAULT 'none',
  tags             TEXT,
  enrich_version   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_recent ON clip_items(last_copied_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_items_kind ON clip_items(kind, last_copied_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_app ON clip_items(source_bundle_id, last_copied_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_ocr ON clip_items(ocr_status) WHERE ocr_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_items_deleted ON clip_items(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS clip_representations (
  item_id     TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
  item_index  INTEGER NOT NULL,
  uti         TEXT NOT NULL,
  data        BLOB,
  blob_hash   TEXT,
  byte_size   INTEGER NOT NULL,
  PRIMARY KEY (item_id, item_index, uti)
);

CREATE TABLE IF NOT EXISTS clip_files (
  item_id   TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL,
  path      TEXT NOT NULL,
  PRIMARY KEY (item_id, position)
);

CREATE TABLE IF NOT EXISTS pinboards (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pinboard_items (
  pinboard_id TEXT NOT NULL REFERENCES pinboards(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (pinboard_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_pinboard_items_item ON pinboard_items(item_id);

-- Regular (not contentless) FTS5 table: highlight() needs stored content. rowid = clip_items.rowid.
-- Columns: title = custom_title or derived title, body = plain_text (+ file names), ocr = ocr_text,
-- tags = local/AI tags, app = source app name + bundle id, url = url.
CREATE VIRTUAL TABLE IF NOT EXISTS clip_search USING fts5(
  title, body, ocr, tags, app, url,
  tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS enrich_jobs (
  item_id    TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
  job        TEXT NOT NULL,
  status     TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, job)
);
`

/** Max characters of body text copied into clip_search / used by LIKE fallback. */
export const CLIP_SEARCH_BODY_MAX_CHARS = 20_000
