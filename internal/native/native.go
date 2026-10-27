// Package native loads libpopmind_native.dylib (native/popmind_native.mm) through purego: text selection,
// global mouse/keyboard monitors, pasteboard access, synthetic keystrokes, OCR and window tweaks that myGo
// does not cover. Results come back as JSON; events arrive through one callback created at load time.
package native

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"unsafe"

	"github.com/ebitengine/purego"

	"popmind/internal/logx"
)

// Event kinds sent by the library.
const (
	EventAction    = 1 // {"scene", "x", "y"}: a selection gesture or a dismiss trigger
	EventUserPaste = 2 // {"type": "user-paste", "timestamp"}: a physical ⌘V
)

// Event is one callback from the library.
type Event struct {
	Kind int64
	JSON []byte
}

var (
	loaded bool
	fns    struct {
		free                     func(uintptr)
		setEventCallback         func(uintptr)
		checkPermission          func(int32) int32
		getSelectionSnapshot     func(string) uintptr
		getTextByClipboard       func(int32, int32) uintptr
		copySelection            func(int32, int32, string) int32
		captureFrontmostWindow   func(int32) uintptr
		recognizeText            func(string, string) uintptr
		startActionMonitor       func() int32
		stopActionMonitor        func()
		setKeyMonitorEnabled     func(int32) int32
		getCursorPosition        func() uintptr
		getFrontmostApp          func() uintptr
		getAppWindowsBounds      func(int32) uintptr
		clipboardChangeCount     func() int64
		isClipboardFallback      func() int32
		activateAppAndPaste      func(int32) int32
		activateApp              func(int32) int32
		configureBubbleWindow    func(uintptr, int32) int32
		refreshBubbleWindow      func(uintptr)
		registerSurface          func(uintptr)
		screenCaptureAccess      func(int32) int32
		prepareWindowIn          func(uintptr)
		animateWindowIn          func(uintptr, int32, int32)
		orderWindowFront         func(uintptr) int32
		presentPanel             func(uintptr) int32
		setWindowAppearance      func(uintptr, string) int32
		setVibrancyTopRadius     func(uintptr, int32) int32
		setWindowCornerRadius    func(uintptr, int32) int32
		readApplicationsInfo     func(string) uintptr
		writeApplicationIcons    func(string) uintptr
		convertImageToPNG        func(unsafe.Pointer, int64) uintptr
		readPasteboard           func(string) uintptr
		writePasteboard          func(string, string) int32
		postPasteKeystroke       func() uintptr
		resolvePasteKeyCode      func() int32
		isSecureInputEnabled     func() int32
		startPasteMonitor        func() int32
		stopPasteMonitor         func()
		resolveAppPathByBundleID func(string) uintptr
		openAccessibility        func()
	}

	subMu       sync.Mutex
	subscribers = map[int64][]func(Event){}
	events      = make(chan Event, 256)
)

// ErrNotLoaded is returned when the library could not be loaded.
var ErrNotLoaded = errors.New("native library not loaded")

