package clipboard

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo/plugins/sqlite"

	"popmind/internal/logx"
)

const schemaV1 = `
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

const (
	blobThreshold = 256 * 1024
	searchBodyMax = 20_000
	dayMs         = int64(24 * time.Hour / time.Millisecond)
)

var imageUTIs = map[string]bool{"public.png": true, "public.tiff": true, "public.jpeg": true, "public.heic": true}

var utiExtensions = map[string]string{"public.png": "png", "public.tiff": "tiff", "public.jpeg": "jpg", "public.heic": "heic",
	"public.html": "html", "public.rtf": "rtf", "com.apple.flat-rtfd": "rtfd", "public.utf8-plain-text": "txt",
	"public.utf16-plain-text": "txt"}

// Store is the history database and its files.
type Store struct {
	db      *sqlite.DB
	root    string
	blobDir string
	mu      sync.Mutex
	undo    map[string][]string

	listenMu  sync.Mutex
	listeners []func(reason string, ids []string)
}

func now() int64 { return time.Now().UnixMilli() }

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

func sha(data []byte) string { s := sha256.Sum256(data); return hex.EncodeToString(s[:]) }

// Open opens (or creates) the history under dir/clipboard.
func Open(dir string) (*Store, error) {
	root := filepath.Join(dir, "clipboard")
	if err := os.MkdirAll(filepath.Join(root, "blobs"), 0o755); err != nil {
		return nil, err
	}
	ctx := context.Background()
	db, err := sqlite.Open(ctx, filepath.Join(root, "clipboard.sqlite"), sqlite.OpenOptions{BusyTimeout: 5 * time.Second})
	if err != nil {
		return nil, err
	}
	s := &Store{db: db, root: root, blobDir: filepath.Join(root, "blobs"), undo: map[string][]string{}}
	for _, pragma := range []string{"PRAGMA journal_mode = WAL", "PRAGMA foreign_keys = ON", "PRAGMA synchronous = NORMAL"} {
		if _, err := db.Query(ctx, pragma); err != nil {
			logx.Warn("[clip-store] pragma failed", "pragma", pragma, "err", err)
		}
	}
	for _, stmt := range splitSQL(schemaV1 + syncSchema) {
		if _, err := db.Execute(ctx, stmt); err != nil {
			db.Close()
			return nil, fmt.Errorf("schema: %w", err)
		}
	}
	_, _ = db.Query(ctx, "PRAGMA user_version = 1")
	return s, nil
}

func splitSQL(script string) []string {
	var out []string
	for _, part := range strings.Split(script, ";\n") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, strings.TrimSuffix(p, ";"))
		}
	}
	return out
}

// Close closes the database.
func (s *Store) Close() error { return s.db.Close() }

// Root is the clipboard data directory.
func (s *Store) Root() string { return s.root }

// OnChange calls fn after items change ("added", "bumped", "updated", "deleted", "cleared", "pinboards").
func (s *Store) OnChange(fn func(reason string, ids []string)) {
	s.listenMu.Lock()
	s.listeners = append(s.listeners, fn)
	s.listenMu.Unlock()
}

func (s *Store) changed(reason string, ids ...string) {
	s.listenMu.Lock()
	list := append([]func(string, []string){}, s.listeners...)
	s.listenMu.Unlock()
	for _, fn := range list {
		fn(reason, ids)
	}
}

func (s *Store) query(sql string, args ...any) ([]map[string]any, error) {
	rows, err := s.db.Query(context.Background(), sql, args...)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, len(rows.Values))
	for i, values := range rows.Values {
		m := make(map[string]any, len(values))
		for j, v := range values {
			m[rows.Columns[j]] = v
		}
		out[i] = m
	}
	return out, nil
}

func (s *Store) exec(sql string, args ...any) (sqlite.Result, error) {
	return s.db.Execute(context.Background(), sql, args...)
}

func (s *Store) tx(stmts []sqlite.Statement) error {
	_, err := s.db.Transaction(context.Background(), stmts)
	return err
}

func str(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []byte:
		return string(t)
	}
	return ""
}

func num(v any) int64 {
	switch t := v.(type) {
	case int64:
		return t
	case float64:
		return int64(t)
	case int:
		return int64(t)
	}
	return 0
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ---- blobs ----

func (s *Store) blobPath(hash, ext string) string {
	return filepath.Join(s.blobDir, hash[:2], hash+"."+ext)
}

func (s *Store) writeBlob(data []byte, ext string) (string, error) {
	hash := sha(data)
	target := s.blobPath(hash, ext)
	if _, err := os.Stat(target); err == nil {
		return hash, nil
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return "", err
	}
	tmp := target + "." + newUUID()[:8] + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return "", err
	}
	return hash, os.Rename(tmp, target)
}

// BlobFile finds the file of a blob hash.
func (s *Store) BlobFile(hash string) string {
	if len(hash) < 2 {
		return ""
	}
	entries, err := os.ReadDir(filepath.Join(s.blobDir, hash[:2]))
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), hash+".") && !strings.HasSuffix(e.Name(), ".tmp") {
			return filepath.Join(s.blobDir, hash[:2], e.Name())
		}
	}
	return ""
}

func (s *Store) readBlob(hash string) []byte {
	if f := s.BlobFile(hash); f != "" {
		data, _ := os.ReadFile(f)
		return data
	}
	return nil
}

// ---- ingest ----

// Representation is one pasteboard type of one pasteboard item.
type Representation struct {
	ItemIndex int
	UTI       string
	Data      []byte
}

// Record is a capture ready to store.
type Record struct {
	Kind        string
	SubKind     string
	IsRich      bool
	Fingerprint string
	Title       string
	Preview     string
	PlainText   string
	HTML        string
	URL         string
	Color       string
	FilePaths   []string
	ImagePNG    []byte
	ImageWidth  int
	ImageHeight int
	Reps        []Representation
	ByteSize    int64
	CharCount   int
	SourceID    string
	SourceName  string
	IsRemote    bool
	Tags        []string
	CopiedAt    int64
}

// Ingest stores rec, or moves the item with its fingerprint to the top. It returns the id and whether the item
// is new.
func (s *Store) Ingest(rec Record) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, err := s.query("SELECT id, is_rich FROM clip_items WHERE fingerprint = ?", rec.Fingerprint)
	if err != nil {
		return "", false, err
	}
	var stmts []sqlite.Statement
	add := func(sql string, args ...any) { stmts = append(stmts, sqlite.Statement{SQL: sql, Args: args}) }
	ts := now()
	if rec.SourceID != "" {
		add(`INSERT INTO apps (bundle_id, name, updated_at) VALUES (?, ?, ?)
		     ON CONFLICT(bundle_id) DO UPDATE SET
		       name = CASE WHEN apps.name = apps.bundle_id THEN excluded.name ELSE apps.name END,
		       updated_at = excluded.updated_at`, rec.SourceID, cmpOr(rec.SourceName, rec.SourceID), ts)
	}
	repStmts := func(id string) error {
		for _, rep := range rec.Reps {
			var data any = rep.Data
			var hash any
			if len(rep.Data) > blobThreshold || imageUTIs[rep.UTI] {
				ext := utiExtensions[rep.UTI]
				if ext == "" {
					ext = "bin"
				}
				h, err := s.writeBlob(rep.Data, ext)
				if err != nil {
					return err
				}
				data, hash = nil, h
			}
			add(`INSERT OR IGNORE INTO clip_representations (item_id, item_index, uti, data, blob_hash, byte_size)
			     VALUES (?, ?, ?, ?, ?, ?)`, id, rep.ItemIndex, rep.UTI, data, hash, len(rep.Data))
		}
		return nil
	}
	html := rec.HTML
	if len(html) > blobThreshold {
		html = ""
	}

	if len(existing) > 0 {
		id := str(existing[0]["id"])
		add(`UPDATE clip_items SET last_copied_at = MAX(last_copied_at, ?), copy_count = copy_count + 1,
		       deleted_at = NULL, is_remote = ?, source_bundle_id = COALESCE(?, source_bundle_id) WHERE id = ?`,
			rec.CopiedAt, b2i(rec.IsRemote), nullable(rec.SourceID), id)
		if err := repStmts(id); err != nil {
			return "", false, err
		}
		if rec.IsRich && num(existing[0]["is_rich"]) == 0 && rec.Kind == KindText {
			add("UPDATE clip_items SET is_rich = 1, html = ? WHERE id = ?", nullable(html), id)
		}
		stmts = append(stmts, s.searchRowStmts(id)...)
		if err := s.tx(stmts); err != nil {
			return "", false, err
		}
		go s.changed("bumped", id)
		return id, false, nil
	}

	id := newUUID()
	var imageHash any
	if len(rec.ImagePNG) > 0 {
		h, err := s.writeBlob(rec.ImagePNG, "png")
		if err != nil {
			return "", false, err
		}
		imageHash = h
	}
	ocr := "none"
	if rec.Kind == KindImage {
		ocr = "pending"
	}
	add(`INSERT INTO clip_items (id, kind, sub_kind, is_rich, fingerprint, preview_text, plain_text, html, url, color_value,
	       file_count, image_width, image_height, image_blob_hash, byte_size, char_count, source_bundle_id, is_remote,
	       created_at, last_copied_at, copy_count, use_count, ocr_status, tags)
	     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
		id, rec.Kind, nullable(rec.SubKind), b2i(rec.IsRich), rec.Fingerprint, rec.Preview, nullable(rec.PlainText),
		nullable(html), nullable(rec.URL), nullable(rec.Color), len(rec.FilePaths), nullInt(rec.ImageWidth),
		nullInt(rec.ImageHeight), imageHash, rec.ByteSize, rec.CharCount, nullable(rec.SourceID), b2i(rec.IsRemote),
		ts, rec.CopiedAt, ocr, strings.Join(rec.Tags, " "))
	if err := repStmts(id); err != nil {
		return "", false, err
	}
	for i, p := range rec.FilePaths {
		add("INSERT OR IGNORE INTO clip_files (item_id, position, path) VALUES (?, ?, ?)", id, i, p)
	}
	if rec.Kind == KindImage {
		add("INSERT OR IGNORE INTO enrich_jobs (item_id, job, status, attempts, updated_at) VALUES (?, 'ocr', 'pending', 0, ?)", id, ts)
	}
	stmts = append(stmts, s.searchRowStmts(id)...)
	if err := s.tx(stmts); err != nil {
		return "", false, err
	}
	go s.changed("added", id)
	return id, true, nil
}

