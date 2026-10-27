package clipboard

import (
	"strings"

	"github.com/egoist/mygo/plugins/sqlite"
)

// Sync bookkeeping (clip-database.ts, docs/clipboard-sync.md): which local items exist remotely, which remote
// objects this Mac has seen, and which remote pinboard memberships it applied. Additive tables, the Electron
// app's, so both apps can share a database and a bucket.
const syncSchema = `
CREATE TABLE IF NOT EXISTS sync_items (
  item_id    TEXT PRIMARY KEY REFERENCES clip_items(id) ON DELETE CASCADE,
  remote_key TEXT NOT NULL,
  origin     TEXT NOT NULL,
  synced_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_items_key ON sync_items(remote_key);
CREATE TABLE IF NOT EXISTS sync_remote_keys (
  remote_key TEXT PRIMARY KEY,
  seen_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_pinboard_members (
  pinboard_key TEXT NOT NULL,
  item_key     TEXT NOT NULL,
  PRIMARY KEY (pinboard_key, item_key)
);
`

// Outgoing is an item to upload.
type Outgoing struct {
	ID, Fingerprint, Kind, SubKind string
	IsRich                         bool
	CustomTitle, PlainText, HTML   string
	URL, Color                     string
	ImageWidth, ImageHeight        int
	ImageHash, ImagePath           string
	SourceID, SourceName           string
	Reps                           []Representation
}

// Incoming is an item received from the bucket.
type Incoming struct {
	RemoteKey   string
	Record      Record
	CustomTitle string
}

// SyncEntry links a local item to its remote object.
type SyncEntry struct{ ItemID, RemoteKey string }

// LocalPinboard is a pinboard with the remote keys of its synced items.
type LocalPinboard struct {
	ID, Name, Color string
	ItemKeys        []string
}

// SyncPendingUploadIDs lists items not uploaded yet: copied since since, or in a pinboard; files never sync.
func (s *Store) SyncPendingUploadIDs(since int64) []string {
	rows, _ := s.query(`SELECT i.id FROM clip_items i
	  WHERE i.deleted_at IS NULL AND i.kind != 'file'
	    AND NOT EXISTS (SELECT 1 FROM sync_items s WHERE s.item_id = i.id)
	    AND (i.last_copied_at >= ? OR EXISTS (SELECT 1 FROM pinboard_items pi WHERE pi.item_id = i.id))
	  ORDER BY i.last_copied_at ASC`, since)
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, str(r["id"]))
	}
	return out
}

// SyncLoadOutgoing loads items to upload, without their image representations (the PNG goes as a blob).
func (s *Store) SyncLoadOutgoing(ids []string) []Outgoing {
	var out []Outgoing
	for _, id := range ids {
		rows, _ := s.query(`SELECT i.*, a.name AS app_name FROM clip_items i LEFT JOIN apps a ON a.bundle_id = i.source_bundle_id
		  WHERE i.id = ? AND i.deleted_at IS NULL`, id)
		if len(rows) == 0 {
			continue
		}
		r := rows[0]
		o := Outgoing{ID: id, Fingerprint: str(r["fingerprint"]), Kind: str(r["kind"]), SubKind: str(r["sub_kind"]),
			IsRich: num(r["is_rich"]) == 1, CustomTitle: strings.TrimSpace(str(r["custom_title"])), PlainText: str(r["plain_text"]),
			HTML: str(r["html"]), URL: str(r["url"]), Color: str(r["color_value"]), ImageWidth: int(num(r["image_width"])),
			ImageHeight: int(num(r["image_height"])), ImageHash: str(r["image_blob_hash"]), SourceID: str(r["source_bundle_id"])}
		o.SourceName = cmpOr(str(r["app_name"]), o.SourceID)
		if o.ImageHash != "" {
			o.ImagePath = s.BlobFile(o.ImageHash)
		}
		reps, _ := s.query(`SELECT item_index, uti, data, blob_hash FROM clip_representations
		  WHERE item_id = ? AND uti != 'public.file-url' ORDER BY item_index, rowid`, id)
		for _, rep := range reps {
			uti := str(rep["uti"])
			if imageUTIs[uti] {
				continue
			}
			var data []byte
			if b, ok := rep["data"].([]byte); ok && b != nil {
				data = b
			} else if h := str(rep["blob_hash"]); h != "" {
				data = s.readBlob(h)
			}
			if data != nil {
				o.Reps = append(o.Reps, Representation{ItemIndex: int(num(rep["item_index"])), UTI: uti, Data: data})
			}
		}
		out = append(out, o)
	}
	return out
}

