package views

import (
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"popmind/internal/clipboard"
	"popmind/internal/clipsync"
	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/settings"
	"popmind/internal/windows"
)

// The clipboard panel along the bottom of the screen (Alt+V), as app/components/clipboard-panel of the Electron
// app: a search bar with filters and pinboard tabs over a strip of cards, Quick Look, dialogs and a toast.

const (
	// clipPanelHeight is the panel's height (the Electron app's default): a search bar and one row of cards.
	clipPanelHeight = 340
	clipCardWidth   = 220
	clipCardGap     = 12
	clipUndoWindow  = 5 * time.Second
)

var pinboardColorValues = map[string]ui.Color{
	"red": ui.Hex("#ff453a"), "orange": ui.Hex("#ff9f0a"), "yellow": ui.Hex("#ffd60a"), "green": ui.Hex("#30d158"),
	"blue": ui.Hex("#0a84ff"), "purple": ui.Hex("#bf5af2"), "gray": ui.Hex("#8e8e93"),
}

func pinboardColor(name string) ui.Color {
	if c, ok := pinboardColorValues[name]; ok {
		return c
	}
	if strings.HasPrefix(name, "#") {
		return ui.Hex(name)
	}
	return pinboardColorValues["gray"]
}

// clipDialog is the dialog the panel shows, if any.
type clipDialog struct {
	kind    string // "rename", "edit", "newText", "newPinboard", "renamePinboard", "deletePinboard"
	item    clipboard.Item
	pin     clipboard.Pinboard
	text    string
	color   string
	loading bool
	open    bool
	seen    bool
	// addTargets adds the items the dialog was opened for to the pinboard it creates.
	addTargets []string
}

type clipToast struct {
	text    string
	warning bool
	action  string
	undo    string
	until   time.Time
}

// ClipboardPanel is the history panel.
type ClipboardPanel struct {
	app   *App
	win   *mygo.Window
	store *clipboard.Store
	sync  *clipsync.Service
	// openSyncSettings opens Settings → Clipboard (set by the app; a field, not a call, to keep the package's
	// initialization free of cycles).
	openSyncSettings func()

	query      string
	input      ui.Handle
	scope      string // "" for the history, else a pinboard id
	kind       string
	date       string
	appIDs     []string
	filterRow  bool
	appearance string

	items   []clipboard.Item
	pins    []clipboard.Pinboard
	apps    []clipboard.App
	loading bool
	seq     int

	// The selection: ids chosen, the active card (ring, Quick Look) and where Shift extends from.
	selected map[string]bool
	active   string
	anchor   string
	reveal   bool

	quickLook bool
	qlSeen    bool
	detail    *clipboard.Detail
	detailID  string
	richView  int

	dialog clipDialog
	toast  *clipToast
	undo   string
	undoAt time.Time

	target    native.FrontmostApp
	shownAt   time.Time
	cardRects map[string]ui.Rect

	mu        sync.Mutex
	thumbs    map[string]*ui.Bitmap
	icons     map[string]*ui.Bitmap
	fileIcons map[string]*ui.Bitmap
	previews  map[string]*clipPreview
}

type clipPreview struct {
	title, site string
	image       *ui.Bitmap
}

func newClipboardPanel(app *App, store *clipboard.Store) *ClipboardPanel {
	p := &ClipboardPanel{app: app, store: store, selected: map[string]bool{}, cardRects: map[string]ui.Rect{},
		thumbs: map[string]*ui.Bitmap{}, icons: map[string]*ui.Bitmap{}, fileIcons: map[string]*ui.Bitmap{},
		previews: map[string]*clipPreview{}}
	p.win = mygo.NewWindow(mygo.WindowOptions{
		Title:         "popMind Clipboard",
		Panel:         true,
		Hidden:        true,
		Frameless:     true,
		Transparent:   true,
		Vibrancy:      mygo.VibrancyPopover,
		Width:         1200,
		Height:        clipPanelHeight,
		DisableResize: true,
		Content:       ui.View(p.view),
	})
	p.win.OnShow(func() {
		native.RegisterSurfaceWindow(p.win.NativeHandle())
		native.SetVibrancyTopCornerRadius(p.win.NativeHandle(), 10)
	})
	p.win.OnClose(func(e *mygo.CloseEvent) {
		e.PreventDefault()
		p.Hide()
	})
	p.win.OnBlur(func() {
		// A menu or dialog of the panel takes the focus for a moment; only a real blur hides it.
		go func() {
			time.Sleep(120 * time.Millisecond)
			if !p.win.IsFocused() {
				p.Hide()
			}
		}()
	})
	windows.Register(&windows.Surface{
		ID: "clipboard", Priority: 400, Visible: p.win.IsVisible, Hide: p.Hide,
		ShouldDismiss: func(ctx windows.DismissContext) bool {
			return ctx.Reason == windows.DismissEscape || (ctx.Reason == windows.DismissSurfaceOpened && ctx.Target != "clipboard")
		},
	})
	if store != nil {
		store.OnChange(func(reason string, _ []string) {
			if p.win.IsVisible() {
				p.win.Update(p.reload)
			}
		})
	}
	return p
}

