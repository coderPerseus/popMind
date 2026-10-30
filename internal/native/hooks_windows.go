package native

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"runtime"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"popmind/internal/logx"
)

// The global monitors on Windows, on a thread of their own with its message loop: raw input (mouse and
// keyboard, received by a message-only window even when other apps are in front) and a foreground-change
// event hook. They report what the macOS library reports (EventAction scenes, EventUserPaste), positions
// in myGo's screen coordinates (DIPs).
//
// Raw input, not low-level hooks (WH_MOUSE_LL): Windows silently removes a low-level hook whose procedure
// once takes longer than LowLevelHooksTimeout (at most 1 s since Windows 10 1709), which a Go callback can
// when the runtime pauses; the app is never told, and the bubble stops showing. Raw input has no timeout:
// Windows queues it to the window as messages. Microsoft recommends it over low-level hooks.

var (
	procGetMessageW             = user32.NewProc("GetMessageW")
	procTranslateMessage        = user32.NewProc("TranslateMessage")
	procDispatchMessageW        = user32.NewProc("DispatchMessageW")
	procPostThreadMessageW      = user32.NewProc("PostThreadMessageW")
	procRegisterClassExW        = user32.NewProc("RegisterClassExW")
	procCreateWindowExW         = user32.NewProc("CreateWindowExW")
	procDestroyWindow           = user32.NewProc("DestroyWindow")
	procDefWindowProcW          = user32.NewProc("DefWindowProcW")
	procRegisterRawInputDevices = user32.NewProc("RegisterRawInputDevices")
	procGetRawInputData         = user32.NewProc("GetRawInputData")
	procSetWinEventHook         = user32.NewProc("SetWinEventHook")
	procUnhookWinEvent          = user32.NewProc("UnhookWinEvent")
	procWindowFromPoint         = user32.NewProc("WindowFromPoint")
	procGetDoubleClickTime      = user32.NewProc("GetDoubleClickTime")
	procMonitorFromPoint        = user32.NewProc("MonitorFromPoint")
	procGetCurrentThreadId      = kernel32.NewProc("GetCurrentThreadId")
	procGetModuleHandleW        = kernel32.NewProc("GetModuleHandleW")
	procSendMessageTimeoutW     = user32.NewProc("SendMessageTimeoutW")
	procGetAsyncKeyState        = user32.NewProc("GetAsyncKeyState")
	shcore                      = syscallLazy("shcore.dll")
	procGetDpiForMonitor        = shcore.NewProc("GetDpiForMonitor")
)

const (
	wmQuit                = 0x0012
	wmInput               = 0x00FF
	ridInput              = 0x10000003
	rimTypeMouse          = 0
	rimTypeKeyboard       = 1
	ridevInputSink        = 0x00000100
	hwndMessage           = ^uintptr(2) // (HWND)-3
	riMouseLeftDown       = 0x0001
	riMouseLeftUp         = 0x0002
	riMouseRightDown      = 0x0004
	riMouseMiddleDown     = 0x0010
	riMouseWheel          = 0x0400
	riMouseHWheel         = 0x0800
	riKeyBreak            = 0x0001 // the key went up
	eventSystemForeground = 0x0003
	winEventOutOfContext  = 0x0000
	monitorDefaultNearest = 2
	vkLControl            = 0xA2
	vkRControl            = 0xA3
	vkShift               = 0x10
	vkMenu                = 0x12
	vkLWin                = 0x5B
	vkRWin                = 0x5C
	vkCapital             = 0x14
	vkLShift              = 0xA0
	vkRShift              = 0xA1
	vkLMenu               = 0xA4
	vkRMenu               = 0xA5
	dragThreshold         = 6 // pixels the pointer moves before a press is a drag
	wmNCHitTest           = 0x0084
	htCaption             = 2
	htSysMenu             = 3
	htMinButton           = 8
	htMaxButton           = 9
	htLeft                = 10
	htRight               = 11
	htTop                 = 12
	htTopLeft             = 13
	htTopRight            = 14
	htBottom              = 15
	htBottomLeft          = 16
	htBottomRight         = 17
	htClose               = 20
	smtoAbortIfHung       = 0x0002
	rawHeaderSize         = 24 // RAWINPUTHEADER on 64-bit: type, size, device, wParam
)

type winMsg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      winPoint
	_       uint32
}

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}

type rawInputDevice struct {
	UsagePage uint16
	Usage     uint16
	Flags     uint32
	Target    uintptr
}

// input is one raw event, handed from the window procedure to the worker that reads gestures.
type input struct {
	mouse    bool
	buttons  uint16 // RI_MOUSE_* flags
	vk       uint16
	up       bool
	injected bool // SendInput and its kind come with no device
	at       winPoint
}

