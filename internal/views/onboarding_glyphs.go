package views

import (
	"math"

	"github.com/egoist/mygo/ui"
)

// The lettering of the first-run intro: "popMind" written as single strokes (a rounded monoline script,
// in the hand of the logo's "m"), and the logo drawn as two strokes, the "p" that is its speech bubble and
// the "m" inside it. The intro writes the word, then morphs its "p" and "M" into the logo's strokes.

type pt struct{ X, Y float32 }

func lerpPt(a, b pt, t float32) pt { return pt{a.X + (b.X-a.X)*t, a.Y + (b.Y-a.Y)*t} }

// cubic is a Bézier segment after the current point.
type cubic struct{ c1, c2, to pt }

// subpath is a continuous stroke: a start and the segments after it.
type subpath struct {
	from pt
	segs []cubic
}

// glyph is a letter's strokes, drawn one after another, plus an optional dot (the i's).
type glyph struct {
	strokes []subpath
	advance float32
	dot     *pt
}

// pen builds a subpath.
type pen struct{ s subpath }

func penAt(x, y float32) *pen { return &pen{s: subpath{from: pt{x, y}}} }

func (p *pen) last() pt {
	if n := len(p.s.segs); n > 0 {
		return p.s.segs[n-1].to
	}
	return p.s.from
}

// line is a straight segment, kept as a cubic so all segments sample alike.
func (p *pen) line(x, y float32) *pen {
	a, b := p.last(), pt{x, y}
	p.s.segs = append(p.s.segs, cubic{lerpPt(a, b, 1.0/3), lerpPt(a, b, 2.0/3), b})
	return p
}

func (p *pen) curve(c1x, c1y, c2x, c2y, x, y float32) *pen {
	p.s.segs = append(p.s.segs, cubic{pt{c1x, c1y}, pt{c2x, c2y}, pt{x, y}})
	return p
}

// ellipse quarters: from the current point around (cx, cy) by rx, ry, through the given compass points.
const kappa = 0.5523

// arc adds a quarter of an ellipse from the current point to (x, y), bulging the way the quarter turns:
// horizontalFirst says the tangent at the start is horizontal (leaving the top or bottom).
func (p *pen) arc(x, y float32, horizontalFirst bool) *pen {
	a := p.last()
	dx, dy := x-a.X, y-a.Y
	if horizontalFirst {
		return p.curve(a.X+dx*kappa, a.Y, x, y-dy*kappa, x, y)
	}
	return p.curve(a.X, a.Y+dy*kappa, x-dx*kappa, y, x, y)
}

func (p *pen) done() subpath { return p.s }

// Word metrics, in letter units: the baseline at y = 0, the x-height at -40, capitals at -62, descenders to 24.
const (
	wordXHeight = 40
	wordStroke  = 6.2
)

// wordSlant leans the word's letters forward, as handwriting does (and as the logo's "m").
const wordSlant = 0.12

// wordGlyphs is "popMind".
func wordGlyphs() []glyph {
	bowlP := func() glyph {
		s := penAt(2, 24).line(2, -20).
			arc(17, -40, false).arc(32, -20, true).arc(17, 0, false).
			curve(10, 0, 5, -2, 2, -6).done()
		return glyph{strokes: []subpath{s}, advance: 39}
	}
	o := glyph{strokes: []subpath{penAt(16, -40).arc(1, -20, true).arc(16, 0, false).arc(31, -20, true).arc(16, -40, false).done()}, advance: 38}
	m := glyph{strokes: []subpath{penAt(1, 0).line(6, -55).
		curve(7, -61, 12, -63, 14, -58).line(21, -27).line(28, -58).
		curve(30, -63, 35, -62, 36, -55).line(40, 0).done()}, advance: 49}
	dot := pt{4, -55}
	i := glyph{strokes: []subpath{penAt(4, -38).line(4, 0).done()}, advance: 15, dot: &dot}
	n := glyph{strokes: []subpath{
		penAt(2, -40).line(2, 0).done(),
		penAt(2, -25).curve(4.5, -36, 10, -40, 16.5, -40).curve(25, -40, 29, -34.5, 29, -25).line(29, 0).done(),
	}, advance: 38}
	d := glyph{strokes: []subpath{
		penAt(29, -20).arc(15, -40, false).arc(1, -20, true).arc(15, 0, false).arc(29, -20, true).done(),
		penAt(29, -64).line(29, 0).done(),
	}, advance: 31}
	gs := []glyph{bowlP(), o, bowlP(), m, i, n, d}
	lean := func(p pt) pt { return pt{p.X - p.Y*wordSlant, p.Y} }
	for gi := range gs {
		g := &gs[gi]
		for si := range g.strokes {
			st := &g.strokes[si]
			st.from = lean(st.from)
			for ci := range st.segs {
				c := &st.segs[ci]
				c.c1, c.c2, c.to = lean(c.c1), lean(c.c2), lean(c.to)
			}
		}
		if g.dot != nil {
			d := lean(*g.dot)
			g.dot = &d
		}
	}
	return gs
}