// Load opens the library from dirs (the first that has it). It is safe to call once.
func Load(dirs ...string) error {
	if runtime.GOOS != "darwin" {
		return ErrNotLoaded
	}
	var path string
	for _, dir := range dirs {
		for _, candidate := range []string{
			filepath.Join(dir, "libpopmind_native.dylib"),
			filepath.Join(dir, "darwin-"+runtime.GOARCH, "libpopmind_native.dylib"),
		} {
			if _, err := os.Stat(candidate); err == nil {
				path = candidate
				break
			}
		}
		if path != "" {
			break
		}
	}
	if path == "" {
		return fmt.Errorf("libpopmind_native.dylib not found in %v", dirs)
	}
	handle, err := purego.Dlopen(path, purego.RTLD_NOW|purego.RTLD_LOCAL)
	if err != nil {
		return fmt.Errorf("dlopen %s: %w", path, err)
	}
	reg := func(fptr any, name string) { purego.RegisterLibFunc(fptr, handle, name) }
	reg(&fns.free, "pm_free")
	reg(&fns.setEventCallback, "pm_set_event_callback")
	reg(&fns.checkPermission, "pm_check_permission")
	reg(&fns.getSelectionSnapshot, "pm_get_selection_snapshot")
	reg(&fns.getTextByClipboard, "pm_get_text_by_clipboard")
	reg(&fns.copySelection, "pm_copy_selection")
	reg(&fns.captureFrontmostWindow, "pm_capture_frontmost_window_png")
	reg(&fns.recognizeText, "pm_recognize_text")
	reg(&fns.startActionMonitor, "pm_start_action_monitor")
	reg(&fns.stopActionMonitor, "pm_stop_action_monitor")
	reg(&fns.setKeyMonitorEnabled, "pm_set_key_monitor_enabled")
	reg(&fns.getCursorPosition, "pm_get_cursor_position")
	reg(&fns.getFrontmostApp, "pm_get_frontmost_app")
	reg(&fns.getAppWindowsBounds, "pm_get_app_windows_bounds")
	reg(&fns.clipboardChangeCount, "pm_clipboard_change_count")
	reg(&fns.isClipboardFallback, "pm_is_clipboard_fallback_active")
	reg(&fns.activateAppAndPaste, "pm_activate_app_and_paste")
	reg(&fns.activateApp, "pm_activate_app")
	reg(&fns.configureBubbleWindow, "pm_configure_bubble_window")
	reg(&fns.refreshBubbleWindow, "pm_refresh_bubble_window")
	reg(&fns.registerSurface, "pm_register_surface_window")
	reg(&fns.screenCaptureAccess, "pm_screen_capture_access")
	reg(&fns.prepareWindowIn, "pm_prepare_window_in")
	reg(&fns.animateWindowIn, "pm_animate_window_in")
	reg(&fns.orderWindowFront, "pm_order_window_front")
	reg(&fns.presentPanel, "pm_present_panel_without_activation")
	reg(&fns.setWindowAppearance, "pm_set_window_appearance")
	reg(&fns.setVibrancyTopRadius, "pm_set_vibrancy_top_corner_radius")
	reg(&fns.setWindowCornerRadius, "pm_set_window_corner_radius")
	reg(&fns.readApplicationsInfo, "pm_read_applications_info")
	reg(&fns.writeApplicationIcons, "pm_write_application_icons")
	reg(&fns.convertImageToPNG, "pm_convert_image_to_png")
	reg(&fns.readPasteboard, "pm_read_pasteboard")
	reg(&fns.writePasteboard, "pm_write_pasteboard")
	reg(&fns.postPasteKeystroke, "pm_post_paste_keystroke")
	reg(&fns.resolvePasteKeyCode, "pm_resolve_paste_key_code")
	reg(&fns.isSecureInputEnabled, "pm_is_secure_input_enabled")
	reg(&fns.startPasteMonitor, "pm_start_paste_monitor")
	reg(&fns.stopPasteMonitor, "pm_stop_paste_monitor")
	reg(&fns.resolveAppPathByBundleID, "pm_resolve_app_path_by_bundle_id")
	reg(&fns.openAccessibility, "pm_open_accessibility_settings")

	// The only callback of the process (purego callbacks are never freed). It runs on the thread the library
	// calls from, usually the main thread inside an NSEvent monitor: copy the payload and hand it off.
	callback := purego.NewCallback(func(kind int64, payload uintptr) {
		data := []byte(goString(payload))
		select {
		case events <- Event{Kind: kind, JSON: data}:
		default:
			logx.Warn("[native] event queue full, dropped", "kind", kind)
		}
	})
	fns.setEventCallback(callback)
	go dispatchEvents()
	loaded = true
	logx.Info("[native] loaded", "path", path)
	return nil
}

// Loaded reports whether Load succeeded.
func Loaded() bool { return loaded }

func dispatchEvents() {
	for ev := range events {
		subMu.Lock()
		list := append([]func(Event){}, subscribers[ev.Kind]...)
		subMu.Unlock()
		for _, fn := range list {
			fn(ev)
		}
	}
}

// Subscribe calls fn, on a goroutine of its own (serially), for every event of kind.
func Subscribe(kind int64, fn func(Event)) {
	subMu.Lock()
	subscribers[kind] = append(subscribers[kind], fn)
	subMu.Unlock()
}

// goString copies a NUL-terminated C string.
func goString(p uintptr) string {
	if p == 0 {
		return ""
	}
	// p is C memory, which the Go collector never moves: reinterpret the integer as a pointer.
	ptr := *(*unsafe.Pointer)(unsafe.Pointer(&p))
	n := 0
	for *(*byte)(unsafe.Add(ptr, n)) != 0 {
		n++
	}
	return string(unsafe.Slice((*byte)(ptr), n))
}

// takeString copies and frees a string the library allocated.
func takeString(p uintptr) string {
	s := goString(p)
	if p != 0 {
		fns.free(p)
	}
	return s
}

func takeJSON(p uintptr, v any) error {
	s := takeString(p)
	if s == "" || s == "null" {
		return errors.New("empty result")
	}
	return json.Unmarshal([]byte(s), v)
}

func b2i(b bool) int32 {
	if b {
		return 1
	}
	return 0
}
