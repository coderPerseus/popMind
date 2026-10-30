package native

import (
	"errors"
	"image"
	"image/color"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows' side of the pointer, app activation, window tweaks and window capture. Window handles are the
// HWNDs myGo's NativeHandle returns.

var (
	gdi32                      = windows.NewLazySystemDLL("gdi32.dll")
	dwmapi                     = windows.NewLazySystemDLL("dwmapi.dll")
	procGetDC                  = user32.NewProc("GetDC")
	procReleaseDC              = user32.NewProc("ReleaseDC")
	procPrintWindow            = user32.NewProc("PrintWindow")
	procSetWindowLongPtrW      = user32.NewProc("SetWindowLongPtrW")
	procCreateCompatibleDC     = gdi32.NewProc("CreateCompatibleDC")
	procCreateCompatibleBitmap = gdi32.NewProc("CreateCompatibleBitmap")
	procSelectObject           = gdi32.NewProc("SelectObject")
	procGetDIBits              = gdi32.NewProc("GetDIBits")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procDeleteDC               = gdi32.NewProc("DeleteDC")
	procDwmSetWindowAttribute  = dwmapi.NewProc("DwmSetWindowAttribute")
	procDwmGetWindowAttribute  = dwmapi.NewProc("DwmGetWindowAttribute")
)

const (
	swShowNoActivate      = 4
	swRestore             = 9
	swpNoSize             = 0x0001
	swpNoMove             = 0x0002
	swpNoActivate         = 0x0010
	swpShowWindow         = 0x0040
	hwndTopmost           = ^uintptr(0) // (HWND)-1
	gwlExStyle            = ^uintptr(19)
	wsExToolWindow        = 0x00000080
	wsExTopmost           = 0x00000008
	wsExNoActivate        = 0x08000000
	dwmwaCornerPreference = 33
	dwmwcpRound           = 2
	dwmwaExtendedFrame    = 9
	pwRenderFullContent   = 2
	dibRGBColors          = 0
)

type winPoint struct{ X, Y int32 }

type winRect struct{ Left, Top, Right, Bottom int32 }

// Synthetic keystrokes: an INPUT of type keyboard, as SendInput takes it on 64-bit Windows (40 bytes).
type keyInput struct {
	Type  uint32
	_     uint32
	Vk    uint16
	Scan  uint16
	Flags uint32
	Time  uint32
	_     uint32
	Extra uintptr
	_     [8]byte
}

// CursorPosition is the pointer, in myGo's screen coordinates.
func CursorPosition() Point {
	x, y := toDIP(cursorPoint())
	return Point{X: x, Y: y}
}

// ActivateApp brings pid's front window forward.
func ActivateApp(pid int) bool {
	wins := topWindows(pid)
	if len(wins) == 0 {
		return false
	}
	hwnd := wins[0]
	if iconic, _, _ := procIsIconic.Call(hwnd); iconic != 0 {
		procShowWindow.Call(hwnd, swRestore)
	}
	procAllowSetForegroundWindow.Call(uintptr(pid))
	r, _, _ := procSetForegroundWindow.Call(hwnd)
	return r != 0
}

func topmost(hwnd uintptr, show bool) bool {
	flags := uintptr(swpNoMove | swpNoSize | swpNoActivate)
	if show {
		flags |= swpShowWindow
	}
	r, _, _ := procSetWindowPos.Call(hwnd, hwndTopmost, 0, 0, 0, 0, flags)
	return r != 0
}

// ConfigureBubbleWindow keeps the bubble from taking the focus and out of the taskbar, above other windows.
func ConfigureBubbleWindow(window uintptr, level int) bool {
	if window == 0 {
		return false
	}
	style, _, _ := procGetWindowLongPtrW.Call(window, gwlExStyle)
	procSetWindowLongPtrW.Call(window, gwlExStyle, style|wsExNoActivate|wsExToolWindow|wsExTopmost)
	return topmost(window, false)
}

// RefreshBubbleWindow puts the bubble back on top.
func RefreshBubbleWindow(window uintptr) {
	if window != 0 {
		topmost(window, false)
	}
}

// OrderWindowFront shows window above the others without activating it.
func OrderWindowFront(window uintptr) bool { return window != 0 && topmost(window, true) }

// PresentPanelWithoutActivation shows a panel without taking the focus from the app the user is in.
func PresentPanelWithoutActivation(window uintptr) bool {
	if window == 0 {
		return false
	}
	procShowWindow.Call(window, swShowNoActivate)
	return topmost(window, true)
}

// SetWindowAppearance: myGo follows the theme on Windows.
func SetWindowAppearance(window uintptr, mode string) bool { return false }

// SetWindowCornerRadius asks Windows 11 for rounded corners (its own radius; earlier Windows keeps square ones).
func SetWindowCornerRadius(window uintptr, radius int) bool {
	if window == 0 || procDwmSetWindowAttribute.Find() != nil {
		return false
	}
	pref := uint32(dwmwcpRound)
	r, _, _ := procDwmSetWindowAttribute.Call(window, dwmwaCornerPreference, uintptr(unsafe.Pointer(&pref)), 4)
	return r == 0
}

// SetVibrancyTopCornerRadius rounds the window as SetWindowCornerRadius does.
func SetVibrancyTopCornerRadius(window uintptr, radius int) bool {
	return SetWindowCornerRadius(window, radius)
}

// RegisterSurfaceWindow: nothing to register on Windows (the hooks tell popMind's windows by process).
func RegisterSurfaceWindow(window uintptr) {}

// PrepareWindowIn and AnimateWindowIn: myGo's windows show as they are on Windows.
func PrepareWindowIn(window uintptr)             {}
func AnimateWindowIn(window uintptr, ms, dy int) {}

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// CaptureFrontmostWindowPNG pictures pid's front window as a PNG, for an explanation's context.
func CaptureFrontmostWindowPNG(pid int) ([]byte, error) {
	wins := topWindows(pid)
	if len(wins) == 0 {
		return nil, errors.New("no window")
	}
	hwnd := wins[0]
	var r winRect
	procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r)))
	w, h := int(r.Right-r.Left), int(r.Bottom-r.Top)
	if w <= 0 || h <= 0 {
		return nil, errors.New("empty window")
	}
	screen, _, _ := procGetDC.Call(0)
	defer procReleaseDC.Call(0, screen)
	mem, _, _ := procCreateCompatibleDC.Call(screen)
	defer procDeleteDC.Call(mem)
	bmp, _, _ := procCreateCompatibleBitmap.Call(screen, uintptr(w), uintptr(h))
	defer procDeleteObject.Call(bmp)
	old, _, _ := procSelectObject.Call(mem, bmp)
	ok, _, _ := procPrintWindow.Call(hwnd, mem, pwRenderFullContent)
	procSelectObject.Call(mem, old)
	if ok == 0 {
		return nil, errors.New("PrintWindow failed")
	}
	info := bitmapInfoHeader{Size: 40, Width: int32(w), Height: -int32(h), Planes: 1, BitCount: 32}
	pix := make([]byte, w*h*4)
	if n, _, _ := procGetDIBits.Call(mem, bmp, 0, uintptr(h), uintptr(unsafe.Pointer(&pix[0])), uintptr(unsafe.Pointer(&info)), dibRGBColors); n == 0 {
		return nil, errors.New("GetDIBits failed")
	}
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < w*h; i++ {
		img.SetNRGBA(i%w, i/w, color.NRGBA{pix[i*4+2], pix[i*4+1], pix[i*4], 255})
	}
	return encodePNG(img), nil
}

// RecognizeText (OCR) has no Windows engine wired in: callers fall back as without one.
func RecognizeText(path string, languages []string, fast bool) (string, error) {
	return "", errors.New("OCR is not available on Windows")
}
