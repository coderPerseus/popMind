package views

import (
	"fmt"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"

	"popmind/internal/i18n"
	"popmind/internal/translation"
)

// TestRenderSiteAssets makes the website's pictures (website/public) from the app itself, into
// $POPMIND_SITE_DIR: the logo as SVG (the intro's strokes), the icons and the share card, and the windows
// shown on the home page, in Chinese and in English.
func TestRenderSiteAssets(t *testing.T) {
	dir := os.Getenv("POPMIND_SITE_DIR")
	if dir == "" {
		t.Skip("set POPMIND_SITE_DIR (website/public) to render")
	}

	// The logo, as the strokes the intro draws, in currentColor.
	if err := os.WriteFile(filepath.Join(dir, "logo.svg"), []byte(logoSVG()), 0o644); err != nil {
		t.Fatal(err)
	}

	// Icons: the logo on a white rounded square (favicon, touch icon).
	icon := func(size int, bg, ink ui.Color) func(*ui.Context) {
		return func(c *ui.Context) {
			c.Root().Background(ui.Color{})
			ui.Box(c).Fill().Draw(func(p *ui.Painter, r ui.Rect) {
				p.Fill(r, bg, r.W*0.22)
				inset := r.W * 0.16
				f := xform{s: (r.W - 2*inset) / 100, x: r.X + inset, y: r.Y + inset}
				strokeLogo(p, f, ink)
			})
		}
	}
	savePNG(t, filepath.Join(dir, "favicon.png"), icon(64, ui.RGB(255, 255, 255), ui.RGB(22, 22, 24)), 64, 64, 1)
	savePNG(t, filepath.Join(dir, "icon.png"), icon(256, ui.RGB(255, 255, 255), ui.RGB(22, 22, 24)), 256, 256, 1)

	// The share card, 1200×630: the logo, the name and the line, on the page's white with the violet once.
	savePNG(t, filepath.Join(dir, "og.png"), func(c *ui.Context) {
		c.Root().Background(ui.RGB(255, 255, 255))
		ui.Box(c).Fill().Draw(func(p *ui.Painter, r ui.Rect) {
			strokeLogo(p, xform{s: 1.6, x: r.X + 96, y: r.Y + 150}, ui.RGB(28, 28, 35))
			p.RichText(r.X+300, r.Y+170, 0, ui.Span{Text: "popMind", Size: 84, Weight: 700, Color: ui.RGB(28, 28, 35)})
			p.RichText(r.X+304, r.Y+290, 0, ui.Span{Text: "选中文本，AI 即刻响应。", Size: 40, Weight: 500, Color: ui.Hex("#5A4BC6")})
			p.RichText(r.X+304, r.Y+356, 0, ui.Span{Text: "Select text. AI responds.", Size: 30, Color: ui.RGB(94, 94, 110)})
			p.RichText(r.X+96, r.Y+520, 0, ui.Span{Text: "macOS · pm.luckysnail.cn", Size: 24, Color: ui.RGB(124, 124, 140)})
		})
	}, 1200, 630, 1)

	// The windows, from the render tests, in each language; the translation shows a table from a terminal.
	for _, lang := range []string{"zh-CN", "en"} {
		i18n.SetLanguage(lang)
		short := strings.Split(lang, "-")[0]
		tmp := t.TempDir()
		t.Setenv("POPMIND_RENDER_DIR", tmp)
		t.Setenv("POPMIND_RENDER_SITE", "1")
		t.Run("launcher-"+short, TestRenderLauncher)
		t.Run("popups-"+short, TestRenderPopups)
		t.Run("clipboard-"+short, TestRenderClipboardPanel)
		out := filepath.Join(dir, "shots", short)
		_ = os.MkdirAll(out, 0o755)
		for from, to := range map[string]string{"chat": "explain", "clip-light": "clipboard"} {
			data, err := os.ReadFile(filepath.Join(tmp, from+".png"))
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(out, to+".png"), data, 0o644); err != nil {
				t.Fatal(err)
			}
		}
		savePNG(t, filepath.Join(out, "translate.png"), terminalTablePopup(short), translateWidth, 430, 2)
		// Input translation: a reply written in Chinese, to send in English.
		in := &InputTranslation{app: &App{}, status: "idle", target: "en",
			draft: "周五前我会把修复后的版本发给你，麻烦帮忙再测一下，有问题随时告诉我。"}
		savePNG(t, filepath.Join(out, "input.png"), in.view, inputTrWidth, inputTrHeight, 2)
	}
	i18n.SetLanguage("zh-CN")

	// The install guide's picture: the disk image's window as Finder shows it, its background (packaging/)
	// with the app's icon and the Applications folder's, from $POPMIND_DMG_ICONS (app.png, apps.png).
	if icons := os.Getenv("POPMIND_DMG_ICONS"); icons != "" {
		load := func(path string) *ui.Bitmap {
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			b, err := ui.DecodeBitmap(data)
			if err != nil {
				t.Fatal(err)
			}
			return b
		}
		bg := load("../../packaging/dmg-background@2x.png")
		app, folder := load(filepath.Join(icons, "app.png")), load(filepath.Join(icons, "apps.png"))
		savePNG(t, filepath.Join(dir, "dmg-window.png"), func(c *ui.Context) {
			c.Root().Background(ui.RGB(250, 250, 251))
			ui.Box(c).Fill().Draw(func(p *ui.Painter, r ui.Rect) {
				p.Image(bg, r, ui.FillBox)
				// The icons where packaging/dmg-settings.py puts them: 112 wide, centered at (170, 200) and (470, 200).
				for i, b := range []*ui.Bitmap{app, folder} {
					cx := float32([]int{dmgAppX, dmgLinkX}[i])
					p.Image(b, ui.Rect{X: r.X + cx - 56, Y: r.Y + dmgIconY - 56, W: 112, H: 112}, ui.FillBox)
					label := ui.Span{Text: []string{"popMind", "Applications"}[i], Size: 13, Color: ui.RGB(28, 28, 35)}
					w, _ := p.MeasureText(0, label)
					p.RichText(r.X+cx-w/2, r.Y+dmgIconY+62, 0, label)
				}
			})
		}, dmgWidth, dmgHeight, 2)
	}
}

