package native

import (
	"encoding/json"
	"errors"
	"os/exec"
	"unsafe"
)

// Rect is a rectangle in the coordinates the library uses (AX: global top-left; Cocoa: bottom-left).
type Rect struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// Point is a point in Cocoa screen coordinates (origin at the bottom-left of the primary display).
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// SelectionSnapshot is what the accessibility API reports about the current selection.
type SelectionSnapshot struct {
	Text                   string `json:"text"`
	SourceApp              string `json:"sourceApp"`
	SourceBundleID         string `json:"sourceBundleId"`
	SourceAppPid           int    `json:"sourceAppPid"`
	Scene                  string `json:"scene"`
	HasRect                bool   `json:"hasRect"`
	Rect                   *Rect  `json:"rect,omitempty"`
	Strategy               string `json:"strategy"`
	TargetDebug            string `json:"targetDebug"`
	NeedsClipboardFallback bool   `json:"needsClipboardFallback,omitempty"`
	FallbackAppPid         int    `json:"fallbackAppPid,omitempty"`
	Error                  string `json:"error,omitempty"`
}

// FrontmostApp describes the active application.
type FrontmostApp struct {
	BundleID string `json:"bundleId"`
	Name     string `json:"name"`
	Pid      int    `json:"pid"`
	Path     string `json:"path"`
}

// CheckPermission reports whether popMind has the accessibility permission; prompt asks for it.
func CheckPermission(prompt bool) bool {
	if !loaded {
		return false
	}
	return fns.checkPermission(b2i(prompt)) != 0
}

// OpenAccessibilitySettings opens System Settings at the accessibility list.
func OpenAccessibilitySettings() {
	if loaded {
		fns.openAccessibility()
	}
}

// GetSelectionSnapshot reads the selection at the last gesture point.
func GetSelectionSnapshot(scene string) (SelectionSnapshot, error) {
	var s SelectionSnapshot
	if !loaded {
		return s, ErrNotLoaded
	}
	err := takeJSON(fns.getSelectionSnapshot(scene), &s)
	return s, err
}

// GetTextByClipboard copies the selection of the app with pid (⌘C, or its Copy menu item with useMenu) and
// reads it back, restoring the clipboard. Blocking; call off the main thread.
func GetTextByClipboard(useMenu bool, pid int) string {
	if !loaded {
		return ""
	}
	return takeString(fns.getTextByClipboard(b2i(useMenu), int32(pid)))
}

// CopySelection copies the selection of the app with pid to the clipboard.
func CopySelection(useMenu bool, pid int, expected string) bool {
	if !loaded {
		return false
	}
	return fns.copySelection(b2i(useMenu), int32(pid), expected) != 0
}

// CaptureFrontmostWindowPNG captures the front window of the app with pid (needs screen recording).
func CaptureFrontmostWindowPNG(pid int) ([]byte, error) {
	if !loaded {
		return nil, ErrNotLoaded
	}
	var out struct {
		PNG []byte `json:"png"`
	}
	if err := takeJSON(fns.captureFrontmostWindow(int32(pid)), &out); err != nil {
		return nil, err
	}
	return out.PNG, nil
}

// RecognizeText runs Vision OCR on the image at path.
func RecognizeText(path string, languages []string, fast bool) (string, error) {
	if !loaded {
		return "", ErrNotLoaded
	}
	opts, _ := json.Marshal(map[string]any{"languages": languages, "fast": fast})
	var out struct {
		Text  string `json:"text"`
		Error string `json:"error"`
	}
	if err := takeJSON(fns.recognizeText(path, string(opts)), &out); err != nil {
		return "", err
	}
	if out.Error != "" {
		return "", errors.New(out.Error)
	}
	return out.Text, nil
}

// StartActionMonitor installs the global mouse monitors that report selection gestures (EventAction).
func StartActionMonitor() bool { return loaded && fns.startActionMonitor() != 0 }

// StopActionMonitor removes them.
func StopActionMonitor() {
	if loaded {
		fns.stopActionMonitor()
	}
}

// SetKeyMonitorEnabled turns the key-press dismiss monitor on or off.
func SetKeyMonitorEnabled(enabled bool) bool {
	return loaded && fns.setKeyMonitorEnabled(b2i(enabled)) != 0
}

// CursorPosition returns the pointer in Cocoa coordinates.
func CursorPosition() Point {
	var p Point
	if loaded {
		_ = takeJSON(fns.getCursorPosition(), &p)
	}
	return p
}

// Frontmost returns the active application.
func Frontmost() FrontmostApp {
	var app FrontmostApp
	app.Pid = -1
	if loaded {
		_ = takeJSON(fns.getFrontmostApp(), &app)
	}
	return app
}

