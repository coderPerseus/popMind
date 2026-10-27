package clipboard

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"html"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/image/draw"

	"popmind/internal/logx"
	"popmind/internal/native"
)

// LinkPreview is what a link card shows about the page: its title, site and picture (the page's og:image).
// The Electron app took a screenshot of the page; reading the page's own metadata needs no browser.
type LinkPreview struct {
	URL       string `json:"url"`
	Status    string `json:"status"` // "ready" or "failed"
	Title     string `json:"title,omitempty"`
	SiteName  string `json:"siteName,omitempty"`
	HasImage  bool   `json:"hasImage,omitempty"`
	FetchedAt int64  `json:"fetchedAt"`
	// Image is the picture as PNG, at most 640 DIPs wide; loaded with the preview, not stored in JSON.
	Image []byte `json:"-"`
}

const (
	previewTimeout    = 8 * time.Second
	previewRetryAfter = 6 * time.Hour
	previewImageWidth = 640
	previewMaxHTML    = 1 << 20
	previewMaxImage   = 6 << 20
)

var (
	sensitiveQueryKey = regexp.MustCompile(`(?i)^(?:.*token.*|code|key|api[_-]?key|secret|sig|signature|x-amz-.*|password|passwd|pwd|auth.*|session.*|sid|otp|magic.*|ticket|nonce|state|invite.*)$`)
	sensitivePath     = regexp.MustCompile(`(?i)/(?:log-?out|sign-?out|unsubscribe|reset|verify|confirm|activate|magic|callback|oauth2?|authorize|approve|delete)(?:[/?#.]|$)`)
)

// PreviewSkipReason says why a link is never fetched (local services, links that act when opened), or "".
func PreviewSkipReason(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "invalid-url"
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "scheme"
	}
	if u.User != nil {
		return "credentials"
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || host == "0.0.0.0" {
		return "local-host"
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()) {
		return "local-host"
	}
	for k := range u.Query() {
		if sensitiveQueryKey.MatchString(k) {
			return "sensitive-query"
		}
	}
	if sensitivePath.MatchString(u.Path) {
		return "sensitive-path"
	}
	return ""
}

type previewer struct {
	mu      sync.Mutex
	pending map[string]bool
	cache   map[string]*LinkPreview
	sem     chan struct{}
}

var previews = &previewer{pending: map[string]bool{}, cache: map[string]*LinkPreview{}, sem: make(chan struct{}, 2)}

func previewKey(u string) string {
	h := sha256.Sum256([]byte(u))
	return hex.EncodeToString(h[:16])
}