// ---- show / hide ----

// Show shows the panel along the bottom of the display with the pointer, with query typed in.
func (p *ClipboardPanel) Show(query string) {
	if p.store == nil {
		logx.Warn("[clip-panel] no store")
		return
	}
	windows.Dispatch(windows.DismissContext{Reason: windows.DismissSurfaceOpened, Target: "clipboard"})
	p.target = native.Frontmost()
	appearance := clipboard.CurrentSettings().Appearance
	r := p.bounds()
	p.win.Update(func() {
		p.query, p.scope, p.kind, p.date, p.appIDs, p.filterRow = query, "", "", "", nil, false
		p.quickLook, p.dialog, p.toast, p.appearance = false, clipDialog{}, nil, appearance
		p.selected, p.active, p.anchor = map[string]bool{}, "", ""
		p.shownAt = time.Now()
		p.reload()
		p.input.Focus()
	})
	p.win.SetBounds(r)
	showIn(p.win, 150, 14, p.win.Show)
	switch appearance {
	case "dark", "light":
		native.SetWindowAppearance(p.win.NativeHandle(), appearance)
	default:
		native.SetWindowAppearance(p.win.NativeHandle(), "")
	}
	logx.Info("[clip-panel] shown", "target", p.target.Name, "height", r.Height)
	// Sync quietly as the panel opens, at most every five minutes.
	if p.sync != nil {
		if st := p.sync.Status(); st.Configured && !st.Running && (st.LastSync == nil || time.Since(time.UnixMilli(st.LastSync.FinishedAt)) > 5*time.Minute) {
			go p.runSync(false)
		}
	}
}

// runSync syncs now; loud tells the result in a toast (the sync button), quiet only reports what arrived.
func (p *ClipboardPanel) runSync(loud bool) {
	if p.sync == nil {
		return
	}
	if st := p.sync.Status(); !st.Configured {
		if p.openSyncSettings != nil {
			p.openSyncSettings()
		}
		go p.Hide()
		return
	}
	sum := p.sync.Run()
	p.win.Update(func() {
		switch {
		case sum.ErrorCode == clipsync.ErrBusy:
		case !sum.OK:
			p.showToast(clipToast{text: i18n.T("clip.panel.sync.failed", "reason", i18n.T("clip.panel.sync.error."+sum.ErrorCode)), warning: true}, 4*time.Second)
		case sum.Received == 0 && sum.Uploaded == 0:
			if loud {
				p.showToast(clipToast{text: i18n.T("clip.panel.sync.upToDate")}, 0)
			}
		case loud || sum.Received > 0:
			text := i18n.T("clip.panel.sync.done", "received", sum.Received, "uploaded", sum.Uploaded)
			if sum.Skipped > 0 {
				text += i18n.T("clip.panel.sync.skipped", "count", sum.Skipped)
			}
			p.showToast(clipToast{text: text}, 3*time.Second)
		}
		p.reload()
	})
}