// AppWindowsBounds lists the on-screen windows of pid, front to back, in global top-left coordinates.
func AppWindowsBounds(pid int) []Rect {
	var list []Rect
	if loaded {
		_ = takeJSON(fns.getAppWindowsBounds(int32(pid)), &list)
	}
	return list
}

// ClipboardChangeCount is NSPasteboard.generalPasteboard.changeCount, or -1.
func ClipboardChangeCount() int64 {
	if !loaded {
		return -1
	}
	return fns.clipboardChangeCount()
}

// IsClipboardFallbackActive reports whether a selection read through the clipboard is in progress.
func IsClipboardFallbackActive() bool { return loaded && fns.isClipboardFallback() != 0 }

// ActivateAppAndPaste activates pid and sends ⌘V. Blocking; call off the main thread.
func ActivateAppAndPaste(pid int) bool { return loaded && fns.activateAppAndPaste(int32(pid)) != 0 }

// ActivateApp brings pid to the front.
func ActivateApp(pid int) bool { return loaded && fns.activateApp(int32(pid)) != 0 }

// ConfigureBubbleWindow registers an NSWindow as a bubble surface at the given window level (0: pop-up menu).
func ConfigureBubbleWindow(window uintptr, level int) bool {
	return loaded && window != 0 && fns.configureBubbleWindow(window, int32(level)) != 0
}

// RefreshBubbleWindow re-registers the window number of a bubble surface.
func RefreshBubbleWindow(window uintptr) {
	if loaded && window != 0 {
		fns.refreshBubbleWindow(window)
	}
}

// OrderWindowFront orders an NSWindow front without activating the app.
func OrderWindowFront(window uintptr) bool {
	return loaded && window != 0 && fns.orderWindowFront(window) != 0
}

// PresentPanelWithoutActivation shows a panel above other apps and makes it key without activating popMind.
func PresentPanelWithoutActivation(window uintptr) bool {
	return loaded && window != 0 && fns.presentPanel(window) != 0
}

// SetWindowAppearance sets "dark", "light" or "" (inherit) on an NSWindow.
func SetWindowAppearance(window uintptr, mode string) bool {
	return loaded && window != 0 && fns.setWindowAppearance(window, mode) != 0
}

// SetVibrancyTopCornerRadius rounds the top corners of the window's vibrancy view.
func SetVibrancyTopCornerRadius(window uintptr, radius int) bool {
	return loaded && window != 0 && fns.setVibrancyTopRadius(window, int32(radius)) != 0
}

// ApplicationInfo is what an app bundle's Info.plist says about it.
type ApplicationInfo struct {
	Path            string            `json:"path"`
	BundleID        string            `json:"bundleId"`
	Name            string            `json:"name"`
	DisplayName     string            `json:"displayName"`
	FileDisplayName string            `json:"fileDisplayName"`
	Executable      string            `json:"executable"`
	LocalizedNames  map[string]string `json:"localizedNames"`
}

// ReadApplicationsInfo reads the bundles at paths, with their names in locales.
func ReadApplicationsInfo(paths, locales []string) ([]ApplicationInfo, error) {
	if !loaded {
		return nil, ErrNotLoaded
	}
	input, _ := json.Marshal(map[string]any{"paths": paths, "locales": locales})
	var out []ApplicationInfo
	err := takeJSON(fns.readApplicationsInfo(string(input)), &out)
	return out, err
}

// IconRequest asks for the Finder icon of AppPath as a PNG at OutputPath.
type IconRequest struct {
	AppPath    string `json:"appPath"`
	OutputPath string `json:"outputPath"`
}

// WriteApplicationIcons draws the icons of items at size pixels.
func WriteApplicationIcons(items []IconRequest, size int) []bool {
	if !loaded {
		return make([]bool, len(items))
	}
	input, _ := json.Marshal(map[string]any{"items": items, "size": size})
	var out []bool
	if err := takeJSON(fns.writeApplicationIcons(string(input)), &out); err != nil {
		return make([]bool, len(items))
	}
	return out
}