func (s *Store) previewDir() string {
	dir := filepath.Join(s.root, "link-previews")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

// LinkPreview returns the preview of u when it is known. Otherwise it fetches it in the background, when the
// settings allow, and calls done with it once it is there.
func (s *Store) LinkPreview(u string, done func(*LinkPreview)) *LinkPreview {
	if u == "" || PreviewSkipReason(u) != "" {
		return nil
	}
	previews.mu.Lock()
	if p, ok := previews.cache[u]; ok {
		previews.mu.Unlock()
		return p
	}
	if previews.pending[u] {
		previews.mu.Unlock()
		return nil
	}
	previews.pending[u] = true
	previews.mu.Unlock()

	go func() {
		p := s.loadPreview(u)
		if p == nil || (p.Status != "ready" && time.Since(time.UnixMilli(p.FetchedAt)) > previewRetryAfter) {
			if !CurrentSettings().FetchLinkPreview {
				previews.mu.Lock()
				delete(previews.pending, u)
				previews.mu.Unlock()
				return
			}
			previews.sem <- struct{}{}
			p = s.fetchPreview(u)
			<-previews.sem
		}
		previews.mu.Lock()
		previews.cache[u] = p
		delete(previews.pending, u)
		previews.mu.Unlock()
		if done != nil && p.Status == "ready" {
			done(p)
		}
	}()
	return nil
}

func (s *Store) loadPreview(u string) *LinkPreview {
	key := previewKey(u)
	data, err := os.ReadFile(filepath.Join(s.previewDir(), key+".json"))
	if err != nil {
		return nil
	}
	var p LinkPreview
	if json.Unmarshal(data, &p) != nil || p.URL != u {
		return nil
	}
	if p.HasImage {
		p.Image, _ = os.ReadFile(filepath.Join(s.previewDir(), key+".png"))
		p.HasImage = len(p.Image) > 0
	}
	return &p
}

func (s *Store) savePreview(p *LinkPreview) {
	key := previewKey(p.URL)
	if len(p.Image) > 0 {
		_ = os.WriteFile(filepath.Join(s.previewDir(), key+".png"), p.Image, 0o644)
	}
	data, _ := json.Marshal(p)
	_ = os.WriteFile(filepath.Join(s.previewDir(), key+".json"), data, 0o644)
}

var (
	reTitle   = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	reMeta    = regexp.MustCompile(`(?is)<meta\s[^>]*>`)
	reAttr    = regexp.MustCompile(`(?is)([a-z:_-]+)\s*=\s*("([^"]*)"|'([^']*)')`)
	reSpaces  = regexp.MustCompile(`\s+`)
	userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
)

func (s *Store) fetchPreview(u string) *LinkPreview {
	p := &LinkPreview{URL: u, Status: "failed", FetchedAt: now()}
	defer s.savePreview(p)
	ctx, cancel := context.WithTimeout(context.Background(), previewTimeout)
	defer cancel()
	page, base, err := httpGet(ctx, u, previewMaxHTML)
	if err != nil {
		logx.Info("[link-preview] fetch failed", "err", err)
		return p
	}
	meta := map[string]string{}
	for _, tag := range reMeta.FindAllString(string(page), -1) {
		attrs := map[string]string{}
		for _, m := range reAttr.FindAllStringSubmatch(tag, -1) {
			attrs[strings.ToLower(m[1])] = m[3] + m[4]
		}
		name := strings.ToLower(attrs["property"] + attrs["name"])
		if name != "" && attrs["content"] != "" && meta[name] == "" {
			meta[name] = html.UnescapeString(attrs["content"])
		}
	}
	clean := func(v string) string { return strings.TrimSpace(reSpaces.ReplaceAllString(v, " ")) }
	p.Title = clean(meta["og:title"])
	if p.Title == "" {
		if m := reTitle.FindSubmatch(page); m != nil {
			p.Title = clean(html.UnescapeString(string(m[1])))
		}
	}
	if len([]rune(p.Title)) > 300 {
		p.Title = string([]rune(p.Title)[:300])
	}
	p.SiteName = clean(meta["og:site_name"])
	p.Status = "ready"
	img := meta["og:image"]
	if img == "" {
		img = meta["twitter:image"]
	}
	if img != "" {
		if ref, err := base.Parse(img); err == nil && PreviewSkipReason(ref.String()) == "" {
			if data, _, err := httpGet(ctx, ref.String(), previewMaxImage); err == nil {
				p.Image = shrinkImage(data)
				p.HasImage = len(p.Image) > 0
			}
		}
	}
	logx.Info("[link-preview] ready", "title", len(p.Title) > 0, "image", p.HasImage)
	return p
}

func httpGet(ctx context.Context, u string, limit int64) ([]byte, *url.URL, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return nil, nil, &url.Error{Op: "GET", URL: u, Err: io.ErrUnexpectedEOF}
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit))
	return data, res.Request.URL, err
}

// shrinkImage decodes any image format (ImageIO through the native library for WebP and others) and returns
// a PNG at most 640 DIPs wide.
func shrinkImage(data []byte) []byte {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		conv, cerr := native.ConvertImageToPNG(data)
		if cerr != nil {
			return nil
		}
		if img, err = png.Decode(bytes.NewReader(conv.PNG)); err != nil {
			return nil
		}
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w < 16 || h < 16 {
		return nil
	}
	if w > previewImageWidth {
		scale := float64(previewImageWidth) / float64(w)
		dst := image.NewNRGBA(image.Rect(0, 0, previewImageWidth, max(1, int(float64(h)*scale))))
		draw.CatmullRom.Scale(dst, dst.Bounds(), img, b, draw.Over, nil)
		img = dst
	}
	var out bytes.Buffer
	if png.Encode(&out, img) != nil {
		return nil
	}
	return out.Bytes()
}