// pushSelected uploads the chosen items now (context menu).
func (p *ClipboardPanel) pushSelected(items []clipboard.Item) {
	if p.sync == nil || len(items) == 0 {
		return
	}
	if !p.sync.Status().Configured {
		logx.Info("[clip-panel] sync to remote: not set up, opening settings")
		if p.openSyncSettings != nil {
			p.openSyncSettings()
		}
		go p.Hide()
		return
	}
	logx.Info("[clip-panel] sync to remote", "items", len(items))
	ids := make([]string, len(items))
	for i, it := range items {
		ids[i] = it.ID
	}
	p.showToast(clipToast{text: i18n.T("clip.panel.sync.pushing")}, 10*time.Second)
	go func() {
		res := p.sync.Push(ids)
		p.win.Update(func() {
			switch {
			case !res.OK:
				p.showToast(clipToast{text: i18n.T("clip.panel.sync.failed", "reason", i18n.T("clip.panel.sync.error."+res.ErrorCode)), warning: true}, 4*time.Second)
			case res.Uploaded > 0:
				p.showToast(clipToast{text: i18n.T("clip.panel.sync.pushed", "count", res.Uploaded)}, 0)
			case res.Existing > 0:
				p.showToast(clipToast{text: i18n.T("clip.panel.sync.pushedExisting")}, 0)
			default:
				p.showToast(clipToast{text: i18n.T("clip.panel.sync.pushSkipped")}, 0)
			}
		})
	}()
}

func (p *ClipboardPanel) bounds() mygo.Rectangle {
	d := mygo.Screen.DisplayNearestPoint(mygo.Screen.CursorScreenPoint())
	wa := d.WorkArea
	height := min(clipPanelHeight, wa.Height)
	return mygo.Rectangle{X: wa.X, Y: wa.Y + wa.Height - height, Width: wa.Width, Height: height}
}

// Hide hides the panel.
func (p *ClipboardPanel) Hide() {
	if p.win.IsVisible() {
		p.win.Hide()
	}
}

// Bounds is where it is.
func (p *ClipboardPanel) Bounds() mygo.Rectangle { return p.win.Bounds() }

// Toggle shows or hides it.
func (p *ClipboardPanel) Toggle() {
	if p.win.IsVisible() {
		p.Hide()
		return
	}
	p.Show("")
}

// ---- data ----

// reload searches again; call on the main thread.
func (p *ClipboardPanel) reload() {
	p.seq++
	seq := p.seq
	q := clipboard.Query{Text: p.query, PinboardID: p.scope, AppIDs: p.appIDs, Limit: 200}
	if p.kind != "" {
		q.Kinds = []string{p.kind}
	}
	if p.date != "" {
		q.From, q.To = clipboard.PresetRange(p.date, time.Now())
	}
	p.loading = true
	go func() {
		items, _ := p.store.Search(q)
		pins := p.store.Pinboards()
		apps := p.store.Apps()
		p.win.Update(func() {
			if seq != p.seq {
				return
			}
			p.items, p.pins, p.apps, p.loading = items, pins, apps, false
			p.reconcile()
		})
	}()
}

// reconcile keeps the selection on items that are still listed.
func (p *ClipboardPanel) reconcile() {
	if len(p.items) == 0 {
		p.selected, p.active, p.anchor = map[string]bool{}, "", ""
		return
	}
	present := map[string]bool{}
	for _, it := range p.items {
		present[it.ID] = true
	}
	for id := range p.selected {
		if !present[id] {
			delete(p.selected, id)
		}
	}
	if !present[p.active] {
		p.active = p.items[0].ID
		p.selected = map[string]bool{p.active: true}
		p.reveal = true
	}
	if !present[p.anchor] {
		p.anchor = p.active
	}
	if len(p.selected) == 0 {
		p.selected[p.active] = true
	}
	if p.quickLook && p.detailID != p.active {
		p.loadDetail()
	}
}

func (p *ClipboardPanel) indexOf(id string) int {
	return slices.IndexFunc(p.items, func(it clipboard.Item) bool { return it.ID == id })
}

// targets are the selected items in display order, or the active one.
func (p *ClipboardPanel) targets() []clipboard.Item {
	var out []clipboard.Item
	for _, it := range p.items {
		if p.selected[it.ID] {
			out = append(out, it)
		}
	}
	if len(out) == 0 {
		if i := p.indexOf(p.active); i >= 0 {
			out = append(out, p.items[i])
		}
	}
	return out
}

func (p *ClipboardPanel) activeItem() (clipboard.Item, bool) {
	if i := p.indexOf(p.active); i >= 0 {
		return p.items[i], true
	}
	return clipboard.Item{}, false
}

