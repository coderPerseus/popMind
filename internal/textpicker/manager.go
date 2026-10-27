// Package textpicker turns the native mouse and keyboard events into selections: after a drag or a double
// click it reads the selected text (accessibility, then the clipboard), and asks the UI to show the bubble
// near it, or to go away on a click elsewhere, a key, a scroll or another app (text-picker-manager.ts).
package textpicker

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"

	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/settings"
)

// Scenes the native monitor reports.
const (
	SceneNone          = "none"
	SceneBoxSelect     = "box_select"
	SceneMultiClick    = "multi_click_select"
	SceneGesture       = "gesture_dismiss"
	SceneOtherClick    = "other_click_dismiss"
	SceneAppFocus      = "app_focus_dismiss"
	SceneKey           = "key_dismiss"
	SceneWindowFrame   = "window_frame_dismiss"
	checkDelay         = 32 * time.Millisecond
	retryDelay         = 50 * time.Millisecond
	maxRetries         = 1
	appActivateGuard   = 700 * time.Millisecond
	postDragIgnore     = 260 * time.Millisecond
	postShowGesture    = 300 * time.Millisecond
	postShowAppFocus   = 2500 * time.Millisecond
	postSelectNone     = 220 * time.Millisecond
	postSelectFrame    = 450 * time.Millisecond
	programmaticMoveMs = 80 * time.Millisecond
)

var dismissScenes = map[string]bool{SceneOtherClick: true, SceneWindowFrame: true, SceneGesture: true, SceneAppFocus: true, SceneKey: true}

// Point is a screen point in myGo's coordinates (top-left of the primary display).
type Point struct{ X, Y float64 }

// Anchor is where the selection is: its horizontal middle and its top and bottom.
type Anchor struct{ X, TopY, BottomY float64 }

// Picked is a resolved selection.
type Picked struct {
	Text        string
	AppName     string
	AppID       string
	AppPid      int
	Scene       string
	SelectionID string
	Strategy    string
	Anchor      Anchor
	// Cursor is where the pointer was as the selection resolved.
	Cursor Point
}

// UI is what the manager asks of the windows. Its methods are called from the manager's goroutines.
type UI interface {
	// ShowBubble shows the bubble for p.
	ShowBubble(p Picked)
	// HideBubble hides it.
	HideBubble()
	// BubbleVisible reports whether it shows.
	BubbleVisible() bool
	// InsideFloating reports whether pt is on the bubble or another floating surface (translation, chat).
	InsideFloating(pt Point) bool
	// FloatingVisible reports whether the bubble or another floating surface shows.
	FloatingVisible() bool
	// Dismiss asks the floating surfaces to go away (reason "dismiss-scene", "outside-pointer" or
	// "selection-changed"), at pt when the pointer caused it.
	Dismiss(reason string, pt *Point)
	// RunDefault runs command (translate, explain) instead of showing the bubble.
	RunDefault(command string, p Picked)
}

// Manager reads selections.
type Manager struct {
	ui UI

	mu                 sync.Mutex
	running            bool
	enabled            bool
	token              int
	timer              *time.Timer
	picked             *Picked
	dragging           bool
	ignorePointerUntil time.Time
	suppressUntil      time.Time
	ignoreGesture      time.Time
	ignoreAppFocus     time.Time
	ignorePointerNone  time.Time
	ignoreWindowFrame  time.Time
	ignoreBubbleMove   time.Time
	permissionPoll     *time.Ticker
}

// New makes a manager reporting to ui.
func New(ui UI) *Manager {
	m := &Manager{ui: ui, enabled: true}
	native.Subscribe(native.EventAction, func(ev native.Event) {
		var a struct {
			Scene string  `json:"scene"`
			X     float64 `json:"x"`
			Y     float64 `json:"y"`
		}
		if json.Unmarshal(ev.JSON, &a) == nil {
			m.onAction(a.Scene, cocoaToScreen(a.X, a.Y))
		}
	})
	return m
}

