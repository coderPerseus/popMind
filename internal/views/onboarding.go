package views

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/shader"

	"popmind/internal/i18n"
	"popmind/internal/jsonx"
	"popmind/internal/logx"
	"popmind/internal/settings"
)

// The first-run intro, over the whole screen with nothing but a breathing aurora behind it: popMind is
// written out by hand, large and bold; the "p" opens into the logo's bubble and the "m" is written inside it
// while the other letters fade; the aurora swells once as the logo settles, then fades, and the logo flies to
// its place in the launcher's footer as the launcher comes in around it. Then the real launcher takes over at
// the same spot. A click or Escape skips it. It plays even when the system asks for less motion: it is shown
// once, and one click ends it. Everything is drawn with myGo's painter and a shader, from the time since it
// started.

const onboardingFile = "onboarding.json"

// Timeline, in milliseconds from the start.
const (
	obGlowIn     = 700
	obWriteStart = 350
	obLetterGap  = 180
	obLetterDur  = 620
	obFadeStart  = 2350
	obFadeDur    = 380
	obMorphStart = 2450
	obMorphDur   = 950
	obMarkStart  = 3350
	obExpand     = 4300
	obExpandDur  = 750
	obTotal      = obExpand + obExpandDur
)

// Sizes, in points.
const (
	obWordScale = 2.2
	obLogoSize  = 184
	obLogoRise  = 40 // the logo sits this far above the launcher's center, the name under it
	obMorphPts  = 200
	obMMove     = 620 // the "M" moving into the bubble
	obMShapeAt  = 380 // and turning into the "m", from this far into the morph
	obMShapeDur = 720
	// The real launcher shows as the logo comes to rest: showing a window holds the main thread for a frame
	// or two, which a moving logo would show as a hitch.
	// The real launcher opens, transparent, this long before the logo flies (while nothing moves: showing a
	// window holds the main thread for a frame or two), then fades in as the logo flies onto it.
	obPrepare = 350
	// The center of the launcher's footer logo, from its left and bottom edges: the footer's left padding (8)
	// and the button's (6), then half the 18-point logo; centered in the 40-point footer.
	obFooterLogoX = 8 + 6 + 9
	obFooterLogoB = 20
	obBreath      = 3.4 // seconds per breath of the aurora
)

// FirstRun reports whether this install opens for the first time: the intro plays once per version, after
// each install or update, and onboarding.json keeps the version it last played for. Development builds play
// it only when asked (POPMIND_ONBOARDING=1, or the tray's item).
func FirstRun() bool {
	if os.Getenv("POPMIND_ONBOARDING") == "1" {
		return true
	}
	if mygo.IsDev() {
		return false
	}
	var seen struct {
		Version string `json:"version"`
	}
	_ = jsonx.ReadFile(settings.Path(onboardingFile), &seen)
	return seen.Version != mygo.App.Version()
}

func markOnboarded() {
	if err := jsonx.WriteFile(settings.Path(onboardingFile), map[string]any{"shown": true, "version": mygo.App.Version()}); err != nil {
		logx.Warn("[onboarding] save failed", "err", err)
	}
}

// aurora is the background: a soft veil behind the lettering, lighter (or darker, in dark mode) than the
// desktop, so it reads on any wallpaper, and colored lights drifting around it, all breathing slowly. It is
// transparent toward the screen's edges.
var aurora = shader.MustCompile(`package main

var Time float
var Level float
var Breath float
var Center vec2
var Dark float
var Colors [5]vec4

func Fragment(dst vec4, pos vec2) vec4 {
	size := rectSize()
	uv := (pos - Center) / size.y

	v := length(uv * vec2(0.55, 1.0))
	veil := exp(-v*v*9.0) * (0.5 + 0.12*Breath)

	glow := vec3(0)
	w := 0.0
	for i := 0; i < 5; i++ {
		f := float(i)
		c := vec2(cos(Time*0.33+f*1.2566), sin(Time*0.27+f*2.1)) * vec2(0.42, 0.2)
		d := length((uv - c) * vec2(0.7, 1.0))
		k := exp(-d * d * 11.0)
		glow += Colors[i].rgb * k
		w += k
	}
	// The lights stay around the middle: the screen's edges stay clear.
	m := length(uv * vec2(0.5, 0.9))
	mask := exp(-m * m * 4.0)
	ga := clamp(w, 0.0, 1.0) * (0.2 + 0.2*Breath) * mask
	gc := glow / max(w, 0.0001)

	veilColor := mix(vec3(1.0), vec3(0.06, 0.06, 0.08), Dark)
	rgb := gc*ga + veilColor*veil*(1.0-ga)
	a := ga + veil*(1.0-ga)
	return vec4(rgb, a) * Level
}
`)

