package native

import (
	"golang.org/x/sys/windows"

	"popmind/internal/logx"
)

// On Windows popMind calls the system directly: user32 for the pointer, windows and keystrokes, kernel32
// for processes. Nothing is loaded from disk; Load starts the event dispatch.

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procGetCursorPos               = user32.NewProc("GetCursorPos")
	procGetForegroundWindow        = user32.NewProc("GetForegroundWindow")
	procGetWindowThreadProcessId   = user32.NewProc("GetWindowThreadProcessId")
	procGetClipboardSequenceNumber = user32.NewProc("GetClipboardSequenceNumber")
	procSetForegroundWindow        = user32.NewProc("SetForegroundWindow")
	procShowWindow                 = user32.NewProc("ShowWindow")
	procIsIconic                   = user32.NewProc("IsIconic")
	procIsWindowVisible            = user32.NewProc("IsWindowVisible")
	procEnumWindows                = user32.NewProc("EnumWindows")
	procGetWindowRect              = user32.NewProc("GetWindowRect")
	procSendInput                  = user32.NewProc("SendInput")
	procGetDpiForWindow            = user32.NewProc("GetDpiForWindow")
	procQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
	procAllowSetForegroundWindow   = user32.NewProc("AllowSetForegroundWindow")
	procGetWindowTextW             = user32.NewProc("GetWindowTextW")
	procGetAncestor                = user32.NewProc("GetAncestor")
	procGetLastActivePopup         = user32.NewProc("GetLastActivePopup")
	procGetWindowLongPtrW          = user32.NewProc("GetWindowLongPtrW")
	procSetWindowPos               = user32.NewProc("SetWindowPos")
	procGetSystemMetrics           = user32.NewProc("GetSystemMetrics")
	procGetDesktopWindow           = user32.NewProc("GetDesktopWindow")
	procGetShellWindow             = user32.NewProc("GetShellWindow")
	procGetCurrentProcessId        = kernel32.NewProc("GetCurrentProcessId")
)

// Load prepares the Windows side; dirs are not used (there is no library to find).
func Load(dirs ...string) error {
	if loaded {
		return nil
	}
	go dispatchEvents()
	loaded = true
	logx.Info("[native] windows ready")
	return nil
}

// emit hands an event to the subscribers, as the macOS library's callback does.
func emit(kind int64, payload []byte) {
	select {
	case events <- Event{Kind: kind, JSON: payload}:
	default:
		logx.Warn("[native] event queue full, dropped", "kind", kind)
	}
}

var _ = emit