// cocoaToScreen converts AppKit's bottom-left coordinates to myGo's top-left ones.
func cocoaToScreen(x, y float64) Point {
	primary := mygo.Screen.PrimaryDisplay().Bounds
	return Point{X: x, Y: float64(primary.Y+primary.Height) - y}
}

// Start starts the native monitor, or polls until the accessibility permission is granted.
func (m *Manager) Start() bool {
	if !native.Loaded() {
		return false
	}
	if !native.CheckPermission(false) {
		logx.Warn("[textpicker] accessibility permission not granted, waiting")
		m.pollPermission()
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.running {
		return true
	}
	m.running = native.StartActionMonitor()
	logx.Info("[textpicker] monitor", "running", m.running)
	return m.running
}

func (m *Manager) pollPermission() {
	m.mu.Lock()
	if m.permissionPoll != nil {
		m.mu.Unlock()
		return
	}
	t := time.NewTicker(2500 * time.Millisecond)
	m.permissionPoll = t
	m.mu.Unlock()
	go func() {
		for range t.C {
			if native.CheckPermission(false) {
				t.Stop()
				m.mu.Lock()
				m.permissionPoll = nil
				m.mu.Unlock()
				logx.Info("[textpicker] accessibility permission granted")
				m.Start()
				return
			}
		}
	}()
}

// Running reports whether the monitor runs.
func (m *Manager) Running() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.running
}

// Stop stops the monitor.
func (m *Manager) Stop() {
	m.mu.Lock()
	m.running = false
	m.mu.Unlock()
	native.StopActionMonitor()
}

// SetEnabled turns the text picker on or off (the tray's switch).
func (m *Manager) SetEnabled(on bool) {
	m.mu.Lock()
	m.enabled = on
	m.mu.Unlock()
	if !on {
		m.ui.HideBubble()
	}
}

// Enabled reports whether it is on.
func (m *Manager) Enabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enabled
}

// Picked returns the current selection, or nil.
func (m *Manager) Picked() *Picked {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.picked == nil {
		return nil
	}
	p := *m.picked
	return &p
}

// SyncKeyMonitor turns the key-press dismiss monitor on while a floating surface shows.
func (m *Manager) SyncKeyMonitor() {
	if m.Running() {
		native.SetKeyMonitorEnabled(m.ui.FloatingVisible())
	}
}

// NoteInteraction keeps clicks in the floating surfaces from being taken for leaving the app.
func (m *Manager) NoteInteraction(d time.Duration) {
	if d <= 0 {
		d = appActivateGuard
	}
	m.mu.Lock()
	until := time.Now().Add(d)
	if until.After(m.suppressUntil) {
		m.suppressUntil = until
	}
	if until.After(m.ignoreAppFocus) {
		m.ignoreAppFocus = until
	}
	m.mu.Unlock()
}

// SetDragging locks out pointer events while a surface is dragged.
func (m *Manager) SetDragging(on bool) {
	m.NoteInteraction(0)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.dragging = on
	if !on {
		m.ignorePointerUntil = time.Now().Add(postDragIgnore)
	}
}

// NoteProgrammaticMove keeps the window moves the app makes from being taken for the user switching windows.
func (m *Manager) NoteProgrammaticMove() {
	m.mu.Lock()
	m.ignoreBubbleMove = time.Now().Add(programmaticMoveMs)
	m.mu.Unlock()
}

func (m *Manager) cancelPending(reason string) {
	if m.timer != nil {
		m.timer.Stop()
		m.timer = nil
	}
	m.token++
	if reason != "dismiss:"+SceneGesture {
		logx.Info("[textpicker] cancel pending check", "reason", reason, "token", m.token)
	}
}

