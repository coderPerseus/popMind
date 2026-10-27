package views

import (
	"bytes"
	"image"
	"image/png"
	"time"

	"golang.org/x/image/draw"

	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/settings"
)

// contextImageEdge is the longest edge of the capture sent to the model: enough to read the text around the
// selection, small enough to stay quick and cheap.
const contextImageEdge = 1568

// captureContext silently captures the window the selection is in, for the explanation to use as context.
// It is skipped when the setting is off or popMind has no Screen Recording permission (it never asks here).
func captureContext(pid int) []byte {
	if pid <= 0 || !settings.Capabilities.Get().ExplainScreenshotOn() {
		return nil
	}
	if !native.ScreenCaptureAccess(false) {
		logx.Info("[context-capture] skipped: no screen recording permission")
		return nil
	}
	started := time.Now()
	data, err := native.CaptureFrontmostWindowPNG(pid)
	if err != nil || len(data) == 0 {
		logx.Warn("[context-capture] failed", "err", err)
		return nil
	}
	out := shrinkPNG(data, contextImageEdge)
	logx.Info("[context-capture] done", "ms", time.Since(started).Milliseconds(), "bytes", len(out), "raw", len(data))
	return out
}

func shrinkPNG(data []byte, edge int) []byte {
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return data
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if max(w, h) <= edge {
		return data
	}
	scale := float64(edge) / float64(max(w, h))
	dst := image.NewNRGBA(image.Rect(0, 0, max(1, int(float64(w)*scale)), max(1, int(float64(h)*scale))))
	draw.ApproxBiLinear.Scale(dst, dst.Bounds(), img, b, draw.Src, nil)
	var buf bytes.Buffer
	if png.Encode(&buf, dst) != nil {
		return data
	}
	return buf.Bytes()
}
