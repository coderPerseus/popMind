package views

import (
	"math"
	"math/rand/v2"
	"slices"
	"time"

	"github.com/egoist/mygo/ui"

	"popmind/internal/settings"
)

// The glow of an AI reply being written, after myGo's chat-glow example (itself after Apple Intelligence's),
// toned down for popMind: cooler colors near the system accent, a thinner and fainter edge, slower color drift,
// and the composer's border in the same flowing colors instead of a ring. It fades in as the reply starts and
// out as it ends, holds still under Reduce Motion, draws only on the GPU, and is off when the user turns it off
// (settings: AI glow).

// glowColors go around the window: system blue, indigo, purple, a soft pink and sky blue.
var glowColors = []ui.Color{
	ui.Hex("#0A84FF"), ui.Hex("#5E5CE6"), ui.Hex("#BF5AF2"), ui.Hex("#FF7AB6"), ui.Hex("#64D2FF"),
}

const (
	glowFadeIn, glowFadeOut   = 0.25, 0.6 // seconds
	glowShuffle, glowMoveTime = 0.9, 1.4  // a new place for the colors every glowShuffle s, reached over glowMoveTime s
	glowMaxOpacity            = 0.7
)

// glowLayers are the edge's strokes inside the window's outline: a crisp line and two blurred ones.
var glowLayers = []struct{ width, blur float32 }{{2, 0}, {4, 3}, {6, 7}}

// Glow is the state of one window's glow.
type Glow struct {
	level float64 // 0 (none) to 1 (full)
	now   float64 // the glow's clock, in seconds
	last  time.Time
	gpu   bool
	stops glowStops
}

// Step moves the glow on to the frame's time, toward full while busy and none after, and asks for frames while
// it changes. Call once a frame, before Edge and Border.
func (g *Glow) Step(c *ui.Context, busy bool) {
	if g.stops.from == nil {
		g.stops = newGlowStops()
	}
	now := c.Now()
	dt := 0.0
	if !g.last.IsZero() {
		dt = min(max(now.Sub(g.last).Seconds(), 0), 0.25)
	}
	g.last = now
	g.now += dt
	on := busy && settings.Capabilities.Get().AIGlowOn()
	if on {
		g.level = min(1, g.level+dt/glowFadeIn)
	} else {
		g.level = max(0, g.level-dt/glowFadeOut)
	}
	still := c.Preferences().ReduceMotion
	if g.level > 0 && !still {
		g.stops.step(g.now)
	}
	if on || g.level > 0 {
		c.AnimationFrame()
	}
}

func (g *Glow) shows() bool { return g.level > 0.001 && g.gpu }

// Edge draws the window's edge glowing, over everything, the pointer going through it: radius is the window's
// corner radius. Call last among the children of the window's root.
func (g *Glow) Edge(c *ui.Context, radius float32) {
	// Whether the window draws on a GPU, for the next frames: blurring the window's edge each frame costs too
	// much without one.
	ui.Box(c.Key("glow-probe")).Absolute().Top(0).Left(0).Size(1, 1).PassThrough().
		Draw(func(p *ui.Painter, r ui.Rect) { g.gpu = p.Accelerated() })
	if !g.shows() {
		return
	}
	grad := ui.ConicGradient{Stops: g.stops.gradient(g.now), Angle: 90, Oklab: true}
	ui.Box(c.Key("glow-edge")).Absolute().Top(0).Left(0).Right(0).Bottom(0).PassThrough().
		Opacity(float32(smooth(g.level) * glowMaxOpacity)).Children(func() {
		for _, l := range glowLayers {
			ui.Box(c).Absolute().Top(0).Left(0).Right(0).Bottom(0).PassThrough().Radius(radius).
				Border(l.width, ui.Color{}).BorderConicGradient(grad).Blur(0.95 * l.blur)
		}
	})
}

// Glowing reports whether the glow shows, so that the composer leaves its own focus border off.
func (g *Glow) Glowing() bool { return g.shows() && g.level >= 0.05 }

// Outline draws a border in the glow's colors over the element it is built in (the composer's frame), whose
// corners are radius, fading with the glow. Call last among the element's children.
func (g *Glow) Outline(c *ui.Context, radius float32) {
	if !g.Glowing() {
		return
	}
	ui.Box(c.Key("glow-outline")).Absolute().Top(0).Left(0).Right(0).Bottom(0).PassThrough().Radius(radius).
		Opacity(float32(smooth(g.level))).Border(1.2, ui.Color{}).
		BorderConicGradient(ui.ConicGradient{Stops: g.stops.gradient(g.now), Angle: 90, Oklab: true})
}

