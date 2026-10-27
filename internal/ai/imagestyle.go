package ai

import (
	"bytes"
	"image"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"net/url"
	"strings"
	"sync"

	"popmind/internal/jsonx"
	"popmind/internal/settings"
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
	imageGemini          // Gemini's own API at the same address (custom providers only): new-api serves it too,
	// and takes images there when its OpenAI-to-Gemini conversion crashes on them
	ImageStyles // how many there are
)

// ImageStylesFor is how many ways of sending images are worth trying with the model: Gemini's own API only
// at a relay of the user's own.
func ImageStylesFor(m *Model) int {
	if m.Provider == Custom {
		return ImageStyles
	}
	return imageGemini
}

// relayGeminiBase is the address of Gemini's API at the host of an OpenAI-compatible relay: its /v1 (or the
// pasted endpoint) becomes /v1beta.
func relayGeminiBase(raw string) string {
	base := normalizeOpenAIBaseURL(raw)
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return geminiBase(raw)
	}
	u.Path = strings.TrimSuffix(strings.TrimSuffix(u.Path, "/"), "/v1") + "/v1beta"
	u.RawQuery = ""
	return u.String()
}

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

// The ways of sending images that worked are kept in ai-image-styles.json, so a relay that needs one of the
// later ones is not tried the earlier ways again after each restart.
const imageStylesFile = "ai-image-styles.json"

var (
	styleMu     sync.Mutex
	styles      map[string]int
	stylesSaved = func(m map[string]int) {
		if settings.DataDir() != "" {
			_ = jsonx.WriteFile(settings.Path(imageStylesFile), m)
		}
	}
)

func modelKey(m *Model) string { return m.Provider + "|" + m.BaseURL + "|" + m.ModelID }

func loadStyles() {
	if styles != nil {
		return
	}
	styles = map[string]int{}
	if settings.DataDir() != "" {
		_ = jsonx.ReadFile(settings.Path(imageStylesFile), &styles)
	}
}

// ImageStyleFor is the way of sending images that worked last with this model at this address (0 at first).
func ImageStyleFor(m *Model) int {
	styleMu.Lock()
	defer styleMu.Unlock()
	loadStyles()
	if s := styles[modelKey(m)]; s >= 0 && s < ImageStylesFor(m) {
		return s
	}
	return 0
}

// RememberImageStyle keeps the way of sending images that worked.
func RememberImageStyle(m *Model, style int) {
	styleMu.Lock()
	defer styleMu.Unlock()
	loadStyles()
	if styles[modelKey(m)] == style {
		return
	}
	if style == 0 {
		delete(styles, modelKey(m))
	} else {
		styles[modelKey(m)] = style
	}
	saved := make(map[string]int, len(styles))
	for k, v := range styles {
		saved[k] = v
	}
	go stylesSaved(saved)
}

// UsesOpenAIImages reports whether the model's requests carry images the OpenAI way (the styles apply).
func (m *Model) UsesOpenAIImages() bool {
	f := m.Format
	if f == "" {
		f = m.Provider
	}
	return f != Anthropic && f != Google
}
