package views

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
)

// webImages loads the http(s) images of markdown (up to 8 MB, 10 s), for translated documents.
func webImages(url string) (ui.ImageSource, error) {
	if !strings.HasPrefix(url, "https://") && !strings.HasPrefix(url, "http://") {
		return nil, errors.New("unsupported image address")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return nil, errors.New(res.Status)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if strings.Contains(res.Header.Get("Content-Type"), "svg") || strings.HasSuffix(strings.ToLower(url), ".svg") {
		return ui.ParseSVG(data)
	}
	return ui.DecodeBitmap(data)
}