func (p *ClipboardPanel) selectOnly(id string) {
	p.selected, p.active, p.anchor, p.reveal = map[string]bool{id: true}, id, id, true
	if p.quickLook {
		p.loadDetail()
	}
}

// move moves the active card ("next", "prev", "first", "last"), extending the selection with Shift.
func (p *ClipboardPanel) move(to string, extend bool) {
	n := len(p.items)
	if n == 0 {
		return
	}
	cur := p.indexOf(p.active)
	next := cur
	switch to {
	case "first":
		next = 0
	case "last":
		next = n - 1
	case "next":
		next = min(n-1, cur+1)
	case "prev":
		next = max(0, cur-1)
	}
	next = max(0, next)
	id := p.items[next].ID
	if !extend {
		p.selectOnly(id)
		return
	}
	p.extendTo(id)
}

func (p *ClipboardPanel) extendTo(id string) {
	anchor := p.indexOf(p.anchor)
	if anchor < 0 {
		anchor = p.indexOf(id)
		p.anchor = id
	}
	at := p.indexOf(id)
	from, to := min(anchor, at), max(anchor, at)
	p.selected = map[string]bool{}
	for _, it := range p.items[from : to+1] {
		p.selected[it.ID] = true
	}
	p.active, p.reveal = id, true
	if p.quickLook {
		p.loadDetail()
	}
}

// click applies a click with modifiers to the selection (clickSelection of selection.ts).
func (p *ClipboardPanel) click(id string, mods ui.Modifiers) {
	defer func() { logx.Info("[clip-panel] click", "mods", int(mods), "selected", len(p.selected)) }()
	switch {
	case mods&ui.Shift != 0:
		p.extendTo(id)
	case mods&ui.Cmd != 0:
		if p.selected[id] {
			delete(p.selected, id)
			if p.active == id {
				p.active = ""
				for _, it := range p.items {
					if p.selected[it.ID] {
						p.active = it.ID
					}
				}
			}
			if len(p.selected) == 0 {
				p.selectOnly(id)
			}
			return
		}
		p.selected[id] = true
		p.active, p.anchor = id, id
	default:
		p.selectOnly(id)
	}
}

func (p *ClipboardPanel) selectAll() {
	if len(p.items) == 0 {
		return
	}
	p.selected = map[string]bool{}
	for _, it := range p.items {
		p.selected[it.ID] = true
	}
	p.anchor = p.items[0].ID
	if p.active == "" {
		p.active = p.items[0].ID
	}
}

// ---- actions ----

func (p *ClipboardPanel) showToast(t clipToast, d time.Duration) {
	if d == 0 {
		d = 2200 * time.Millisecond
	}
	t.until = time.Now().Add(d)
	p.toast = &t
}

func (p *ClipboardPanel) paste(items []clipboard.Item, plain bool) {
	if len(items) == 0 {
		return
	}
	target := p.target.Pid
	direct := clipboard.CurrentSettings().DirectPaste
	plain = plain || clipboard.CurrentSettings().AlwaysPlainText
	ids := make([]string, len(items))
	for i, it := range items {
		ids[i] = it.ID
	}
	logx.Info("[clip-panel] paste", "items", len(ids), "plain", plain, "direct", direct, "target", p.target.Name)
	p.Hide()
	go func() {
		if len(ids) == 1 {
			if res := p.store.Paste(ids[0], plain, target, direct); res.Reason != "" {
				logx.Warn("[clip-panel] paste", "action", res.Action, "reason", res.Reason)
			}
			return
		}
		// Several items are pasted one after the other, as the Electron panel did.
		for i, id := range ids {
			res := p.store.Paste(id, plain, target, direct)
			if res.Reason != "" {
				logx.Warn("[clip-panel] paste", "index", i, "reason", res.Reason)
				return
			}
			time.Sleep(160 * time.Millisecond)
		}
	}()
}

func (p *ClipboardPanel) copy(items []clipboard.Item) {
	if len(items) == 0 {
		return
	}
	id := items[0].ID
	go p.store.Copy(id, false)
	p.Hide()
}