// wordWidth is the advance of the word, in letter units, without the last letter's spacing.
func wordWidth(gs []glyph) float32 {
	var w float32
	for i, g := range gs {
		if i == len(gs)-1 {
			w += 31
		} else {
			w += g.advance
		}
	}
	return w
}

// Logo strokes, in a 100×100 box (resources/icon.png scaled to 100), drawn this wide.
const logoStroke = 9.6

// logoBubble is the "p" of the logo: the stem from the tail up, then the bubble around, back to the tail.
func logoBubble() subpath {
	return penAt(8.6, 91).line(8.6, 50).
		arc(50.5, 8.6, false).arc(92.4, 50, true).
		curve(92.4, 72, 77, 86.5, 54, 86.5).
		curve(36, 86.5, 22, 82.5, 10, 90).done()
}

// logoM is the "m" inside, as one stroke (each leg is gone back up before the next arch).
func logoM() subpath {
	return penAt(18, 35.5).
		curve(21, 32, 25, 30.5, 28, 32.5).
		curve(30.5, 34.5, 31, 38.5, 30.5, 43).
		line(26.5, 62.5).line(30.5, 43).
		curve(34, 36, 39, 31.5, 44.5, 31.5).
		curve(49.5, 31.5, 51.5, 35.5, 50.5, 42).
		line(46.5, 62.5).line(50.5, 42).
		curve(54, 35.5, 59, 31.5, 64.5, 31.5).
		curve(69.5, 31.5, 71.5, 35.5, 70.5, 42).
		curve(69.5, 47.5, 66.5, 53, 66.5, 58.5).
		curve(66.5, 63.5, 70, 65, 74.5, 64).
		curve(79.5, 63, 83.5, 59.5, 87, 56).done()
}

// xform maps glyph units to the window: scale then offset.
type xform struct{ s, x, y float32 }

func (f xform) at(p pt) (float32, float32) { return f.x + p.X*f.s, f.y + p.Y*f.s }

// appendTo adds s to path through f.
func (s subpath) appendTo(path *ui.Path, f xform) {
	path.MoveTo(f.at(s.from))
	for _, c := range s.segs {
		x1, y1 := f.at(c.c1)
		x2, y2 := f.at(c.c2)
		x, y := f.at(c.to)
		path.CubeTo(x1, y1, x2, y2, x, y)
	}
}

func (c cubic) eval(from pt, t float32) pt {
	u := 1 - t
	a, b, d, e := u*u*u, 3*u*u*t, 3*u*t*t, t*t*t
	return pt{a*from.X + b*c.c1.X + d*c.c2.X + e*c.to.X, a*from.Y + b*c.c1.Y + d*c.c2.Y + e*c.to.Y}
}

// sample returns n points along s, evenly spaced by length, for morphing one stroke into another.
func (s subpath) sample(n int) []pt {
	// A fine polyline first, then points along it at even lengths.
	if len(s.segs) == 0 { // a point: every sample is it
		out := make([]pt, n)
		for i := range out {
			out[i] = s.from
		}
		return out
	}
	var fine []pt
	cur := s.from
	fine = append(fine, cur)
	for _, c := range s.segs {
		for k := 1; k <= 24; k++ {
			fine = append(fine, c.eval(cur, float32(k)/24))
		}
		cur = c.to
	}
	lengths := make([]float32, len(fine))
	for i := 1; i < len(fine); i++ {
		dx, dy := fine[i].X-fine[i-1].X, fine[i].Y-fine[i-1].Y
		lengths[i] = lengths[i-1] + float32(math.Hypot(float64(dx), float64(dy)))
	}
	total := lengths[len(lengths)-1]
	out := make([]pt, n)
	j := 1
	for i := range n {
		want := total * float32(i) / float32(n-1)
		for j < len(fine)-1 && lengths[j] < want {
			j++
		}
		seg := lengths[j] - lengths[j-1]
		t := float32(0)
		if seg > 0 {
			t = (want - lengths[j-1]) / seg
		}
		out[i] = lerpPt(fine[j-1], fine[j], max(0, min(1, t)))
	}
	return out
}