// SyncMarkUploaded links items to their remote objects; "skipped" (too large) ones are not retried, until an
// explicit upload turns them "local".
func (s *Store) SyncMarkUploaded(entries []SyncEntry, origin string) {
	ts := now()
	var stmts []sqlite.Statement
	for _, e := range entries {
		stmts = append(stmts, sqlite.Statement{SQL: `INSERT INTO sync_items (item_id, remote_key, origin, synced_at)
		  SELECT id, ?, ?, ? FROM clip_items WHERE id = ?
		  ON CONFLICT(item_id) DO UPDATE SET remote_key = excluded.remote_key, origin = excluded.origin, synced_at = excluded.synced_at
		  WHERE sync_items.origin = 'skipped' AND excluded.origin = 'local'`, Args: []any{e.RemoteKey, origin, ts, e.ItemID}})
	}
	if len(stmts) > 0 {
		_ = s.tx(stmts)
	}
}

// SyncReset forgets the bookkeeping (another bucket or key).
func (s *Store) SyncReset() {
	_ = s.tx([]sqlite.Statement{{SQL: "DELETE FROM sync_items"}, {SQL: "DELETE FROM sync_remote_keys"}, {SQL: "DELETE FROM sync_pinboard_members"}})
}

// SyncKnownKeys are the remote objects this Mac has (uploaded, received or seen).
func (s *Store) SyncKnownKeys() map[string]bool {
	rows, _ := s.query(`SELECT remote_key FROM sync_items WHERE origin != 'skipped' UNION SELECT remote_key FROM sync_remote_keys`)
	out := make(map[string]bool, len(rows))
	for _, r := range rows {
		out[str(r["remote_key"])] = true
	}
	return out
}

// SyncMarkSeen records remote objects that could not be used, so they are not fetched again.
func (s *Store) SyncMarkSeen(keys []string) {
	ts := now()
	var stmts []sqlite.Statement
	for _, k := range keys {
		stmts = append(stmts, sqlite.Statement{SQL: "INSERT OR IGNORE INTO sync_remote_keys (remote_key, seen_at) VALUES (?, ?)", Args: []any{k, ts}})
	}
	if len(stmts) > 0 {
		_ = s.tx(stmts)
	}
}

// SyncImportItems adds received items as new content; content already here (even deleted) is only linked.
// It returns the ids of the items added.
func (s *Store) SyncImportItems(items []Incoming) []string {
	var added []string
	ts := now()
	for _, in := range items {
		rows, _ := s.query("SELECT id FROM clip_items WHERE fingerprint = ?", in.Record.Fingerprint)
		id, origin := "", "remote"
		if len(rows) > 0 {
			id, origin = str(rows[0]["id"]), "local"
		} else {
			newID, _, err := s.Ingest(in.Record)
			if err != nil {
				continue
			}
			id = newID
			added = append(added, id)
			if t := strings.TrimSpace(in.CustomTitle); t != "" {
				_ = s.Rename(id, t)
			}
		}
		_ = s.tx([]sqlite.Statement{
			{SQL: "INSERT OR IGNORE INTO sync_items (item_id, remote_key, origin, synced_at) VALUES (?, ?, ?, ?)", Args: []any{id, in.RemoteKey, origin, ts}},
			{SQL: "INSERT OR IGNORE INTO sync_remote_keys (remote_key, seen_at) VALUES (?, ?)", Args: []any{in.RemoteKey, ts}},
		})
	}
	return added
}

// SyncLocalPinboards lists the pinboards with the remote keys of their synced members, in their order.
func (s *Store) SyncLocalPinboards() []LocalPinboard {
	var out []LocalPinboard
	for _, pb := range s.Pinboards() {
		rows, _ := s.query(`SELECT s.remote_key FROM pinboard_items pi
		  JOIN sync_items s ON s.item_id = pi.item_id AND s.origin != 'skipped'
		  JOIN clip_items ci ON ci.id = pi.item_id AND ci.deleted_at IS NULL
		  WHERE pi.pinboard_id = ? ORDER BY pi.sort_order`, pb.ID)
		lp := LocalPinboard{ID: pb.ID, Name: pb.Name, Color: pb.Color}
		for _, r := range rows {
			lp.ItemKeys = append(lp.ItemKeys, str(r["remote_key"]))
		}
		out = append(out, lp)
	}
	return out
}

