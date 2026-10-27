// Package clipboard is popMind's clipboard history: it watches the pasteboard, keeps what is copied in
// clipboard/clipboard.sqlite (the Electron app's schema, so its history can be brought over), searches it and
// pastes items back into the app the user is in (docs/clipboard-paste-redesign.md).
package clipboard

import (
	"popmind/internal/jsonx"
	"popmind/internal/settings"
)

// Kinds of items.
const (
	KindText  = "text"
	KindLink  = "link"
	KindImage = "image"
	KindFile  = "file"
	KindColor = "color"
)

// Kinds lists them in the order the filters show.
var Kinds = []string{KindText, KindLink, KindImage, KindFile, KindColor}

// Marker is the pasteboard type popMind adds to what it writes; its value is the item id.
const Marker = "app.popmind.clipboard.writeback"

// Item is a row of the history.
type Item struct {
	ID           string
	Kind         string
	SubKind      string
	IsRich       bool
	Title        string
	CustomTitle  string
	Preview      string
	URL          string
	Color        string
	FileCount    int
	FileNames    []string
	ImageWidth   int
	ImageHeight  int
	ImageHash    string
	ByteSize     int64
	CharCount    int
	SourceID     string
	SourceName   string
	IsRemote     bool
	CreatedAt    int64
	LastCopiedAt int64
	CopyCount    int
	UseCount     int
	Pinboards    []string
	HasOCR       bool
	HasSecret    bool
	// Snippet is the part of the item a search matched, when it did.
	Snippet string
}

// Detail is an item with all its content.
type Detail struct {
	Item
	PlainText string
	HTML      string
	FilePaths []string
	OCRText   string
	Tags      []string
}

// Pinboard is a named list of items.
type Pinboard struct {
	ID        string
	Name      string
	Color     string
	SortOrder int
	ItemCount int
}

// PinboardColors are the colors a pinboard takes.
var PinboardColors = []string{"red", "orange", "yellow", "green", "blue", "purple", "gray"}

// App is an app items were copied from.
type App struct {
	BundleID string
	Name     string
}

// Settings is CapabilitySettings.clipboard.
type Settings struct {
	Enabled          bool    `json:"enabled"`
	Appearance       string  `json:"appearance"`
	Retention        string  `json:"retention"`
	MaxStorageMb     float64 `json:"maxStorageMb"`
	MaxItemMb        float64 `json:"maxItemMb"`
	DirectPaste      bool    `json:"directPaste"`
	AlwaysPlainText  bool    `json:"alwaysPlainText"`
	FetchLinkPreview bool    `json:"fetchLinkPreviews"`
	PausedUntil      int64   `json:"pausedUntil"`
	Privacy          struct {
		IgnoredBundleIDs   []string `json:"ignoredBundleIds"`
		IgnoreConfidential bool     `json:"ignoreConfidential"`
		IgnoreTransient    bool     `json:"ignoreTransient"`
		SkipSecrets        bool     `json:"skipSecrets"`
		IgnoreRegexps      []string `json:"ignoreRegexps"`
	} `json:"privacy"`
	OCR struct {
		Enabled bool `json:"enabled"`
	} `json:"ocr"`
}

// CurrentSettings reads the clipboard settings.
func CurrentSettings() Settings {
	var s Settings
	_ = jsonx.Convert(settings.Capabilities.Raw()["clipboard"], &s)
	return s
}
