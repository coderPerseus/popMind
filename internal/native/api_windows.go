package native

import (
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The Windows side of the native functions. Windows has no Accessibility permission to ask for: the
// selection, the clipboard and synthetic keystrokes are open to every desktop app.

// CheckPermission: Windows asks for no permission to read selections or send keystrokes.
func CheckPermission(prompt bool) bool { return true }

// OpenAccessibilitySettings has nothing to open on Windows.
func OpenAccessibilitySettings() {}

// ScreenCaptureAccess: Windows lets desktop apps capture windows without asking.
func ScreenCaptureAccess(prompt bool) bool { return true }

// OpenScreenRecordingSettings has nothing to open on Windows.
func OpenScreenRecordingSettings() {}

func windowPID(hwnd uintptr) int {
	var pid uint32
	procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	return int(pid)
}

// processPath is the executable of pid.
func processPath(pid int) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, windows.MAX_LONG_PATH)
	n := uint32(len(buf))
	if r, _, _ := procQueryFullProcessImageNameW.Call(uintptr(h), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n))); r == 0 {
		return ""
	}
	return windows.UTF16ToString(buf[:n])
}

// Frontmost is the app of the foreground window. Its "bundle ID" on Windows is the executable's path, the
// one stable name an app has, which the blocked-apps list and the clipboard's sources keep.
func Frontmost() FrontmostApp {
	hwnd, _, _ := procGetForegroundWindow.Call()
	if hwnd == 0 {
		return FrontmostApp{}
	}
	pid := windowPID(hwnd)
	path := processPath(pid)
	name := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	return FrontmostApp{BundleID: strings.ToLower(path), Name: name, Pid: pid, Path: path}
}

// topWindows lists the visible top-level windows of pid, front to back.
func topWindows(pid int) []uintptr {
	var out []uintptr
	cb := syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
		if v, _, _ := procIsWindowVisible.Call(hwnd); v != 0 && windowPID(hwnd) == pid {
			out = append(out, hwnd)
		}
		return 1
	})
	procEnumWindows.Call(cb, 0)
	return out
}

// AppWindowsBounds are the frames of pid's visible windows, in screen pixels.
func AppWindowsBounds(pid int) []Rect {
	var out []Rect
	for _, hwnd := range topWindows(pid) {
		var r winRect
		if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r))); ok != 0 {
			out = append(out, Rect{X: float64(r.Left), Y: float64(r.Top), Width: float64(r.Right - r.Left), Height: float64(r.Bottom - r.Top)})
		}
	}
	return out
}

// ClipboardChangeCount is the clipboard's sequence number, which changes with every copy.
func ClipboardChangeCount() int64 {
	n, _, _ := procGetClipboardSequenceNumber.Call()
	return int64(n)
}

// ActivateAppAndPaste brings pid forward and pastes into it.
func ActivateAppAndPaste(pid int) bool {
	if !ActivateApp(pid) {
		return false
	}
	time.Sleep(80 * time.Millisecond)
	return PostPasteKeystroke().OK
}

// ReadApplicationsInfo: myGo's InstalledApps (the Start menu's apps) names them on Windows; there are no
// Info.plist names to add.
func ReadApplicationsInfo(paths, locales []string) ([]ApplicationInfo, error) { return nil, nil }

// WriteApplicationIcons: the launcher takes myGo's FileIcon on Windows.
func WriteApplicationIcons(items []IconRequest, size int) []bool { return make([]bool, len(items)) }

const (
	inputKeyboard = 1
	keyUp         = 0x0002
	vkControl     = 0x11
	vkV           = 0x56
)

// PostPasteKeystroke presses Ctrl+V.
func PostPasteKeystroke() PasteResult {
	if !sendCtrl(vkV) {
		return PasteResult{OK: false, Reason: "send-input failed"}
	}
	return PasteResult{OK: true}
}

// IsSecureInputEnabled: Windows has no system-wide secure input mode.
func IsSecureInputEnabled() bool { return false }

// ResolveAppPathByBundleID: on Windows the "bundle ID" is the executable's path.
func ResolveAppPathByBundleID(bundleID string) string { return bundleID }
