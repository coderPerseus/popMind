// Package assets embeds the images the views show.
package assets

import (
	"embed"
	"sync"

	"github.com/egoist/mygo/ui"
)

//go:embed *.png
var files embed.FS

var cache sync.Map

// Bitmap returns the decoded image of name (without .png), or nil.
func Bitmap(name string) *ui.Bitmap {
	if v, ok := cache.Load(name); ok {
		return v.(*ui.Bitmap)
	}
	data, err := files.ReadFile(name + ".png")
	if err != nil {
		return nil
	}
	b, err := ui.DecodeBitmap(data)
	if err != nil {
		return nil
	}
	cache.Store(name, b)
	return b
}

// Bytes returns the file of name (without .png) as it is, or nil.
func Bytes(name string) []byte {
	data, _ := files.ReadFile(name + ".png")
	return data
}
