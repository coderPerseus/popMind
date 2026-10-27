package clipboard

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"

	"golang.org/x/image/draw"
)

const thumbEdge = 480

// Thumbnail returns a PNG of an image item at most 480 DIPs on its long edge, made once and kept in thumbs/.
func (s *Store) Thumbnail(it Item) []byte {
	if it.ImageHash == "" {
		return nil
	}
	path := filepath.Join(s.root, "thumbs", it.ImageHash[:2], it.ImageHash+"@480.png")
	if data, err := os.ReadFile(path); err == nil {
		return data
	}
	src, err := os.ReadFile(s.BlobFile(it.ImageHash))
	if err != nil {
		return nil
	}
	img, err := png.Decode(bytes.NewReader(src))
	if err != nil {
		return nil
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= thumbEdge && h <= thumbEdge {
		return src
	}
	scale := float64(thumbEdge) / float64(max(w, h))
	dst := image.NewNRGBA(image.Rect(0, 0, max(1, int(float64(w)*scale)), max(1, int(float64(h)*scale))))
	draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)
	var out bytes.Buffer
	if err := png.Encode(&out, dst); err != nil {
		return nil
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, out.Bytes(), 0o644)
	return out.Bytes()
}