func (p *ClipboardPanel) remove(items []clipboard.Item) {
	if len(items) == 0 {
		return
	}
	ids := make([]string, len(items))
	gone := map[string]bool{}
	last := -1
	for i, it := range items {
		ids[i] = it.ID
		gone[it.ID] = true
		last = max(last, p.indexOf(it.ID))
	}
	// The card after the deleted ones takes the selection, or the one before.
	next := ""
	for _, it := range p.items[last+1:] {
		if !gone[it.ID] {
			next = it.ID
			break
		}
	}
	if next == "" {
		for i := last; i >= 0; i-- {
			if !gone[p.items[i].ID] {
				next = p.items[i].ID
				break
			}
		}
	}
	p.items = slices.DeleteFunc(p.items, func(it clipboard.Item) bool { return gone[it.ID] })
	if next != "" {
		p.selectOnly(next)
	} else {
		p.selected, p.active = map[string]bool{}, ""
	}
	logx.Info("[clip-panel] delete", "items", len(ids))
	go func() {
		token, err := p.store.Delete(ids)
		if err != nil {
			return
		}
		p.win.Update(func() {
			p.undo, p.undoAt = token, time.Now()
			p.showToast(clipToast{text: i18n.T("clip.panel.toast.deleted", "count", len(ids)),
				action: i18n.T("clip.panel.toast.undo"), undo: token}, clipUndoWindow)
		})
	}()
}

func (p *ClipboardPanel) undoDelete() {
	if p.undo == "" || time.Since(p.undoAt) > 30*time.Second {
		return
	}
	token := p.undo
	p.undo, p.toast = "", nil
	go p.store.Undo(token)
}

func (p *ClipboardPanel) open(it clipboard.Item) {
	switch it.Kind {
	case clipboard.KindLink:
		go mygo.Shell.OpenExternal(it.URL)
	case clipboard.KindFile:
		go func() {
			if d, err := p.store.Detail(it.ID); err == nil && len(d.FilePaths) > 0 {
				_ = mygo.Shell.OpenPath(d.FilePaths[0])
			}
		}()
	default:
		return
	}
	p.Hide()
}

func (p *ClipboardPanel) revealInFinder(it clipboard.Item) {
	if it.Kind != clipboard.KindFile {
		return
	}
	go func() {
		if d, err := p.store.Detail(it.ID); err == nil && len(d.FilePaths) > 0 {
			mygo.Shell.ShowItemInFolder(d.FilePaths[0])
		}
	}()
	p.Hide()
}

func (p *ClipboardPanel) startEdit(it clipboard.Item) {
	if !clipboard.CanEdit(it) {
		return
	}
	p.dialog = clipDialog{kind: "edit", item: it, loading: true, open: true}
	go func() {
		d, err := p.store.Detail(it.ID)
		p.win.Update(func() {
			if p.dialog.kind != "edit" || p.dialog.item.ID != it.ID {
				return
			}
			p.dialog.loading = false
			if err == nil {
				p.dialog.text = d.PlainText
			} else {
				p.dialog.text = it.Preview
			}
		})
	}()
}

func (p *ClipboardPanel) startRename(it clipboard.Item) {
	p.dialog = clipDialog{kind: "rename", item: it, text: it.CustomTitle, open: true}
}

func (p *ClipboardPanel) newPinboard(addTargets bool) {
	d := clipDialog{kind: "newPinboard", open: true,
		color: clipboard.PinboardColors[int(time.Now().UnixNano()/1000)%(len(clipboard.PinboardColors)-1)]}
	if addTargets {
		for _, it := range p.targets() {
			d.addTargets = append(d.addTargets, it.ID)
		}
	}
	p.dialog = d
}

func (p *ClipboardPanel) pinboardName(id string) string {
	for _, pb := range p.pins {
		if pb.ID == id {
			return pb.Name
		}
	}
	return ""
}

// togglePinboard adds the targets to the pinboard, or takes them out when all are in it.
func (p *ClipboardPanel) togglePinboard(pinboardID string) {
	items := p.targets()
	if len(items) == 0 {
		return
	}
	all := true
	ids := make([]string, len(items))
	for i, it := range items {
		ids[i] = it.ID
		all = all && slices.Contains(it.Pinboards, pinboardID)
	}
	name := p.pinboardName(pinboardID)
	go func() {
		var err error
		text := ""
		if all {
			err = p.store.RemoveFromPinboard(pinboardID, ids)
			text = i18n.T("clip.panel.toast.removedFromPinboard", "name", name)
		} else {
			err = p.store.AddToPinboard(pinboardID, ids)
			text = i18n.T("clip.panel.toast.addedToPinboard", "name", name)
		}
		if err == nil {
			p.win.Update(func() { p.showToast(clipToast{text: text}, 0) })
		}
	}()
}