func savePNG(t *testing.T, path string, view func(*ui.Context), w, h int, scale float32) {
	t.Helper()
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, ui.Render(view, w, h, scale)); err != nil {
		t.Fatal(err)
	}
}

func strokeLogo(p *ui.Painter, f xform, ink ui.Color) {
	var a, b ui.Path
	logoBubble().appendTo(&a, f)
	logoM().appendTo(&b, f)
	p.StrokePath(&a, logoStroke*f.s, ink)
	p.StrokePath(&b, logoStroke*f.s, ink)
}

// logoSVG is the logo's two strokes as an SVG in its 100 box, drawn in currentColor.
func logoSVG() string {
	d := func(s subpath) string {
		var b strings.Builder
		fmt.Fprintf(&b, "M%.2f %.2f", s.from.X, s.from.Y)
		for _, c := range s.segs {
			fmt.Fprintf(&b, "C%.2f %.2f %.2f %.2f %.2f %.2f", c.c1.X, c.c1.Y, c.c2.X, c.c2.Y, c.to.X, c.to.Y)
		}
		return b.String()
	}
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 112 112" fill="none" stroke="currentColor" stroke-width="%.1f" stroke-linecap="round" stroke-linejoin="round"><path d="%s"/><path d="%s"/></svg>
`, logoStroke, d(logoBubble()), d(logoM()))
}

// terminalTablePopup is the translation popup showing a reply copied from a terminal, its table kept.
func terminalTablePopup(string) func(*ui.Context) {
	src := "Windows are now translucent, with the system's blur behind them.\n\n| Window | Effect |\n| --- | --- |\n| Switcher | Popover material, like Spotlight. |\n| Settings | Sidebar material, like System Settings. |\n| Guides | Window material, translucent. |\n\nCards, fields and buttons stay solid, so text reads well."
	tr := "窗口现在是半透明的，背后是系统的模糊效果。\n\n| 窗口 | 效果 |\n| --- | --- |\n| 切换器 | 弹出框材质，类似聚光灯。 |\n| 设置 | 侧边栏材质，类似系统设置。 |\n| 引导窗口 | 窗口材质，半透明。 |\n\n卡片、输入框和按钮保持不透明，文字依然清晰易读。"
	p := &TranslatePopup{}
	p.tr.Reset()
	p.tr.Update = func(fn func()) { fn() }
	p.tr.Text, p.tr.Status = src, "success"
	p.tr.Result = translation.Result{Engine: "google", Markdown: true, SourceText: src, TargetLanguage: "zh-CN",
		DetectedSourceLanguage: "en", TranslatedText: tr}
	return p.view
}