func smooth(x float64) float64 { return x * x * (3 - 2*x) }

// glowStop is a color of the gradient, in Oklab (where it blends), and where it lies around the window (0–1).
type glowStop struct{ l, a, b, at float64 }

// glowStops move the colors about: every glowShuffle seconds they head for places picked at random.
type glowStops struct {
	from, to    []glowStop
	since, next float64
}

func newGlowStops() glowStops {
	s := glowStops{}
	s.to = s.shuffle()
	s.from = s.to
	return s
}

func (s *glowStops) shuffle() []glowStop {
	out := make([]glowStop, len(glowColors))
	for i, c := range glowColors {
		l, a, b := oklab(c)
		out[i] = glowStop{l, a, b, rand.Float64()}
	}
	slices.SortFunc(out, func(x, y glowStop) int {
		switch {
		case x.at < y.at:
			return -1
		case x.at > y.at:
			return 1
		}
		return 0
	})
	return out
}

func (s *glowStops) step(now float64) {
	if now < s.next {
		return
	}
	s.from = s.show(now)
	s.to, s.since, s.next = s.shuffle(), now, now+glowShuffle
}

func (s *glowStops) show(now float64) []glowStop {
	k := smooth(min(max((now-s.since)/glowMoveTime, 0), 1))
	out := make([]glowStop, len(s.to))
	for i := range out {
		f, t := s.from[i], s.to[i]
		out[i] = glowStop{f.l + (t.l-f.l)*k, f.a + (t.a-f.a)*k, f.b + (t.b-f.b)*k, f.at + (t.at-f.at)*k}
	}
	return out
}

// gradient is the stops as a conic gradient's, with the color between the last and the first at both ends, so
// that the colors go round without a seam.
func (s *glowStops) gradient(now float64) []ui.GradientStop {
	st := s.show(now)
	first, last := st[0], st[len(st)-1]
	k := (1 - last.at) / max(first.at+1-last.at, 1e-6)
	seam := fromOklab(last.l+(first.l-last.l)*k, last.a+(first.a-last.a)*k, last.b+(first.b-last.b)*k)
	out := make([]ui.GradientStop, 0, len(st)+2)
	out = append(out, ui.GradientStop{Color: seam, At: 0})
	for _, x := range st {
		out = append(out, ui.GradientStop{Color: fromOklab(x.l, x.a, x.b), At: float32(x.at)})
	}
	return append(out, ui.GradientStop{Color: seam, At: 1})
}

func fromOklab(l, a, b float64) ui.Color {
	lc := l + 0.3963377774*a + 0.2158037573*b
	mc := l - 0.1055613458*a - 0.0638541728*b
	sc := l - 0.0894841775*a - 1.2914855480*b
	lc, mc, sc = lc*lc*lc, mc*mc*mc, sc*sc*sc
	enc := func(v float64) uint8 {
		v = min(max(v, 0), 1)
		if v <= 0.0031308 {
			v *= 12.92
		} else {
			v = 1.055*math.Pow(v, 1/2.4) - 0.055
		}
		return uint8(math.Round(v * 255))
	}
	return ui.RGB(enc(4.0767416621*lc-3.3077115913*mc+0.2309699292*sc),
		enc(-1.2684380046*lc+2.6097574011*mc-0.3413193965*sc),
		enc(-0.0041960863*lc-0.7034186147*mc+1.7076147010*sc))
}

func oklab(c ui.Color) (l, a, b float64) {
	lin := func(v uint8) float64 {
		x := float64(v) / 255
		if x <= 0.04045 {
			return x / 12.92
		}
		return math.Pow((x+0.055)/1.055, 2.4)
	}
	r, g, bl := lin(c.R), lin(c.G), lin(c.B)
	lc := math.Cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*bl)
	mc := math.Cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*bl)
	sc := math.Cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*bl)
	return 0.2104542553*lc + 0.7936177850*mc - 0.0040720468*sc,
		1.9779984951*lc - 2.4285922050*mc + 0.4505937099*sc,
		0.0259040371*lc + 0.7827717662*mc - 0.8086757660*sc
}
