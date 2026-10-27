package clipboard

import (
	"errors"
	"slices"

	"github.com/egoist/mygo/plugins/sqlite"

	"popmind/internal/logx"
)

// EditableLimit is the longest text item that can be edited in place.
const EditableLimit = 200_000

// CanEdit reports whether the panel offers to edit it.
func CanEdit(it Item) bool {
	return (it.Kind == KindText || it.Kind == KindLink || it.Kind == KindColor) && it.CharCount <= EditableLimit
}

// UpdateText replaces the content of a text, link or color item with text, which is classified again
// (updateText of clip-database.ts). An item that already had that content merges into this one.
func (s *Store) UpdateText(id, text string) error {
	t := NormalizeText(text)
	if t == "" {
		return errors.New("empty text")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.query("SELECT kind FROM clip_items WHERE id = ? AND deleted_at IS NULL", id)
	if err != nil {
		return err
	}
	if len(rows) == 0 || !slices.Contains([]string{KindText, KindLink, KindColor}, str(rows[0]["kind"])) {
		return errors.New("not editable")
	}
	rec := TextRecord(t, now())
	var stmts []sqlite.Statement
	add := func(sql string, args ...any) { stmts = append(stmts, sqlite.Statement{SQL: sql, Args: args}) }
	other, _ := s.query("SELECT id, copy_count FROM clip_items WHERE fingerprint = ? AND id <> ?", rec.Fingerprint, id)
	if len(other) > 0 {
		oid := str(other[0]["id"])
		add(`INSERT OR IGNORE INTO pinboard_items (pinboard_id, item_id, sort_order, added_at)
		     SELECT pinboard_id, ?, sort_order, added_at FROM pinboard_items WHERE item_id = ?`, id, oid)
		add("UPDATE clip_items SET copy_count = copy_count + ? WHERE id = ?", num(other[0]["copy_count"]), id)
		add("DELETE FROM clip_search WHERE rowid = (SELECT rowid FROM clip_items WHERE id = ?)", oid)
		add("DELETE FROM clip_items WHERE id = ?", oid)
	}
	add("DELETE FROM clip_representations WHERE item_id = ?", id)
	add(`INSERT INTO clip_representations (item_id, item_index, uti, data, blob_hash, byte_size) VALUES (?, 0, ?, ?, NULL, ?)`,
		id, "public.utf8-plain-text", []byte(t), len(t))
	add(`UPDATE clip_items SET kind = ?, sub_kind = ?, is_rich = 0, fingerprint = ?, preview_text = ?, plain_text = ?,
	       html = NULL, url = ?, color_value = ?, byte_size = ?, char_count = ?, tags = ? WHERE id = ?`,
		rec.Kind, nullable(rec.SubKind), rec.Fingerprint, rec.Preview, t, nullable(rec.URL), nullable(rec.Color),
		rec.ByteSize, rec.CharCount, joinTags(rec.Tags), id)
	stmts = append(stmts, s.searchRowStmts(id)...)
	if err := s.tx(stmts); err != nil {
		return err
	}
	go s.changed("updated", id)
	logx.Info("[clip-store] text updated", "kind", rec.Kind, "merged", len(other) > 0)
	return nil
}

// CreateText adds text the user typed as a new item and returns its id.
func (s *Store) CreateText(text string) (string, error) {
	t := NormalizeText(text)
	if t == "" {
		return "", errors.New("empty text")
	}
	id, _, err := s.Ingest(TextRecord(t, now()))
	return id, err
}

func joinTags(tags []string) string {
	out := ""
	for i, t := range tags {
		if i > 0 {
			out += " "
		}
		out += t
	}
	return out
}