// hooks is the state of the monitors.
var hooks struct {
	mu        sync.Mutex
	threadID  uintptr
	running   bool
	actions   bool // selection gestures and dismiss scenes
	keys      bool // key presses dismiss the floating surfaces
	pastes    bool // the user's Ctrl+V
	window    uintptr
	eventHook uintptr
	downAt    winPoint
	lastUpAt  winPoint
	lastUp    time.Time
	clicks    int
	downIn    chan bool // whether the press was in a window's content (not its title bar or frame)
	selfPID   int

	procsOK   bool
	wndProc   uintptr
	eventProc uintptr
	inputs    chan input
	// acceptInjected takes synthetic input as the user's (POPMIND_ACCEPT_INJECTED=1, for automated tests);
	// otherwise only real input is a selection gesture.
	acceptInjected bool
	debug          bool // POPMIND_HOOK_DEBUG=1 logs every press and what it was taken for
}

func syscallLazy(name string) *lazyDLL { return &lazyDLL{dll: syscall.NewLazyDLL(name)} }

type lazyDLL struct{ dll *syscall.LazyDLL }

func (d *lazyDLL) NewProc(name string) *syscall.LazyProc { return d.dll.NewProc(name) }

// toDIP turns a point in physical pixels into myGo's coordinates, by the DPI of the display it is on, as
// myGo does for its own cursor point.
func toDIP(p winPoint) (float64, float64) {
	dpi := 96
	mon, _, _ := procMonitorFromPoint.Call(uintptr(*(*uint64)(unsafe.Pointer(&p))), monitorDefaultNearest)
	if mon != 0 && procGetDpiForMonitor.Find() == nil {
		var dx, dy uint32
		if r, _, _ := procGetDpiForMonitor.Call(mon, 0, uintptr(unsafe.Pointer(&dx)), uintptr(unsafe.Pointer(&dy))); r == 0 && dx > 0 {
			dpi = int(dx)
		}
	}
	conv := func(v int32) float64 { return float64((int(v)*96 + dpi/2) / dpi) }
	return conv(p.X), conv(p.Y)
}

func emitAction(scene string, p winPoint) {
	x, y := toDIP(p)
	data, _ := json.Marshal(map[string]any{"scene": scene, "x": x, "y": y})
	emit(EventAction, data)
}

func cursorPoint() winPoint {
	var p winPoint
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&p)))
	return p
}

// inClientArea asks the window under p whether p is in its content. Only a title bar or a frame says
// no: other answers (a child control, a transparent area) count as content.
func inClientArea(p winPoint) bool {
	hwnd, _, _ := procWindowFromPoint.Call(uintptr(*(*uint64)(unsafe.Pointer(&p))))
	if hwnd == 0 {
		return false
	}
	lparam := uintptr(uint32(uint16(p.X)) | uint32(uint16(p.Y))<<16)
	var result uintptr
	if r, _, _ := procSendMessageTimeoutW.Call(hwnd, wmNCHitTest, 0, lparam, smtoAbortIfHung, 100, uintptr(unsafe.Pointer(&result))); r == 0 {
		return true
	}
	if hooks.debug {
		logx.Info("[native] hit test", "result", int32(result))
	}
	switch int32(result) {
	case htCaption, htLeft, htRight, htTop, htTopLeft, htTopRight, htBottom, htBottomLeft, htBottomRight, htSysMenu, htMinButton, htMaxButton, htClose:
		return false
	}
	return true
}

// ownWindowAt reports whether the window under p is popMind's (its own selections raise no bubble).
func ownWindowAt(p winPoint) bool {
	hwnd, _, _ := procWindowFromPoint.Call(uintptr(*(*uint64)(unsafe.Pointer(&p))))
	return hwnd != 0 && windowPID(hwnd) == hooks.selfPID
}

// wndProc receives the raw input. It only reads the event and queues it: the work happens on the worker.
func wndProc(hwnd, msg, wParam, lParam uintptr) uintptr {
	if msg == wmInput {
		var buf [64]byte
		size := uint32(len(buf))
		if n, _, _ := procGetRawInputData.Call(lParam, ridInput, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), rawHeaderSize); int32(n) > 0 {
			kind := binary.LittleEndian.Uint32(buf[0:4])
			device := binary.LittleEndian.Uint64(buf[8:16])
			ev := input{injected: device == 0}
			switch kind {
			case rimTypeMouse:
				ev.mouse = true
				ev.buttons = binary.LittleEndian.Uint16(buf[rawHeaderSize+4:])
			case rimTypeKeyboard:
				ev.up = binary.LittleEndian.Uint16(buf[rawHeaderSize+2:])&riKeyBreak != 0
				ev.vk = binary.LittleEndian.Uint16(buf[rawHeaderSize+6:])
			}
			if (ev.mouse && ev.buttons != 0) || (!ev.mouse && !ev.up) {
				ev.at = cursorPoint()
				select {
				case hooks.inputs <- ev:
				default:
				}
			}
		}
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, msg, wParam, lParam)
	return r
}