// polyline is a path through points.
func polyline(points []pt) *ui.Path {
	var path ui.Path
	for i, p := range points {
		if i == 0 {
			path.MoveTo(p.X, p.Y)
		} else {
			path.LineTo(p.X, p.Y)
		}
	}
	return &path
}

// morph moves points a toward b by t, both already in window coordinates.
func morph(a, b []pt, t float32) []pt {
	out := make([]pt, len(a))
	for i := range a {
		out[i] = lerpPt(a[i], b[i], t)
	}
	return out
}

// place maps points through f.
func place(points []pt, f xform) []pt {
	out := make([]pt, len(points))
	for i, p := range points {
		x, y := f.at(p)
		out[i] = pt{x, y}
	}
	return out
}

// mParts pairs the parts of the word's "M" with those of the logo's "m", as ranges of their segments: the
// up-stroke with the lead-in, the first peak with the first shoulder, the first down-stroke with the first
// leg, the climb with the way back up and the second arch, the second peak with its shoulder, and the last
// down-stroke with the second leg. The rest of the "m" (the third arch, the curl and the tail) has no part
// of the "M": it grows out of the end of the last down-stroke, as if written on from there.
var mParts = [][2][2]int{
	{{0, 1}, {0, 1}},
	{{1, 2}, {1, 2}},
	{{2, 3}, {2, 3}},
	{{3, 4}, {3, 5}},
	{{4, 5}, {5, 6}},
	{{5, 6}, {6, 7}},
	{{6, 6}, {7, 13}},
}

// part is the segments [from, to) of s as a subpath of its own.
func (s subpath) part(from, to int) subpath {
	start := s.from
	if from > 0 {
		start = s.segs[from-1].to
	}
	return subpath{from: start, segs: s.segs[from:to]}
}

func (s subpath) length() float32 {
	pts := s.sample(64)
	var l float32
	for i := 1; i < len(pts); i++ {
		l += float32(math.Hypot(float64(pts[i].X-pts[i-1].X), float64(pts[i].Y-pts[i-1].Y)))
	}
	return l
}

// matchStrokes samples a and b part by part (parts pairs their segment ranges), about n points in all, shared
// out by the lengths of b's parts, so that each part of a turns into its partner in b.
func matchStrokes(a, b subpath, parts [][2][2]int, n int) (pa, pb []pt) {
	var total float32
	lengths := make([]float32, len(parts))
	for i, pr := range parts {
		lengths[i] = b.part(pr[1][0], pr[1][1]).length()
		total += lengths[i]
	}
	for i, pr := range parts {
		k := max(4, int(float32(n)*lengths[i]/total))
		sa := a.part(pr[0][0], pr[0][1]).sample(k)
		sb := b.part(pr[1][0], pr[1][1]).sample(k)
		if i > 0 { // the joint is the last point of the part before
			sa, sb = sa[1:], sb[1:]
		}
		pa, pb = append(pa, sa...), append(pb, sb...)
	}
	return pa, pb
}

type box struct{ x, y, w, h float32 }

func bounds(pts []pt) box {
	x0, y0, x1, y1 := pts[0].X, pts[0].Y, pts[0].X, pts[0].Y
	for _, p := range pts {
		x0, y0, x1, y1 = min(x0, p.X), min(y0, p.Y), max(x1, p.X), max(y1, p.Y)
	}
	return box{x0, y0, x1 - x0, y1 - y0}
}

// fitTo scales and moves pts into b.
func fitTo(pts []pt, b box) []pt {
	from := bounds(pts)
	out := make([]pt, len(pts))
	for i, p := range pts {
		out[i] = pt{b.x + (p.X-from.x)/from.w*b.w, b.y + (p.Y-from.y)/from.h*b.h}
	}
	return out
}