func (p *ClipboardPanel) selectScope(id string) {
	p.scope = id
	p.reload()
	p.input.Focus()
}

func (p *ClipboardPanel) switchScope(dir int) {
	ids := []string{""}
	for _, pb := range p.pins {
		ids = append(ids, pb.ID)
	}
	cur := max(0, slices.Index(ids, p.scope))
	p.selectScope(ids[(cur+dir+len(ids))%len(ids)])
}

func (p *ClipboardPanel) paused() (bool, string) {
	until := clipboard.CurrentSettings().PausedUntil
	switch {
	case until == -1:
		return true, i18n.T("clip.panel.pause.pausedForever")
	case until > time.Now().UnixMilli():
		return true, i18n.T("clip.panel.pause.pausedUntil", "time", time.UnixMilli(until).Format("15:04"))
	}
	return false, ""
}

func (p *ClipboardPanel) setPaused(choice string) {
	var until int64
	switch choice {
	case "15m":
		until = time.Now().Add(15 * time.Minute).UnixMilli()
	case "1h":
		until = time.Now().Add(time.Hour).UnixMilli()
	case "forever":
		until = -1
	}
	go func() {
		if _, err := settings.Capabilities.Update(map[string]any{"clipboard": map[string]any{"pausedUntil": until}}); err != nil {
			logx.Warn("[clip-panel] pause failed", "err", err)
		}
		p.win.Update(func() {})
	}()
}

func (p *ClipboardPanel) togglePaused() {
	if on, _ := p.paused(); on {
		p.setPaused("resume")
	} else {
		p.setPaused("forever")
	}
}

func (p *ClipboardPanel) clearQuery() {
	p.query, p.kind, p.date, p.appIDs = "", "", "", nil
	p.reload()
}

func (p *ClipboardPanel) loadDetail() {
	id := p.active
	p.detailID, p.detail = id, nil
	if id == "" {
		return
	}
	go func() {
		d, _ := p.store.Detail(id)
		p.win.Update(func() {
			if p.detailID == id {
				p.detail = d
			}
		})
	}()
}

func (p *ClipboardPanel) toggleQuickLook() {
	p.quickLook, p.qlSeen = !p.quickLook, false
	if p.quickLook {
		p.richView = 0
		p.loadDetail()
	}
}

// quickPaste pastes the n-th card from the first one fully on screen (⌘1–9).
func (p *ClipboardPanel) quickPaste(n int, plain bool) {
	first := 0
	for i, it := range p.items {
		if r, ok := p.cardRects[it.ID]; ok && r.X >= 0 {
			first = i
			break
		}
	}
	if i := first + n - 1; i < len(p.items) {
		p.paste([]clipboard.Item{p.items[i]}, plain)
	}
}

// ---- keyboard ----

// key handles a key the panel uses; inInput is whether it comes from the search field, which keeps the keys
// that edit its text while it has any.
func (p *ClipboardPanel) key(k ui.Key, mods ui.Modifiers, text string) bool {
	if p.dialog.open {
		return false
	}
	handled := p.handleKey(k, mods, text)
	if handled {
		logx.Info("[clip-panel] key", "key", int(k), "mods", int(mods), "selected", len(p.selected), "quickLook", p.quickLook, "dialog", p.dialog.kind)
	}
	return handled
}