// Onboarding is the intro window.
type Onboarding struct {
	app     *App
	win     *mygo.Window
	start   time.Time
	shownAt time.Time
	mu      sync.Mutex
	// Frame stats, logged at the end: how many frames, and the longest gap between two.
	frames int
	lastAt time.Time
	maxGap time.Duration
	gapAt  time.Duration // when the longest gap ended, from the first frame
	once   sync.Once
	// placeholder is the launcher's, so that the hand-over shows the same words.
	placeholder string
	// launcher is where the launcher will show, in the window; zero centers it.
	launcher ui.Rect
	// forceGlow draws the aurora without a GPU too (render tests).
	forceGlow bool

	word  []glyph
	pFrom []pt // the word's "p", sampled, in letter units
	pTo   []pt // the logo's bubble, sampled, in its 100 box
	mFrom []pt // the word's "M", sampled part by part against the logo's "m" (mTo)
	mFit  []pt // the "M" fitted to the "m"'s box, in the logo's 100 box
	mTo   []pt

	prepareOnce sync.Once
	fadeOnce    sync.Once
	offset      []float32
}

func newOnboardingModel() *Onboarding {
	o := &Onboarding{word: wordGlyphs()}
	var x float32
	for _, g := range o.word {
		o.offset = append(o.offset, x)
		x += g.advance
	}
	o.pFrom = o.word[0].strokes[0].sample(obMorphPts)
	o.pTo = logoBubble().sample(obMorphPts)
	o.mFrom, o.mTo = matchStrokes(o.word[3].strokes[0], logoM(), mParts, obMorphPts)
	// Inside the bubble, clear of its ring: the "m"'s box without the tail that runs into the ring.
	o.mFit = fitTo(o.mFrom, box{x: 21, y: 31, w: 52, h: 32})
	return o
}

// Onboard plays the intro over the screen with the pointer, then shows the launcher.
func (a *App) Onboard() {
	markOnboarded()
	o := newOnboardingModel()
	o.app = a
	o.placeholder = a.Launcher.placeholder
	d := mygo.Screen.DisplayNearestPoint(mygo.Screen.CursorScreenPoint())
	b, wa := d.Bounds, d.WorkArea
	// The launcher shows centered in the work area (Launcher.Show), here in the window's points.
	o.win = mygo.NewWindow(mygo.WindowOptions{
		Title:         "popMind",
		Panel:         true,
		Hidden:        true,
		Frameless:     true,
		Transparent:   true,
		DisableShadow: true,
		AlwaysOnTop:   true,
		DisableResize: true,
		Width:         b.Width,
		Height:        b.Height,
		Content:       ui.View(o.view),
	})
	o.win.SetPosition(b.X, b.Y)
	o.win.Show()
	o.win.Focus()
	// Where the launcher will show (centered in the work area, as Launcher.Show places it), in the intro's
	// points, from where the intro really is: macOS may move it, as it keeps windows below the menu bar.
	ib := o.win.Bounds()
	o.mu.Lock()
	o.launcher = ui.Rect{
		X: float32(wa.X + (wa.Width-launcherWidth)/2 - ib.X),
		Y: float32(wa.Y + (wa.Height-launcherHeight)/2 - ib.Y),
		W: launcherWidth, H: launcherHeight,
	}
	o.mu.Unlock()
	o.shownAt = time.Now()
	logx.Info("[onboarding] shown", "bounds", ib, "launcher", o.launcher)
	// In case no frames come (the window covered), or they stop.
	time.AfterFunc(2*time.Second, func() {
		o.mu.Lock()
		started := !o.start.IsZero()
		o.mu.Unlock()
		if !started {
			o.finish("no-frames")
		}
	})
	time.AfterFunc(obTotal*time.Millisecond+2500*time.Millisecond, func() { o.finish("timer") })
	if dir := os.Getenv("POPMIND_ONBOARDING_CAPTURE"); dir != "" && mygo.IsDev() {
		go o.capture(dir)
	}
}