// SyncApplyPinboard adds a remote pinboard's new members here (creating it by name), once each: a member
// removed here stays removed.
func (s *Store) SyncApplyPinboard(key, name, color string, itemKeys []string) (created bool, added int) {
	appliedRows, _ := s.query("SELECT item_key FROM sync_pinboard_members WHERE pinboard_key = ?", key)
	applied := map[string]bool{}
	for _, r := range appliedRows {
		applied[str(r["item_key"])] = true
	}
	var keys, ids []string
	for _, k := range itemKeys {
		if applied[k] {
			continue
		}
		rows, _ := s.query(`SELECT s.item_id FROM sync_items s JOIN clip_items ci ON ci.id = s.item_id
		  WHERE s.remote_key = ? AND s.origin != 'skipped' AND ci.deleted_at IS NULL LIMIT 1`, k)
		if len(rows) > 0 {
			keys, ids = append(keys, k), append(ids, str(rows[0]["item_id"]))
		}
	}
	if len(ids) == 0 {
		return false, 0
	}
	pbID := ""
	if rows, _ := s.query("SELECT id FROM pinboards WHERE name = ? LIMIT 1", name); len(rows) > 0 {
		pbID = str(rows[0]["id"])
	} else {
		pb, err := s.CreatePinboard(name, color)
		if err != nil {
			return false, 0
		}
		pbID, created = pb.ID, true
	}
	before := s.pinboardCount(pbID)
	// Remote order is front first: the new members go to the front, in order.
	ts := now()
	var stmts []sqlite.Statement
	for i := len(ids) - 1; i >= 0; i-- {
		stmts = append(stmts, sqlite.Statement{SQL: `INSERT OR IGNORE INTO pinboard_items (pinboard_id, item_id, sort_order, added_at)
		  VALUES (?, ?, COALESCE((SELECT min(sort_order) - 1 FROM pinboard_items WHERE pinboard_id = ?), 0), ?)`,
			Args: []any{pbID, ids[i], pbID, ts}})
	}
	_ = s.tx(stmts)
	s.SyncMarkPinboardMembers(key, keys)
	added = s.pinboardCount(pbID) - before
	go s.changed("pinboards", ids...)
	return created, added
}

func (s *Store) pinboardCount(id string) int {
	rows, _ := s.query("SELECT count(*) AS n FROM pinboard_items WHERE pinboard_id = ?", id)
	if len(rows) == 0 {
		return 0
	}
	return int(num(rows[0]["n"]))
}

// SyncMarkPinboardMembers records remote pinboard memberships as applied.
func (s *Store) SyncMarkPinboardMembers(key string, itemKeys []string) {
	var stmts []sqlite.Statement
	for _, k := range itemKeys {
		stmts = append(stmts, sqlite.Statement{SQL: "INSERT OR IGNORE INTO sync_pinboard_members (pinboard_key, item_key) VALUES (?, ?)", Args: []any{key, k}})
	}
	if len(stmts) > 0 {
		_ = s.tx(stmts)
	}
}

// SyncRecord builds the record of a received item (decodeItemPayload's toRecord).
func SyncRecord(kind, subKind string, rich bool, fingerprint, text, html, url, color string, w, h int, png []byte,
	reps []Representation, sourceID, sourceName string, copiedAt int64) Record {
	files := []string(nil)
	if png != nil {
		reps = append(reps, Representation{UTI: utiPNG, Data: png})
	}
	var size int64
	for _, r := range reps {
		size += int64(len(r.Data))
	}
	var tags []string
	if kind == KindText || kind == KindLink {
		_, tags = localTags(cmpOr(text, url))
	}
	return Record{Kind: kind, SubKind: subKind, IsRich: rich, Fingerprint: fingerprint,
		Title: DeriveTitle(kind, text, url, color, files, 0, w, h), Preview: Preview(kind, text, url, color, files, w, h),
		PlainText: text, HTML: html, URL: url, Color: color, ImagePNG: png, ImageWidth: w, ImageHeight: h, Reps: reps,
		ByteSize: size, CharCount: len([]rune(text)), SourceID: sourceID, SourceName: sourceName, Tags: tags, CopiedAt: copiedAt}
}
