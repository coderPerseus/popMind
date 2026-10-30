package views

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"

	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/textpicker"
	"popmind/internal/views/assets"
	"popmind/internal/windows"
)

var capturing atomic.Bool

// ScreenshotTranslate lets the user pick an area of the screen, reads its text and shows the translation
// next to where the pick ended. A second press while picking does nothing.
func (a *App) ScreenshotTranslate() {
	if !capturing.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer capturing.Store(false)
		a.screenshotTranslate()
	}()
}

func (a *App) screenshotTranslate() {
	if runtime.GOOS != "darwin" {
		a.Translate.ShowNotice(i18n.T("screenshot.unsupported"), cursorAnchor())
		return
	}
	if !native.ScreenCaptureAccess(false) {
		// Without the permission the capture shows only the desktop: ask, and say why nothing happened.
		logx.Info("[screenshot] no screen recording permission")
		if !native.ScreenCaptureAccess(true) {
			native.OpenScreenRecordingSettings()
		}
		a.Translate.ShowNotice(i18n.T("screenshot.permission"), cursorAnchor())
		return
	}
	windows.DismissTopmost(windows.DismissEscape)
	path := filepath.Join(os.TempDir(), "popmind-screenshot-"+time.Now().Format("150405.000")+".png")
	defer os.Remove(path)

	a.Picker.Suspend(true)
	start := time.Now()
	ok, err := native.CaptureScreenRegion(path)
	a.Picker.Suspend(false)
	anchor := cursorAnchor() // the pointer ends where the area was let go
	if err != nil {
		logx.Error("[screenshot] capture failed", "err", err)
		a.Translate.ShowNotice(i18n.T("screenshot.failed")+": "+err.Error(), anchor)
		return
	}
	if !ok {
		logx.Info("[screenshot] cancelled", "ms", time.Since(start).Milliseconds())
		return
	}
	info, _ := os.Stat(path)
	ocrStart := time.Now()
	// Reading takes a fraction of a second, but up to half a minute the first time a Mac does it (Vision
	// prepares its models): say so at once.
	a.Translate.ShowWorking(i18n.T("screenshot.recognizing"), anchor)
	text, err := native.RecognizeText(path, nil, false) // Vision detects the language
	text = strings.TrimSpace(text)
	size := int64(0)
	if info != nil {
		size = info.Size()
	}
	logx.Info("[screenshot] recognized", "bytes", size, "chars", len([]rune(text)),
		"captureMs", ocrStart.Sub(start).Milliseconds(), "ocrMs", time.Since(ocrStart).Milliseconds(), "err", err)
	switch {
	case err != nil:
		a.Translate.ShowNotice(i18n.T("screenshot.failed")+": "+err.Error(), anchor)
	case text == "":
		a.Translate.ShowNotice(i18n.T("screenshot.noText"), anchor)
	default:
		a.Translate.Show(text, anchor)
	}
}

// WarmScreenshotOCR reads a small picture once in the background. Vision prepares its models for each app
// the first time it reads text (about half a minute, cached after that): done here, the first screenshot
// translation shows at once; on later launches it takes a fraction of a second.
func WarmScreenshotOCR() {
	if runtime.GOOS != "darwin" {
		return
	}
	go func() {
		time.Sleep(20 * time.Second) // after the launch's own work
		if capturing.Load() {
			return
		}
		path := filepath.Join(os.TempDir(), "popmind-ocr-warmup.png")
		if err := os.WriteFile(path, assets.Bytes("ocr-warmup"), 0o600); err != nil {
			return
		}
		defer os.Remove(path)
		start := time.Now()
		text, err := native.RecognizeText(path, nil, false)
		logx.Info("[screenshot] ocr warmed", "ms", time.Since(start).Milliseconds(), "chars", len([]rune(text)), "err", err)
	}()
}

// cursorAnchor is the pointer, as a zero-height anchor for a floating window.
func cursorAnchor() textpicker.Anchor {
	pt := mygo.Screen.CursorScreenPoint()
	return textpicker.Anchor{X: float64(pt.X), TopY: float64(pt.Y), BottomY: float64(pt.Y)}
}