// prepare opens the real launcher under the intro, transparent, its footer's logo hidden while the intro's
// flies there.
func (o *Onboarding) prepare() {
	l := o.app.Launcher
	l.panel.Update(func() { l.introLogo = true })
	l.ShowTransparent()
	logx.Info("[onboarding] launcher ready", "intro", o.win.Bounds(), "launcher", l.panel.Bounds(), "planned", o.launcher)
}

// fadeIn brings the launcher in over ms, as the logo flies onto it.
func (o *Onboarding) fadeIn(ms int) {
	o.app.Launcher.FadeIn(ms)
	logx.Info("[onboarding] launcher fading in", "ms", ms)
}

// finish ends the intro: the launcher shows (already, unless skipped) with its own logo back, and the intro
// closes over it.
func (o *Onboarding) finish(reason string) {
	o.once.Do(func() {
		o.prepareOnce.Do(o.prepare)
		o.mu.Lock()
		frames, gap, gapAt := o.frames, o.maxGap, o.gapAt
		o.mu.Unlock()
		logx.Info("[onboarding] done", "reason", reason, "ms", time.Since(o.shownAt).Milliseconds(),
			"frames", frames, "maxGapMs", gap.Milliseconds(), "gapAtMs", gapAt.Milliseconds())
		l := o.app.Launcher
		l.panel.Update(func() { l.introLogo = false })
		if !l.Visible() { // hidden meanwhile (a click on the intro takes its focus away)
			l.Show("")
		} else {
			o.fadeOnce.Do(func() { o.fadeIn(120) }) // skipped before the fade began
		}
		time.AfterFunc(140*time.Millisecond, o.win.Close)
	})
}

func (o *Onboarding) view(c *ui.Context) {
	t := Look(c)
	c.Root().Background(ui.Color{})
	if c.Shortcut(0, ui.KeyEscape) || c.Shortcut(0, ui.KeyEnter) {
		go o.finish("key")
	}
	stage := ui.Box(c).Fill()
	if stage.Clicked() {
		go o.finish("click")
	}
	stage.Draw(func(p *ui.Painter, r ui.Rect) {
		o.mu.Lock()
		now := time.Now()
		if !o.lastAt.IsZero() && now.Sub(o.lastAt) > o.maxGap {
			o.maxGap = now.Sub(o.lastAt)
			o.gapAt = now.Sub(o.start)
		}
		o.lastAt = now
		o.frames++
		if o.start.IsZero() {
			o.start = p.Now()
			logx.Info("[onboarding] first frame", "afterShowMs", time.Since(o.shownAt).Milliseconds(), "gpu", p.Accelerated())
		}
		o.mu.Unlock()
		ms := float32(p.Now().Sub(o.start).Milliseconds())
		if ms < obTotal {
			p.AnimationFrame()
		} else {
			go o.finish("end")
		}
		o.paint(p, r, t, ms)
	})
}

// progress is how far ms is through [from, from+dur], 0 to 1.
func progress(ms, from, dur float32) float32 { return max(0, min(1, (ms-from)/dur)) }

func easeOutCubic(t float32) float32 { u := 1 - t; return 1 - u*u*u }

