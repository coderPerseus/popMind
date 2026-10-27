// Package assets embeds the images the Go side draws with.
package assets

import _ "embed"

// TrayIcon is the menu bar icon, a template image (alpha only) at 2x.
//
//go:embed tray.png
var TrayIcon []byte
