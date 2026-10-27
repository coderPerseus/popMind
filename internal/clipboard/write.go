package clipboard

import (
	"time"

	"popmind/internal/logx"
	"popmind/internal/native"
)

// PasteResult says what Paste did: "pasted", "copied" (on the clipboard, no ⌘V) or "none".
type PasteResult struct {
	Action string
	Reason string // "not_found", "no_permission", "secure_input", "no_target", "write_failed"
}

// Copy puts an item on the clipboard, marked as popMind's own write.
func (s *Store) Copy(id string, plainText bool) bool {
	groups, _, err := s.WriteItems(id, plainText)
	if err != nil || len(groups) == 0 {
		logx.Warn("[clip-write] no payload", "id", id, "err", err)
		return false
	}
	items := make([]native.PasteboardItem, 0, len(groups))
	for _, g := range groups {
		var reps []native.PasteboardRepresentation
		for _, r := range g {
			reps = append(reps, native.PasteboardRepresentation{Type: r.UTI, Data: r.Data})
		}
		items = append(items, native.PasteboardItem{Representations: reps})
	}
	ok := native.WritePasteboard(items, id)
	if ok {
		s.MarkUsed(id)
	}
	return ok
}

// Paste copies an item and, when direct paste is on and a target app is known, sends ⌘V to it.
// Call after the panel has hidden, so the target app has the keyboard.
func (s *Store) Paste(id string, plainText bool, targetPid int, direct bool) PasteResult {
	if !s.Copy(id, plainText) {
		return PasteResult{Action: "none", Reason: "write_failed"}
	}
	if !direct {
		return PasteResult{Action: "copied"}
	}
	if !native.CheckPermission(false) {
		return PasteResult{Action: "copied", Reason: "no_permission"}
	}
	if native.IsSecureInputEnabled() {
		return PasteResult{Action: "copied", Reason: "secure_input"}
	}
	if targetPid > 0 {
		native.ActivateApp(targetPid)
		time.Sleep(120 * time.Millisecond)
	} else if native.Frontmost().Pid <= 0 {
		return PasteResult{Action: "copied", Reason: "no_target"}
	}
	r := native.PostPasteKeystroke()
	logx.Info("[clip-write] paste", "ok", r.OK, "reason", r.Reason, "targetPid", targetPid)
	if !r.OK {
		return PasteResult{Action: "copied", Reason: r.Reason}
	}
	return PasteResult{Action: "pasted"}
}