// searchRowStmts rewrites the clip_search row of an item (rowid = clip_items.rowid), in SQL alone so it fits
// the statement list of a transaction.
func (s *Store) searchRowStmts(id string) []sqlite.Statement {
	return []sqlite.Statement{
		{SQL: "DELETE FROM clip_search WHERE rowid = (SELECT rowid FROM clip_items WHERE id = ?)", Args: []any{id}},
		{SQL: `INSERT INTO clip_search (rowid, title, body, ocr, tags, app, url)
		  SELECT i.rowid,
		    COALESCE(NULLIF(i.custom_title, ''), CASE i.kind
		      WHEN 'image' THEN 'Image ' || COALESCE(i.image_width, 0) || '×' || COALESCE(i.image_height, 0)
		      WHEN 'color' THEN COALESCE(i.color_value, '')
		      WHEN 'link' THEN substr(COALESCE(i.url, i.plain_text, ''), 1, 72)
		      ELSE substr(COALESCE(i.plain_text, i.preview_text, ''), 1, 200) END),
		    substr(COALESCE(i.plain_text, '') || COALESCE((SELECT char(10) || group_concat(path, char(10)) FROM clip_files f WHERE f.item_id = i.id), ''), 1, ?),
		    COALESCE(i.ocr_text, ''), COALESCE(i.tags, ''),
		    TRIM(COALESCE(a.name, '') || ' ' || COALESCE(i.source_bundle_id, '')), COALESCE(i.url, '')
		  FROM clip_items i LEFT JOIN apps a ON a.bundle_id = i.source_bundle_id WHERE i.id = ?`, Args: []any{searchBodyMax, id}},
	}
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullInt(v int) any {
	if v == 0 {
		return nil
	}
	return v
}

func cmpOr(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// MarkUsed moves an item to the top after popMind pasted or wrote it back.
func (s *Store) MarkUsed(id string) {
	ts := now()
	if r, err := s.exec(`UPDATE clip_items SET last_copied_at = ?, last_used_at = ?, use_count = use_count + 1
	  WHERE id = ? AND deleted_at IS NULL`, ts, ts, id); err == nil && r.Changes > 0 {
		go s.changed("bumped", id)
	}
}

// ---- read ----

const listColumns = `i.id, i.kind, i.sub_kind, i.is_rich, i.custom_title, i.preview_text, substr(i.plain_text, 1, 200) AS text_head,
  i.url, i.color_value, i.file_count, i.image_width, i.image_height, i.image_blob_hash, i.byte_size, i.char_count,
  i.source_bundle_id, i.is_remote, i.created_at, i.last_copied_at, i.last_used_at, i.copy_count, i.use_count,
  (i.ocr_text IS NOT NULL AND length(i.ocr_text) > 0) AS has_ocr,
  instr(' ' || coalesce(i.tags, '') || ' ', ' secret ') > 0 AS has_secret, a.name AS app_name`

func placeholders(n int) string { return strings.TrimSuffix(strings.Repeat("?,", n), ",") }

// Items loads the items of ids, in that order.
func (s *Store) Items(ids []string) []Item {
	if len(ids) == 0 {
		return nil
	}
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := s.query("SELECT "+listColumns+" FROM clip_items i LEFT JOIN apps a ON a.bundle_id = i.source_bundle_id WHERE i.id IN ("+placeholders(len(ids))+")", args...)
	if err != nil {
		logx.Warn("[clip-store] load items failed", "err", err)
		return nil
	}
	pins, _ := s.query("SELECT item_id, pinboard_id FROM pinboard_items WHERE item_id IN ("+placeholders(len(ids))+") ORDER BY added_at", args...)
	files, _ := s.query("SELECT item_id, path FROM clip_files WHERE item_id IN ("+placeholders(len(ids))+") AND position < 3 ORDER BY item_id, position", args...)
	pinsBy, filesBy := map[string][]string{}, map[string][]string{}
	for _, p := range pins {
		pinsBy[str(p["item_id"])] = append(pinsBy[str(p["item_id"])], str(p["pinboard_id"]))
	}
	for _, f := range files {
		filesBy[str(f["item_id"])] = append(filesBy[str(f["item_id"])], str(f["path"]))
	}
	byID := map[string]Item{}
	for _, r := range rows {
		it := Item{
			ID: str(r["id"]), Kind: str(r["kind"]), SubKind: str(r["sub_kind"]), IsRich: num(r["is_rich"]) == 1,
			CustomTitle: str(r["custom_title"]), Preview: str(r["preview_text"]), URL: str(r["url"]),
			Color: str(r["color_value"]), FileCount: int(num(r["file_count"])), ImageWidth: int(num(r["image_width"])),
			ImageHeight: int(num(r["image_height"])), ImageHash: str(r["image_blob_hash"]), ByteSize: num(r["byte_size"]),
			CharCount: int(num(r["char_count"])), SourceID: str(r["source_bundle_id"]), IsRemote: num(r["is_remote"]) == 1,
			CreatedAt: num(r["created_at"]), LastCopiedAt: num(r["last_copied_at"]), CopyCount: int(num(r["copy_count"])),
			UseCount: int(num(r["use_count"])), HasOCR: num(r["has_ocr"]) == 1, HasSecret: num(r["has_secret"]) == 1,
			SourceName: cmpOr(str(r["app_name"]), str(r["source_bundle_id"])),
		}
		it.Pinboards = pinsBy[it.ID]
		paths := filesBy[it.ID]
		for _, p := range paths {
			it.FileNames = append(it.FileNames, filepath.Base(strings.TrimSuffix(p, "/")))
		}
		it.Title = it.CustomTitle
		if it.Title == "" {
			it.Title = DeriveTitle(it.Kind, str(r["text_head"]), it.URL, it.Color, paths, it.FileCount, it.ImageWidth, it.ImageHeight)
		}
		byID[it.ID] = it
	}
	out := make([]Item, 0, len(ids))
	for _, id := range ids {
		if it, ok := byID[id]; ok {
			out = append(out, it)
		}
	}
	return out
}

// Detail loads an item with its content.
func (s *Store) Detail(id string) (*Detail, error) {
	items := s.Items([]string{id})
	if len(items) == 0 {
		return nil, fmt.Errorf("no item %s", id)
	}
	rows, err := s.query("SELECT plain_text, html, ocr_text, tags FROM clip_items WHERE id = ?", id)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	d := &Detail{Item: items[0], PlainText: str(rows[0]["plain_text"]), HTML: str(rows[0]["html"]),
		OCRText: str(rows[0]["ocr_text"]), Tags: strings.Fields(str(rows[0]["tags"]))}
	files, _ := s.query("SELECT path FROM clip_files WHERE item_id = ? ORDER BY position", id)
	for _, f := range files {
		d.FilePaths = append(d.FilePaths, str(f["path"]))
	}
	if d.PlainText == "" && len(d.FilePaths) > 0 {
		d.PlainText = strings.Join(d.FilePaths, "\n")
	}
	return d, nil
}

// ImagePath is the stored PNG of an image item.
func (s *Store) ImagePath(it Item) string {
	if it.ImageHash == "" {
		return ""
	}
	return s.BlobFile(it.ImageHash)
}

// WriteItems are the pasteboard items that put an item back on the pasteboard.
func (s *Store) WriteItems(id string, plainOnly bool) ([][]Representation, string, error) {
	d, err := s.Detail(id)
	if err != nil {
		return nil, "", err
	}
	if plainOnly && d.PlainText != "" && d.Kind != KindFile && d.Kind != KindImage {
		return [][]Representation{{{UTI: "public.utf8-plain-text", Data: []byte(d.PlainText)}}}, d.Kind, nil
	}
	rows, err := s.query("SELECT item_index, uti, data, blob_hash FROM clip_representations WHERE item_id = ? ORDER BY item_index, rowid", id)
	if err != nil {
		return nil, "", err
	}
	grouped := map[int][]Representation{}
	for _, r := range rows {
		var data []byte
		if b, ok := r["data"].([]byte); ok && len(b) > 0 {
			data = b
		} else if h := str(r["blob_hash"]); h != "" {
			data = s.readBlob(h)
		}
		if len(data) == 0 {
			continue
		}
		idx := int(num(r["item_index"]))
		grouped[idx] = append(grouped[idx], Representation{ItemIndex: idx, UTI: str(r["uti"]), Data: data})
	}
	var indexes []int
	for idx := range grouped {
		indexes = append(indexes, idx)
	}
	sort.Ints(indexes)
	var out [][]Representation
	for _, idx := range indexes {
		out = append(out, grouped[idx])
	}
	if len(out) == 0 {
		switch {
		case d.Kind == KindFile && len(d.FilePaths) > 0:
			for _, p := range d.FilePaths {
				out = append(out, []Representation{{UTI: "public.file-url", Data: []byte((&url.URL{Scheme: "file", Path: p}).String())}})
			}
		case d.Kind == KindImage && d.ImageHash != "":
			if png := s.readBlob(d.ImageHash); png != nil {
				out = [][]Representation{{{UTI: "public.png", Data: png}}}
			}
		case d.PlainText != "":
			out = [][]Representation{{{UTI: "public.utf8-plain-text", Data: []byte(d.PlainText)}}}
		}
	}
	return out, d.Kind, nil
}

// Apps lists the apps items came from.
func (s *Store) Apps() []App {
	rows, _ := s.query(`SELECT a.bundle_id, a.name FROM apps a WHERE EXISTS (SELECT 1 FROM clip_items i WHERE i.source_bundle_id = a.bundle_id AND i.deleted_at IS NULL) ORDER BY a.name`)
	out := make([]App, 0, len(rows))
	for _, r := range rows {
		out = append(out, App{BundleID: str(r["bundle_id"]), Name: str(r["name"])})
	}
	return out
}

// ---- edit ----

// Rename sets an item's title ("" restores the derived one).
func (s *Store) Rename(id, title string) error {
	err := s.tx(append([]sqlite.Statement{{SQL: "UPDATE clip_items SET custom_title = ? WHERE id = ?", Args: []any{nullable(strings.TrimSpace(title)), id}}}, s.searchRowStmts(id)...))
	if err == nil {
		go s.changed("updated", id)
	}
	return err
}

// Delete soft-deletes items; Undo with the token brings them back until Purge.
func (s *Store) Delete(ids []string) (string, error) {
	ts := now()
	var stmts []sqlite.Statement
	for _, id := range ids {
		stmts = append(stmts, sqlite.Statement{SQL: "UPDATE clip_items SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", Args: []any{ts, id}})
	}
	if err := s.tx(stmts); err != nil {
		return "", err
	}
	token := newUUID()
	s.mu.Lock()
	s.undo[token] = ids
	s.mu.Unlock()
	go s.changed("deleted", ids...)
	return token, nil
}

// Undo restores the items of a Delete.
func (s *Store) Undo(token string) {
	s.mu.Lock()
	ids := s.undo[token]
	delete(s.undo, token)
	s.mu.Unlock()
	var stmts []sqlite.Statement
	for _, id := range ids {
		stmts = append(stmts, sqlite.Statement{SQL: "UPDATE clip_items SET deleted_at = NULL WHERE id = ?", Args: []any{id}})
	}
	if len(stmts) > 0 && s.tx(stmts) == nil {
		go s.changed("added", ids...)
	}
}

// Purge removes items deleted more than olderThan ago for good.
func (s *Store) Purge(olderThan time.Duration) int {
	cutoff := now() - olderThan.Milliseconds()
	rows, _ := s.query("SELECT id FROM clip_items WHERE deleted_at IS NOT NULL AND deleted_at < ?", cutoff)
	return s.removeRows(rows)
}

func (s *Store) removeRows(rows []map[string]any) int {
	if len(rows) == 0 {
		return 0
	}
	var stmts []sqlite.Statement
	for _, r := range rows {
		id := str(r["id"])
		stmts = append(stmts,
			sqlite.Statement{SQL: "DELETE FROM clip_search WHERE rowid = (SELECT rowid FROM clip_items WHERE id = ?)", Args: []any{id}},
			sqlite.Statement{SQL: "DELETE FROM clip_items WHERE id = ?", Args: []any{id}})
	}
	if err := s.tx(stmts); err != nil {
		logx.Warn("[clip-store] remove failed", "err", err)
		return 0
	}
	return len(rows)
}

// ClearHistory deletes every item that is in no pinboard.
func (s *Store) ClearHistory() int {
	rows, _ := s.query("SELECT id FROM clip_items i WHERE NOT EXISTS (SELECT 1 FROM pinboard_items p WHERE p.item_id = i.id)")
	n := s.removeRows(rows)
	go s.changed("cleared")
	return n
}

// Retention removes unpinned items older than the retention setting.
func (s *Store) Retention(retention string) int {
	days := map[string]int64{"1d": 1, "1w": 7, "1m": 30, "1y": 365}[retention]
	if days == 0 {
		return 0
	}
	cutoff := now() - days*dayMs
	rows, _ := s.query(`SELECT id FROM clip_items i WHERE last_copied_at < ?
	  AND NOT EXISTS (SELECT 1 FROM pinboard_items p WHERE p.item_id = i.id)`, cutoff)
	n := s.removeRows(rows)
	if n > 0 {
		logx.Info("[clip-store] retention", "deleted", n, "retention", retention)
		go s.changed("deleted")
	}
	return n
}

// Count is the number of items.
func (s *Store) Count() int {
	rows, _ := s.query("SELECT count(*) AS n FROM clip_items WHERE deleted_at IS NULL")
	if len(rows) == 0 {
		return 0
	}
	return int(num(rows[0]["n"]))
}

// ---- pinboards ----

// Pinboards lists the pinboards in order.
func (s *Store) Pinboards() []Pinboard {
	rows, _ := s.query(`SELECT p.id, p.name, p.color, p.sort_order,
	  (SELECT count(*) FROM pinboard_items x JOIN clip_items i ON i.id = x.item_id WHERE x.pinboard_id = p.id AND i.deleted_at IS NULL) AS n
	  FROM pinboards p ORDER BY p.sort_order, p.created_at`)
	out := make([]Pinboard, 0, len(rows))
	for _, r := range rows {
		out = append(out, Pinboard{ID: str(r["id"]), Name: str(r["name"]), Color: str(r["color"]), SortOrder: int(num(r["sort_order"])), ItemCount: int(num(r["n"]))})
	}
	return out
}

// CreatePinboard adds a pinboard at the end.
func (s *Store) CreatePinboard(name, color string) (Pinboard, error) {
	p := Pinboard{ID: newUUID(), Name: strings.TrimSpace(name), Color: color, SortOrder: len(s.Pinboards())}
	_, err := s.exec("INSERT INTO pinboards (id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)", p.ID, p.Name, p.Color, p.SortOrder, now())
	if err == nil {
		go s.changed("pinboards")
	}
	return p, err
}

// UpdatePinboard renames or recolors a pinboard.
func (s *Store) UpdatePinboard(id, name, color string) error {
	_, err := s.exec("UPDATE pinboards SET name = COALESCE(NULLIF(?, ''), name), color = COALESCE(NULLIF(?, ''), color) WHERE id = ?", strings.TrimSpace(name), color, id)
	if err == nil {
		go s.changed("pinboards")
	}
	return err
}

// DeletePinboard removes a pinboard (its items stay in the history).
func (s *Store) DeletePinboard(id string) error {
	err := s.tx([]sqlite.Statement{{SQL: "DELETE FROM pinboard_items WHERE pinboard_id = ?", Args: []any{id}}, {SQL: "DELETE FROM pinboards WHERE id = ?", Args: []any{id}}})
	if err == nil {
		go s.changed("pinboards")
	}
	return err
}

// AddToPinboard adds items to a pinboard, at its end.
func (s *Store) AddToPinboard(pinboardID string, ids []string) error {
	ts := now()
	var stmts []sqlite.Statement
	for _, id := range ids {
		stmts = append(stmts, sqlite.Statement{SQL: `INSERT OR IGNORE INTO pinboard_items (pinboard_id, item_id, sort_order, added_at)
		  VALUES (?, ?, COALESCE((SELECT max(sort_order) + 1 FROM pinboard_items WHERE pinboard_id = ?), 0), ?)`, Args: []any{pinboardID, id, pinboardID, ts}})
	}
	err := s.tx(stmts)
	if err == nil {
		go s.changed("pinboards", ids...)
	}
	return err
}

// RemoveFromPinboard takes items out of a pinboard.
func (s *Store) RemoveFromPinboard(pinboardID string, ids []string) error {
	var stmts []sqlite.Statement
	for _, id := range ids {
		stmts = append(stmts, sqlite.Statement{SQL: "DELETE FROM pinboard_items WHERE pinboard_id = ? AND item_id = ?", Args: []any{pinboardID, id}})
	}
	err := s.tx(stmts)
	if err == nil {
		go s.changed("pinboards", ids...)
	}
	return err
}
