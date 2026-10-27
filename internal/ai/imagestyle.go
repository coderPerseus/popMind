package ai

import (
	"bytes"
	"image"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"sync"
)

// The ways an OpenAI-compatible request may carry a screenshot, tried in turn when a relay fails on one:
// some (new-api turning OpenAI requests into Gemini ones) crash with an image next to the "thinking off"
// fields, on the part order, on a large PNG, or while streaming the reply to a request with an image.
const (
	imagePlain    = iota // text, then a PNG; reasoning turned off
	imageNoThink         // the same without the reasoning fields
	imageFirst           // the image first, with detail "auto"
	imageJPEG            // the same with a JPEG
	imageNoStream        // the same, not streamed: the reply comes whole (relays that fail streaming images)
	ImageStyles          // how many there are
)

func hasImages(r Request) bool {
	for _, m := range r.Messages {
		if len(m.Images) > 0 {
			return true
		}
	}
	return false
}

// toJPEG re-encodes an image as a JPEG (quality 85), or returns it as a PNG when it cannot.
func toJPEG(data []byte) ([]byte, string) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, "image/png"
	}
	rgba := image.NewRGBA(img.Bounds())
	draw.Draw(rgba, rgba.Bounds(), image.White, image.Point{}, draw.Src)
	draw.Draw(rgba, rgba.Bounds(), img, img.Bounds().Min, draw.Over)
	var b bytes.Buffer
	if jpeg.Encode(&b, rgba, &jpeg.Options{Quality: 85}) != nil {
		return data, "image/png"
	}
	return b.Bytes(), "image/jpeg"
}

var (
	styleMu sync.Mutex
	styles  = map[string]int{}
)

func modelKey(m *Model) string { return m.Provider + "|" + m.BaseURL + "|" + m.ModelID }

// ImageStyleFor is the way of sending images that worked last with this model at this address (0 at first).
func ImageStyleFor(m *Model) int {
	styleMu.Lock()
	defer styleMu.Unlock()
	return styles[modelKey(m)]
}

// RememberImageStyle keeps the way of sending images that worked.
func RememberImageStyle(m *Model, style int) {
	styleMu.Lock()
	styles[modelKey(m)] = style
	styleMu.Unlock()
}

// UsesOpenAIImages reports whether the model's requests carry images the OpenAI way (the styles apply).
func (m *Model) UsesOpenAIImages() bool {
	f := m.Format
	if f == "" {
		f = m.Provider
	}
	return f != Anthropic && f != Google
}