func easeInOutCubic(t float32) float32 {
	if t < 0.5 {
		return 4 * t * t * t
	}
	u := -2*t + 2
	return 1 - u*u*u/2
}

// easeOutBack overshoots a little before it settles.
func easeOutBack(t float32) float32 {
	const c1, c3 = 1.4, 2.4
	u := t - 1
	return 1 + c3*u*u*u + c1*u*u
}

func lerp(a, b, t float32) float32 { return a + (b-a)*t }

// bump rises from 0 to 1 and back over [from, from+dur].
func bump(ms, from, dur float32) float32 {
	return float32(math.Sin(float64(progress(ms, from, dur)) * math.Pi))
}

// inkColor is the logo's color: near black, or near white in dark mode.
func inkColor(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.RGB(248, 248, 250)
	}
	return ui.RGB(20, 20, 22)
}

// stageRect is where the launcher will be, in r.
func (o *Onboarding) stageRect(r ui.Rect) ui.Rect {
	o.mu.Lock()
	at := o.launcher
	o.mu.Unlock()
	if at.W > 0 {
		return ui.Rect{X: r.X + at.X, Y: r.Y + at.Y, W: at.W, H: at.H}
	}
	return ui.Rect{X: r.X + (r.W-launcherWidth)/2, Y: r.Y + (r.H-launcherHeight)/2, W: launcherWidth, H: launcherHeight}
}