func (p *ClipboardPanel) handleKey(k ui.Key, mods ui.Modifiers, text string) bool {
	empty := text == ""
	cmd := mods&ui.Cmd != 0
	shift := mods&ui.Shift != 0
	if cmd && mods&(ui.Ctrl|ui.Alt) == 0 {
		if k >= ui.Key1 && k <= ui.Key9 {
			p.quickPaste(int(k-ui.Key1)+1, shift)
			return true
		}
		switch k {
		case ui.KeyF:
			p.filterRow = !p.filterRow
		case ui.KeyA:
			if !empty {
				return false
			}
			p.selectAll()
		case ui.KeyC:
			if !empty {
				return false
			}
			p.copy(p.targets())
		case ui.KeyO:
			if t := p.targets(); len(t) > 0 {
				p.open(t[0])
			}
		case ui.KeyR:
			if t := p.targets(); len(t) > 0 {
				p.startRename(t[0])
			}
		case ui.KeyE:
			if t := p.targets(); len(t) > 0 {
				p.startEdit(t[0])
			}
		case ui.KeyN:
			if shift {
				p.newPinboard(false)
			} else {
				p.dialog = clipDialog{kind: "newText", open: true}
			}
		case ui.KeyZ:
			if shift || p.undo == "" || !empty {
				return false
			}
			p.undoDelete()
		case ui.KeyT:
			p.togglePaused()
		case ui.KeyComma:
			p.app.ShowSettings("clipboard")
			p.Hide()
		case ui.KeyUp:
			p.move("first", false)
		case ui.KeyDown:
			p.move("last", false)
		case ui.KeyLeft:
			p.switchScope(-1)
		case ui.KeyRight:
			p.switchScope(1)
		case ui.KeyBackspace:
			if !empty {
				return false
			}
			p.remove(p.targets())
		default:
			return false
		}
		return true
	}
	if mods&(ui.Cmd|ui.Ctrl|ui.Alt) != 0 {
		return false
	}
	switch k {
	case ui.KeyEscape:
		switch {
		case p.quickLook:
			p.quickLook = false
		case p.query != "" || p.kind != "" || p.date != "" || len(p.appIDs) > 0:
			p.clearQuery()
		default:
			go p.Hide()
		}
	case ui.KeyLeft, ui.KeyRight:
		if !empty {
			return false
		}
		dir := "next"
		if k == ui.KeyLeft {
			dir = "prev"
		}
		p.move(dir, shift)
	case ui.KeyEnter:
		p.paste(p.targets(), shift)
	case ui.KeySpace:
		if !empty {
			return false
		}
		p.toggleQuickLook()
	case ui.KeyBackspace, ui.KeyDelete:
		if !empty {
			return false
		}
		p.remove(p.targets())
	default:
		return false
	}
	return true
}

var clipKeys = []ui.Key{ui.Key1, ui.Key2, ui.Key3, ui.Key4, ui.Key5, ui.Key6, ui.Key7, ui.Key8, ui.Key9, ui.KeyF,
	ui.KeyA, ui.KeyC, ui.KeyO, ui.KeyR, ui.KeyE, ui.KeyN, ui.KeyZ, ui.KeyT, ui.KeyComma, ui.KeyUp, ui.KeyDown,
	ui.KeyLeft, ui.KeyRight, ui.KeyBackspace, ui.KeyDelete, ui.KeyEscape, ui.KeyEnter, ui.KeySpace}

// shortcuts handles the panel's keys while the search field does not have the focus.
func (p *ClipboardPanel) shortcuts(c *ui.Context) {
	if p.input.FocusWithin(c) || p.dialog.open {
		return
	}
	for _, k := range clipKeys {
		for _, mods := range []ui.Modifiers{0, ui.Shift, ui.Cmd, ui.Cmd | ui.Shift} {
			if c.Shortcut(mods, k) {
				p.key(k, mods, "")
			}
		}
	}
}

// ---- view ----

func (p *ClipboardPanel) view(c *ui.Context) {
	// The panel has an appearance of its own (Settings → Clipboard), dark by default.
	switch p.appearance {
	case "dark":
		c.SetTheme(ui.DarkTheme())
	case "light":
		c.SetTheme(ui.LightTheme())
	}
	t := Look(c)
	Panel(c)
	p.shortcuts(c)
	strip := Surface(t)
	ui.Column(c).Fill().Background(strip).Border(0.5, ui.RGBA(0, 0, 0, 0.16).Mix(ui.RGBA(255, 255, 255, 0.16), b2f(t.Dark))).Children(func() {
		p.topBar(c)
		if p.filterRow {
			p.filterRowView(c)
		}
		p.strip(c)
	})
	p.toastView(c)
	if p.quickLook {
		p.quickLookView(c)
	}
	p.dialogs(c)
}

func b2f(b bool) float32 {
	if b {
		return 1
	}
	return 0
}