// ConvertedImage is an image re-encoded as PNG.
type ConvertedImage struct {
	PNG    []byte `json:"png"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// ConvertImageToPNG decodes any ImageIO format (TIFF, HEIC…) and re-encodes it as PNG.
func ConvertImageToPNG(data []byte) (ConvertedImage, error) {
	var out ConvertedImage
	if !loaded {
		return out, ErrNotLoaded
	}
	if len(data) == 0 {
		return out, errors.New("empty image")
	}
	p := fns.convertImageToPNG(unsafe.Pointer(&data[0]), int64(len(data)))
	err := takeJSON(p, &out)
	return out, err
}

// PasteboardRepresentation is one type of one pasteboard item.
type PasteboardRepresentation struct {
	Type string `json:"type"`
	Data []byte `json:"data"`
}

// PasteboardItem is one NSPasteboardItem.
type PasteboardItem struct {
	Representations []PasteboardRepresentation `json:"representations"`
}

// PasteboardFlags are the nspasteboard.org markers on the pasteboard.
type PasteboardFlags struct {
	Concealed     bool `json:"concealed"`
	Transient     bool `json:"transient"`
	AutoGenerated bool `json:"autoGenerated"`
	Remote        bool `json:"remote"`
}

// PasteboardContent is what ReadPasteboard read.
type PasteboardContent struct {
	ChangeCount    int64            `json:"changeCount"`
	Items          []PasteboardItem `json:"items"`
	AllTypes       []string         `json:"allTypes"`
	Flags          PasteboardFlags  `json:"flags"`
	PopMindMarker  *string          `json:"popMindMarker,omitempty"`
	SourceBundleID string           `json:"sourceBundleId,omitempty"`
	TooLarge       bool             `json:"tooLarge"`
	TotalBytes     float64          `json:"totalBytes"`
}

// PasteboardReadOptions limits what ReadPasteboard loads.
type PasteboardReadOptions struct {
	AllowTypes    []string `json:"allowTypes"`
	MaxBytes      float64  `json:"maxBytes"`
	MaxImageBytes float64  `json:"maxImageBytes,omitempty"`
}

// ReadPasteboard reads the allowed types of the general pasteboard.
func ReadPasteboard(opts PasteboardReadOptions) (PasteboardContent, error) {
	var out PasteboardContent
	if !loaded {
		return out, ErrNotLoaded
	}
	input, _ := json.Marshal(opts)
	err := takeJSON(fns.readPasteboard(string(input)), &out)
	return out, err
}

// WritePasteboard replaces the general pasteboard with items, marking them as popMind's own write.
func WritePasteboard(items []PasteboardItem, marker string) bool {
	if !loaded {
		return false
	}
	input, _ := json.Marshal(items)
	return fns.writePasteboard(string(input), marker) != 0
}

// PasteResult is the outcome of PostPasteKeystroke.
type PasteResult struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason,omitempty"`
}

// PostPasteKeystroke sends ⌘V to the frontmost app.
func PostPasteKeystroke() PasteResult {
	var out PasteResult
	if !loaded {
		return PasteResult{Reason: "not_loaded"}
	}
	_ = takeJSON(fns.postPasteKeystroke(), &out)
	return out
}

// IsSecureInputEnabled reports whether a password field has secure input on.
func IsSecureInputEnabled() bool { return loaded && fns.isSecureInputEnabled() != 0 }

// StartPasteMonitor reports physical ⌘V presses (EventUserPaste).
func StartPasteMonitor() bool { return loaded && fns.startPasteMonitor() != 0 }

// StopPasteMonitor stops it.
func StopPasteMonitor() {
	if loaded {
		fns.stopPasteMonitor()
	}
}

// ResolveAppPathByBundleID returns the path of the app with bundleID, or "".
func ResolveAppPathByBundleID(bundleID string) string {
	if !loaded {
		return ""
	}
	return takeString(fns.resolveAppPathByBundleID(bundleID))
}

// SetWindowCornerRadius rounds a borderless window: its content, its vibrancy and its shadow.
func SetWindowCornerRadius(window uintptr, radius int) bool {
	return loaded && window != 0 && fns.setWindowCornerRadius(window, int32(radius)) != 0
}

// RegisterSurfaceWindow marks an NSWindow as popMind's own: keys and clicks in it do not dismiss the bubble.
func RegisterSurfaceWindow(window uintptr) {
	if loaded && window != 0 {
		fns.registerSurface(window)
	}
}

// ScreenCaptureAccess reports whether popMind may capture windows (Screen Recording); prompt asks for it.
func ScreenCaptureAccess(prompt bool) bool {
	return loaded && fns.screenCaptureAccess(b2i(prompt)) != 0
}

// OpenScreenRecordingSettings opens System Settings at Privacy & Security → Screen Recording.
func OpenScreenRecordingSettings() {
	_ = exec.Command("open", "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture").Start()
}

// PrepareWindowIn makes a hidden window transparent before it is shown, for AnimateWindowIn.
func PrepareWindowIn(window uintptr) {
	if loaded && window != 0 {
		fns.prepareWindowIn(window)
	}
}

// AnimateWindowIn fades a window in over ms, sliding it up from dy points below when dy > 0.
func AnimateWindowIn(window uintptr, ms, dy int) {
	if loaded && window != 0 {
		fns.animateWindowIn(window, int32(ms), int32(dy))
	}
}