// paint draws the intro at ms into r (the window).
func (o *Onboarding) paint(p *ui.Painter, r ui.Rect, t *ui.Theme, ms float32) {
	ink := inkColor(t)
	stage := o.stageRect(r)
	cx, cy := stage.X+stage.W/2, stage.Y+stage.H/2
	ex := easeInOutCubic(progress(ms, obExpand, obExpandDur))

	// The aurora: in, a swell as the logo settles, out as the launcher comes.
	if p.Accelerated() || o.forceGlow {
		secs := float64(ms) / 1000
		breath := 0.5 + 0.5*math.Sin(secs*2*math.Pi/obBreath-math.Pi/2)
		level := easeOutCubic(progress(ms, 0, obGlowIn)) * (1 + 0.35*bump(ms, obMorphStart+obMorphDur-250, 900)) *
			(1 - easeOutCubic(progress(ms, obExpand, obExpandDur*0.8)))
		dark := float32(0)
		if t.Dark {
			dark = 1
		}
		colors := make([]float32, 0, 20)
		for _, c := range glowColors {
			colors = append(colors, float32(c.R)/255, float32(c.G)/255, float32(c.B)/255, 1)
		}
		aurora.Draw(p, r, shader.Options{Uniforms: map[string]any{
			"Time": float32(secs) + 2, "Level": level, "Breath": float32(breath),
			"Center": []float32{cx - r.X, cy - r.Y - obLogoRise/2}, "Dark": dark, "Colors": colors,
		}})
	}

	// The real launcher opens, transparent, under the intro while the logo rests, and fades in as the logo
	// flies onto its spot (its own logo held back until this one lands).
	if ms >= obExpand-obPrepare {
		o.prepareOnce.Do(func() { go o.prepare() })
	}
	if ms >= obExpand {
		o.fadeOnce.Do(func() { go o.fadeIn(obExpandDur) })
	}

	// The word, written letter by letter, drawing slowly nearer as it is written.
	ws := float32(obWordScale) * (1 + 0.035*easeOutCubic(progress(ms, obWriteStart, 2600)))
	ww := wordWidth(o.word) * ws
	word := xform{s: ws, x: cx - ww/2, y: cy - obLogoRise + wordXHeight/2*ws}
	stroke := wordStroke * ws
	fade := easeOutCubic(progress(ms, obFadeStart, obFadeDur))
	mo := easeInOutCubic(progress(ms, obMorphStart, obMorphDur))
	for i, g := range o.word {
		if (i == 0 || i == 3) && ms >= obMorphStart {
			continue // the morph draws these from now on
		}
		drawn := easeInOutCubic(progress(ms, float32(obWriteStart+i*obLetterGap), obLetterDur))
		if drawn <= 0 {
			continue
		}
		alpha, dy := float32(1), float32(0)
		if i != 0 && i != 3 {
			alpha = 1 - fade
			dy = 10 * fade
		}
		if alpha <= 0 {
			continue
		}
		f := xform{s: ws, x: word.x + o.offset[i]*ws, y: word.y + dy}
		var path ui.Path
		for _, s := range g.strokes {
			s.appendTo(&path, f)
		}
		p.StrokePath(path.Trim(0, drawn), stroke, ink.Alpha(alpha))
		if g.dot != nil {
			if pop := progress(ms, float32(obWriteStart+i*obLetterGap+obLetterDur-140), 260); pop > 0 {
				x, y := f.at(*g.dot)
				var dot ui.Path
				p.FillPath(dot.Circle(x, y, stroke*0.62*easeOutBack(pop)), ink.Alpha(alpha))
			}
		}
	}

	// The "p" opens into the logo's bubble while the "M" moves into it and turns into the logo's "m"; then the
	// logo flies to the launcher's footer.
	if ms >= obMorphStart {
		size := obLogoSize * (1 + 0.04*bump(ms, obMorphStart+obMorphDur-120, 420))
		lx, ly := cx, cy-obLogoRise
		// The footer's logo: 18 points, 18 from the launcher's left, centered in its 40-point footer.
		size = lerp(size, 18, ex)
		lx = lerp(lx, stage.X+obFooterLogoX, ex)
		ly = lerp(ly, stage.Y+stage.H-obFooterLogoB, ex)
		logo := xform{s: size / 100, x: lx - size/2, y: ly - size/2}
		width := lerp(stroke, logoStroke*size/100, max(mo, ex))
		pf := xform{s: ws, x: word.x + o.offset[0]*ws, y: word.y}
		p.StrokePath(polyline(morph(place(o.pFrom, pf), place(o.pTo, logo), mo)), width, ink)
		// The "M": first carried into the bubble as it is (fitted to the "m"'s box), then reshaped.
		mv := easeInOutCubic(progress(ms, obMorphStart, obMMove))
		sh := easeInOutCubic(progress(ms, obMorphStart+obMShapeAt, obMShapeDur))
		mf := xform{s: ws, x: word.x + o.offset[3]*ws, y: word.y}
		mPts := morph(morph(place(o.mFrom, mf), place(o.mFit, logo), mv), place(o.mTo, logo), sh)
		p.StrokePath(polyline(mPts), lerp(stroke, logoStroke*size/100, max(sh, ex)), ink)

		// The name under the logo, in the system font, until the launcher comes.
		mark := easeOutCubic(progress(ms, obMarkStart, 420)) * (1 - easeOutCubic(progress(ms, obExpand, 260)))
		if mark > 0 {
			name := ui.Span{Text: "popMind", Size: 34, Weight: 700, Color: ink.Alpha(mark)}
			w, _ := p.MeasureText(0, name)
			top := cy - obLogoRise + obLogoSize/2 + 26 + 10*(1-mark)
			p.RichText(cx-w/2, top, 0, name)
			tag := ui.Span{Text: i18n.T("onboarding.tagline"), Size: 15, Weight: 500, Color: t.TextMuted.Alpha(mark)}
			w, _ = p.MeasureText(0, tag)
			p.RichText(cx-w/2, top+50, 0, tag)
		}
	}
}

// capture saves PNGs of the intro window as it plays (development checks).
func (o *Onboarding) capture(dir string) {
	for _, at := range []int{900, 1800, 2700, 3300, 3900, 4700} {
		time.Sleep(time.Until(o.shownAt.Add(time.Duration(at) * time.Millisecond)))
		png, err := o.win.CapturePage()
		if err == nil {
			err = os.WriteFile(filepath.Join(dir, fmt.Sprintf("intro-%04d.png", at)), png, 0o644)
		}
		logx.Info("[onboarding] capture", "at", at, "err", err)
	}
}