// work reads gestures from the raw input, off the window's thread.
func work() {
	for ev := range hooks.inputs {
		if ev.injected && !hooks.acceptInjected {
			continue
		}
		if ev.mouse {
			onMouse(ev.buttons, ev.at)
		} else if !isModifier(uint32(ev.vk)) {
			onKey(uint32(ev.vk))
		}
	}
}

func onMouse(buttons uint16, pt winPoint) {
	hooks.mu.Lock()
	actions := hooks.actions
	hooks.mu.Unlock()
	if !actions {
		return
	}
	if hooks.debug && buttons&(riMouseLeftDown|riMouseLeftUp) != 0 {
		logx.Info("[native] mouse", "buttons", buttons, "x", pt.X, "y", pt.Y)
	}
	switch {
	case buttons&riMouseLeftDown != 0:
		hooks.mu.Lock()
		now := time.Now()
		dbl, _, _ := procGetDoubleClickTime.Call()
		near := math.Abs(float64(pt.X-hooks.lastUpAt.X)) <= 4 && math.Abs(float64(pt.Y-hooks.lastUpAt.Y)) <= 4
		if near && now.Sub(hooks.lastUp) <= time.Duration(dbl)*time.Millisecond {
			hooks.clicks++
		} else {
			hooks.clicks = 1
		}
		hooks.downAt = pt
		in := make(chan bool, 1)
		hooks.downIn = in
		hooks.mu.Unlock()
		go func() { in <- inClientArea(pt) }()
		emitAction("none", pt)
	case buttons&riMouseLeftUp != 0:
		hooks.mu.Lock()
		down, clicks, in := hooks.downAt, hooks.clicks, hooks.downIn
		hooks.lastUpAt, hooks.lastUp = pt, time.Now()
		hooks.mu.Unlock()
		moved := math.Hypot(float64(pt.X-down.X), float64(pt.Y-down.Y))
		scene := ""
		switch {
		case moved >= dragThreshold:
			scene = "box_select"
		case clicks >= 2:
			scene = "multi_click_select"
		}
		if scene == "" {
			return
		}
		go func() {
			// A drag on a title bar moves the window: no selection, and no Ctrl+C sent to it (in a terminal,
			// Ctrl+C without a selection stops the running command).
			if in != nil {
				select {
				case inside := <-in:
					if !inside {
						if hooks.debug {
							logx.Info("[native] gesture outside a window's content", "scene", scene)
						}
						return
					}
				case <-time.After(150 * time.Millisecond):
				}
			}
			if ownWindowAt(pt) {
				return
			}
			emitAction(scene, pt)
		}()
	case buttons&(riMouseRightDown|riMouseMiddleDown) != 0:
		emitAction("other_click_dismiss", pt)
	case buttons&(riMouseWheel|riMouseHWheel) != 0:
		emitAction("gesture_dismiss", pt)
	}
}

func isModifier(vk uint32) bool {
	switch vk {
	case vkControl, vkLControl, vkRControl, vkShift, vkLShift, vkRShift, vkMenu, vkLMenu, vkRMenu, vkLWin, vkRWin, vkCapital:
		return true
	}
	return false
}

func ctrlDown() bool {
	r, _, _ := procGetAsyncKeyState.Call(vkControl)
	return r&0x8000 != 0
}

func onKey(vk uint32) {
	hooks.mu.Lock()
	keys, pastes := hooks.keys, hooks.pastes
	hooks.mu.Unlock()
	ctrl := ctrlDown()
	if pastes && vk == vkV && ctrl {
		data, _ := json.Marshal(map[string]any{"type": "user-paste", "timestamp": time.Now().UnixMilli()})
		emit(EventUserPaste, data)
	}
	if keys && !ctrl {
		emitAction("key_dismiss", cursorPoint())
	}
}

func foregroundProc(hook, event, hwnd, idObject, idChild, thread, eventTime uintptr) uintptr {
	hooks.mu.Lock()
	actions := hooks.actions
	hooks.mu.Unlock()
	if actions && hwnd != 0 && windowPID(hwnd) != hooks.selfPID {
		pt := cursorPoint()
		go emitAction("app_focus_dismiss", pt)
	}
	return 0
}