func (m *Manager) onAction(scene string, pt Point) {
	if scene == "" {
		scene = SceneNone
	}
	now := time.Now()
	m.mu.Lock()
	enabled := m.enabled
	pointerLocked := m.dragging || now.Before(m.ignorePointerUntil)
	m.mu.Unlock()
	isDismiss := dismissScenes[scene]
	if scene != SceneGesture && scene != SceneNone {
		logx.Info("[textpicker] action", "scene", scene, "x", math.Round(pt.X), "y", math.Round(pt.Y), "pointerLocked", pointerLocked)
	}
	if !enabled || (pointerLocked && !isDismiss) {
		return
	}
	floatingVisible := m.ui.FloatingVisible()
	inside := floatingVisible && m.ui.InsideFloating(pt)

	m.mu.Lock()
	switch {
	case scene == SceneAppFocus && now.Before(m.ignoreAppFocus):
		m.mu.Unlock()
		logx.Info("[textpicker] ignore app-focus dismiss (guard)")
		return
	case scene == SceneAppFocus && (inside || now.Before(m.suppressUntil)):
		m.mu.Unlock()
		return
	case scene == SceneGesture && (now.Before(m.ignoreGesture) || inside):
		m.mu.Unlock()
		return
	case isDismiss && !floatingVisible && m.timer == nil:
		// Nothing shows and no check is pending: nothing to dismiss.
		m.mu.Unlock()
		return
	case scene == SceneKey && inside:
		// Typing while the pointer is over a popMind surface (the explain composer, the launcher field).
		m.mu.Unlock()
		return
	case scene == SceneWindowFrame && !floatingVisible:
		m.mu.Unlock()
		return
	case scene == SceneWindowFrame && now.Before(m.ignoreWindowFrame) && now.Before(m.ignoreBubbleMove):
		m.mu.Unlock()
		return
	}
	if isDismiss {
		m.cancelPending("dismiss:" + scene)
		m.mu.Unlock()
		m.NoteInteraction(0)
		logx.Info("[textpicker] dismiss-scene", "scene", scene, "floatingVisible", floatingVisible, "inside", inside)
		m.ui.Dismiss("dismiss-scene", &pt)
		return
	}
	m.mu.Unlock()

	if inside {
		return
	}
	if floatingVisible {
		m.NoteInteraction(0)
		logx.Info("[textpicker] outside-pointer dismiss", "x", math.Round(pt.X), "y", math.Round(pt.Y))
		m.ui.Dismiss("outside-pointer", &pt)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if scene == SceneNone {
		if now.Before(m.ignorePointerNone) {
			return
		}
		m.cancelPending("pointer:none")
		return
	}
	if scene != SceneBoxSelect && scene != SceneMultiClick {
		return
	}
	m.ignorePointerNone = now.Add(postSelectNone)
	m.ignoreWindowFrame = now.Add(postSelectFrame)
	m.token++
	token := m.token
	if m.timer != nil {
		m.timer.Stop()
	}
	m.timer = time.AfterFunc(checkDelay, func() { m.resolve(token, scene, 0) })
}

func (m *Manager) current(token int) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return token == m.token
}

