// Package calc evaluates the launcher calculator's arithmetic: + - * / % and parentheses, as the Electron
// app's CalculatorPanel does.
package calc

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// Result is an evaluated expression.
type Result struct {
	Expression string
	Value      float64
	// Formatted is the value as shown: integers with thousands separators, decimals to 10 places without
	// trailing zeros.
	Formatted string
	// Err is set when the expression cannot be evaluated; it is a key of the views' messages.
	Err string
}

var (
	allowed  = regexp.MustCompile(`^[\d+\-*/().,\s%]+$`)
	operator = regexp.MustCompile(`\d\s*[+\-*/%]\s*[\d(]|^\s*[(-]`)
)

// Normalize turns the symbols people type (×, ÷, full-width brackets) into the parser's.
func Normalize(s string) string {
	return strings.NewReplacer("×", "*", "x", "*", "X", "*", "÷", "/", "（", "(", "）", ")", "，", ",").
		Replace(strings.TrimSpace(s))
}

// LooksLikeMath reports whether s is arithmetic worth evaluating without the /cal alias: digits with at least
// one operator.
func LooksLikeMath(s string) bool {
	e := Normalize(s)
	return e != "" && allowed.MatchString(e) && operator.MatchString(e) && strings.ContainsAny(e, "0123456789")
}

// Eval evaluates s.
func Eval(s string) Result {
	expr := Normalize(s)
	r := Result{Expression: expr}
	if expr == "" {
		return r
	}
	if !allowed.MatchString(expr) {
		r.Err = "calc.unsupported"
		return r
	}
	p := &parser{s: strings.ReplaceAll(expr, ",", "")}
	v, err := p.expression()
	if err == nil {
		p.skip()
		if p.i != len(p.s) {
			err = errors.New("trailing characters")
		}
	}
	if err != nil {
		r.Err = "calc.invalid"
		return r
	}
	if math.IsInf(v, 0) || math.IsNaN(v) {
		r.Err = "calc.badResult"
		return r
	}
	r.Value = v
	r.Formatted = Format(v)
	return r
}

// Format formats a result as the Electron app does.
func Format(v float64) string {
	if v == math.Trunc(v) && math.Abs(v) < 1e21 {
		s := strconv.FormatFloat(math.Abs(v), 'f', 0, 64)
		var b strings.Builder
		if v < 0 {
			b.WriteByte('-')
		}
		for i, ch := range s {
			if i > 0 && (len(s)-i)%3 == 0 {
				b.WriteByte(',')
			}
			b.WriteRune(ch)
		}
		return b.String()
	}
	s := strconv.FormatFloat(v, 'f', 10, 64)
	s = strings.TrimRight(s, "0")
	return strings.TrimSuffix(s, ".")
}

type parser struct {
	s string
	i int
}

func (p *parser) skip() {
	for p.i < len(p.s) && p.s[p.i] == ' ' {
		p.i++
	}
}

func (p *parser) peek() byte {
	p.skip()
	if p.i < len(p.s) {
		return p.s[p.i]
	}
	return 0
}

func (p *parser) number() (float64, error) {
	p.skip()
	start, dot := p.i, false
	for p.i < len(p.s) {
		ch := p.s[p.i]
		if ch == '.' {
			if dot {
				break
			}
			dot = true
		} else if ch < '0' || ch > '9' {
			break
		}
		p.i++
	}
	if start == p.i || p.s[start:p.i] == "." {
		return 0, errors.New("expected number")
	}
	return strconv.ParseFloat(p.s[start:p.i], 64)
}

func (p *parser) factor() (float64, error) {
	switch p.peek() {
	case '+':
		p.i++
		return p.factor()
	case '-':
		p.i++
		v, err := p.factor()
		return -v, err
	case '(':
		p.i++
		v, err := p.expression()
		if err != nil {
			return 0, err
		}
		if p.peek() != ')' {
			return 0, errors.New("missing )")
		}
		p.i++
		return v, nil
	}
	return p.number()
}

func (p *parser) term() (float64, error) {
	v, err := p.factor()
	for err == nil {
		op := p.peek()
		if op != '*' && op != '/' && op != '%' {
			return v, nil
		}
		p.i++
		var r float64
		if r, err = p.factor(); err != nil {
			break
		}
		switch op {
		case '*':
			v *= r
		case '/':
			v /= r
		default:
			v = math.Mod(v, r)
		}
	}
	return 0, err
}

func (p *parser) expression() (float64, error) {
	v, err := p.term()
	for err == nil {
		op := p.peek()
		if op != '+' && op != '-' {
			return v, nil
		}
		p.i++
		var r float64
		if r, err = p.term(); err != nil {
			break
		}
		if op == '+' {
			v += r
		} else {
			v -= r
		}
	}
	return 0, err
}