// ensureHooks starts the monitor thread once; it stays, and the flags say what it reports.
func ensureHooks() bool {
	if os.Getenv("POPMIND_NO_HOOKS") == "1" { // tests: run without the monitors
		return false
	}
	hooks.mu.Lock()
	if hooks.running {
		hooks.mu.Unlock()
		return true
	}
	if !hooks.procsOK {
		hooks.wndProc = syscall.NewCallback(wndProc)
		hooks.eventProc = syscall.NewCallback(foregroundProc)
		hooks.inputs = make(chan input, 256)
		go work()
		hooks.procsOK = true
	}
	hooks.selfPID = os.Getpid()
	hooks.acceptInjected = os.Getenv("POPMIND_ACCEPT_INJECTED") == "1"
	hooks.debug = os.Getenv("POPMIND_HOOK_DEBUG") == "1"
	hooks.mu.Unlock()

	started := make(chan bool, 1)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		module, _, _ := procGetModuleHandleW.Call(0)
		className, _ := syscall.UTF16PtrFromString("popMindRawInput")
		wc := wndClassEx{WndProc: hooks.wndProc, Instance: module, ClassName: className}
		wc.Size = uint32(unsafe.Sizeof(wc))
		procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))) // fails harmlessly when already registered
		hwnd, _, werr := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(className)), 0, 0, 0, 0, 0, 0, hwndMessage, 0, module, 0)
		devices := []rawInputDevice{
			{UsagePage: 0x01, Usage: 0x02, Flags: ridevInputSink, Target: hwnd}, // mouse
			{UsagePage: 0x01, Usage: 0x06, Flags: ridevInputSink, Target: hwnd}, // keyboard
		}
		ok := false
		if hwnd != 0 {
			r, _, _ := procRegisterRawInputDevices.Call(uintptr(unsafe.Pointer(&devices[0])), uintptr(len(devices)), unsafe.Sizeof(devices[0]))
			ok = r != 0
		}
		event, _, _ := procSetWinEventHook.Call(eventSystemForeground, eventSystemForeground, 0, hooks.eventProc, 0, 0, winEventOutOfContext)
		tid, _, _ := procGetCurrentThreadId.Call()
		hooks.mu.Lock()
		hooks.window, hooks.eventHook, hooks.threadID = hwnd, event, tid
		hooks.running = ok
		hooks.mu.Unlock()
		if !ok {
			logx.Error("[native] raw input failed", "window", hwnd != 0, "err", werr)
		}
		logx.Info("[native] monitors installed", "rawInput", ok, "foreground", event != 0)
		started <- ok
		if !ok {
			return
		}
		var m winMsg
		for {
			r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
			if int32(r) <= 0 {
				break
			}
			procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
			procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
		}
		procUnhookWinEvent.Call(event)
		procDestroyWindow.Call(hwnd)
		hooks.mu.Lock()
		hooks.running = false
		hooks.mu.Unlock()
	}()
	return <-started
}

// StartActionMonitor reports selection gestures and dismiss scenes.
func StartActionMonitor() bool {
	if !ensureHooks() {
		return false
	}
	hooks.mu.Lock()
	hooks.actions = true
	hooks.mu.Unlock()
	return true
}

// StopActionMonitor stops reporting them (the thread stays while the paste monitor needs it).
func StopActionMonitor() {
	hooks.mu.Lock()
	hooks.actions = false
	hooks.keys = false
	quit := !hooks.pastes && hooks.running
	tid := hooks.threadID
	hooks.mu.Unlock()
	if quit {
		procPostThreadMessageW.Call(tid, wmQuit, 0, 0)
	}
}

// SetKeyMonitorEnabled makes key presses dismiss the floating surfaces while they show.
func SetKeyMonitorEnabled(enabled bool) bool {
	if !ensureHooks() {
		return false
	}
	hooks.mu.Lock()
	hooks.keys = enabled
	hooks.mu.Unlock()
	return true
}

// StartPasteMonitor reports the user's own Ctrl+V (the paste stack).
func StartPasteMonitor() bool {
	if !ensureHooks() {
		return false
	}
	hooks.mu.Lock()
	hooks.pastes = true
	hooks.mu.Unlock()
	return true
}

// StopPasteMonitor stops it.
func StopPasteMonitor() {
	hooks.mu.Lock()
	hooks.pastes = false
	hooks.mu.Unlock()
}

// GetSelectionSnapshot names the app the selection is in; the text itself comes from the clipboard
// (GetTextByClipboard), which the picker asks for when the snapshot has none.
func GetSelectionSnapshot(scene string) (SelectionSnapshot, error) {
	front := Frontmost()
	if front.Pid <= 0 {
		return SelectionSnapshot{Scene: scene, Error: "no foreground window"}, nil
	}
	if front.Pid == os.Getpid() {
		return SelectionSnapshot{Scene: scene, SourceApp: front.Name, Error: "popMind's own window"}, nil
	}
	return SelectionSnapshot{
		Scene: scene, SourceApp: front.Name, SourceBundleID: front.BundleID, SourceAppPid: front.Pid,
		Strategy: "none", NeedsClipboardFallback: true, FallbackAppPid: front.Pid,
	}, nil
}