func (m *Manager) resolve(token int, scene string, attempt int) {
	if !m.current(token) {
		return
	}
	snap, err := native.GetSelectionSnapshot(scene)
	if err != nil {
		logx.Warn("[textpicker] snapshot failed", "err", err)
		return
	}
	logx.Info("[textpicker] snapshot", "token", token, "scene", scene, "attempt", attempt, "chars", len([]rune(snap.Text)),
		"strategy", snap.Strategy, "hasRect", snap.HasRect, "fallback", snap.NeedsClipboardFallback, "app", snap.SourceApp,
		"bundle", snap.SourceBundleID, "target", snap.TargetDebug, "error", snap.Error)
	if !m.current(token) {
		return
	}
	text := strings.TrimSpace(snap.Text)
	if text == "" && snap.NeedsClipboardFallback && snap.FallbackAppPid > 0 {
		clip := strings.TrimSpace(native.GetTextByClipboard(true, snap.FallbackAppPid))
		logx.Info("[textpicker] clipboard fallback", "token", token, "chars", len([]rune(clip)))
		if !m.current(token) {
			return
		}
		if clip != "" {
			text, snap.Strategy = clip, "clipboard_copy"
		}
	}
	if text == "" {
		if attempt < maxRetries {
			time.AfterFunc(retryDelay, func() { m.resolve(token, scene, attempt+1) })
			return
		}
		m.mu.Lock()
		m.picked = nil
		m.mu.Unlock()
		logx.Info("[textpicker] no text after retries")
		m.ui.HideBubble()
		return
	}
	if snap.SourceBundleID != "" && settings.Blocked.Contains(snap.SourceBundleID) {
		logx.Info("[textpicker] blocked app", "bundle", snap.SourceBundleID)
		m.mu.Lock()
		m.picked = nil
		m.mu.Unlock()
		m.ui.HideBubble()
		return
	}
	cursor := mygo.Screen.CursorScreenPoint()
	cur := Point{float64(cursor.X), float64(cursor.Y)}
	p := Picked{Text: text, AppName: snap.SourceApp, AppID: snap.SourceBundleID, AppPid: snap.SourceAppPid, Scene: scene,
		SelectionID: newID(), Strategy: snap.Strategy, Anchor: resolveAnchor(snap, cur), Cursor: cur}
	now := time.Now()
	m.mu.Lock()
	if token != m.token {
		m.mu.Unlock()
		return
	}
	m.picked = &p
	m.ignoreGesture = now.Add(postShowGesture)
	m.ignoreAppFocus = now.Add(postShowAppFocus)
	m.ignoreWindowFrame = now.Add(postSelectFrame)
	m.mu.Unlock()
	logx.Info("[textpicker] selection resolved", "chars", len([]rune(text)), "strategy", p.Strategy, "app", p.AppName)

	m.ui.Dismiss("selection-changed", nil)
	if cmd := defaultCommand(text); cmd != "" {
		logx.Info("[textpicker] default action instead of the bubble", "command", cmd)
		m.ui.HideBubble()
		m.ui.RunDefault(cmd, p)
		return
	}
	m.NoteProgrammaticMove()
	m.ui.ShowBubble(p)
	m.SyncKeyMonitor()
}

// defaultCommand is the command the "default action" setting runs instead of the bubble.
func defaultCommand(text string) string {
	c := settings.Capabilities.Get()
	switch c.Selection.DefaultAction {
	case "translate":
		if NormalizeLink(text) == "" {
			return "translate"
		}
	case "explain":
		if NormalizeLink(text) == "" && c.AIService.ActiveProvider != nil &&
			strings.TrimSpace(c.AIService.Providers[*c.AIService.ActiveProvider].APIKey) != "" {
			return "explain"
		}
	}
	return ""
}

// resolveAnchor picks the selection's rectangle when it has one, in whichever of its two readings is nearer
// the pointer (some apps report flipped coordinates), else the pointer.
func resolveAnchor(s native.SelectionSnapshot, cursor Point) Anchor {
	fallback := Anchor{X: cursor.X, TopY: cursor.Y, BottomY: cursor.Y}
	r := s.Rect
	if !s.HasRect || r == nil || r.Width <= 0 || r.Height <= 0 {
		return fallback
	}
	d := mygo.Screen.DisplayNearestPoint(mygo.Point{X: int(cursor.X), Y: int(cursor.Y)})
	asIs := r.Y
	flipped := float64(d.Bounds.Y+d.Bounds.Height) - (r.Y + r.Height)
	top := asIs
	if math.Abs(flipped-cursor.Y) < math.Abs(asIs-cursor.Y) {
		top = flipped
	}
	return Anchor{X: r.X + r.Width/2, TopY: top, BottomY: top + r.Height}
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
