// Package chat is the explain conversation started from a selection or the launcher: the first turn explains
// the text, follow-ups continue it, replies stream in, and web search adds context when it is on
// (lib/selection-chat/service.ts and lib/explain/runner.ts).
package chat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"

	"popmind/internal/ai"
	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/settings"
	"popmind/internal/websearch"
)

const (
	requestTimeout = 60 * time.Second
	searchTimeout  = 12 * time.Second
)

// Message is one turn.
type Message struct {
	ID      string
	Role    string // "user" or "assistant"
	Text    string
	Sources []websearch.Result
	Err     string
	// Done is false while the reply streams in.
	Done bool
	// Stopped is set when the user stopped the reply.
	Stopped bool
}

// ModeChat is a plain conversation with the model (the launcher's /ai): no selection, the turns sent as they are.
const ModeChat = "chat"

// chatRequest is a plain conversation: every turn with text, the web search context added to the last question.
func chatRequest(history []Message, sources []websearch.Result) ai.Request {
	var msgs []ai.Message
	for _, h := range history {
		if strings.TrimSpace(h.Text) == "" || (h.Role != "user" && h.Role != "assistant") {
			continue
		}
		msgs = append(msgs, ai.Message{Role: h.Role, Content: h.Text})
	}
	if n := len(msgs); n > 0 && len(sources) > 0 && msgs[n-1].Role == "user" {
		var ctx []string
		for i, r := range sources {
			ctx = append(ctx, fmt.Sprintf("%d. %s\n%s\n%s", i+1, r.Title, r.URL, r.Snippet))
		}
		msgs[n-1].Content += "\n\n" + i18n.T("prompt.explain.user.search", "context", strings.Join(ctx, "\n\n"))
	}
	return ai.Request{System: i18n.T("prompt.chat.system"), Messages: msgs}
}

// Status of a session.
const (
	StatusReady     = "ready"
	StatusSearching = "searching"
	StatusStreaming = "streaming"
	StatusError     = "error"
)

// Session is one conversation. Its fields are read by the view on the main thread; changes come through
// Update, which the window provides.
type Session struct {
	// Update runs fn on the main thread and redraws.
	Update func(fn func())

	Mode          string // "explain" or "ask"
	SelectionText string
	SourceApp     string
	Messages      []*Message
	Status        string
	Err           string
	WebSearch     bool
	Provider      string
	ModelID       string
	// SearchProvider is the web search provider of the last reply.
	SearchProvider string
	// ImageState says what became of the capture of the source window: "" (none), "sent" (the model saw it)
	// or "unsupported" (the model takes no images, so only the text went).
	ImageState string

	image  []byte
	mu     sync.Mutex
	runID  int
	cancel context.CancelFunc
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Start begins a session about text; explain mode answers at once. image is a screenshot of the source app.
func Start(update func(func()), mode, text, sourceApp string, image []byte) *Session {
	c := settings.Capabilities.Get()
	s := &Session{Update: update, Mode: mode, SelectionText: strings.TrimSpace(text), SourceApp: sourceApp,
		Status: StatusReady, image: image}
	// Web search is on when the settings turn it on by default and a provider has a key.
	if p, _ := websearch.Configured(c); p != "" {
		s.WebSearch = c.WebSearch.Enabled
	}
	m := ai.Resolve(c, "")
	if m != nil {
		s.Provider, s.ModelID = m.Name, m.ModelID
	}
	if mode == "explain" && s.SelectionText != "" {
		s.Messages = append(s.Messages, &Message{ID: newID(), Role: "user", Text: s.SelectionText, Done: true})
	}
	if m == nil {
		s.Status, s.Err = StatusError, i18n.T("selectionChat.error.missingAiConfig")
		return s
	}
	if mode == "explain" && s.SelectionText != "" {
		s.run()
	}
	return s
}

// Configured reports whether an AI provider is set up.
func Configured() bool { return ai.Resolve(settings.Capabilities.Get(), "") != nil }

// Submit asks a follow-up. Call on the main thread.
func (s *Session) Submit(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	s.Messages = append(s.Messages, &Message{ID: newID(), Role: "user", Text: text, Done: true})
	s.run()
}

// Regenerate answers the last question again. Call on the main thread.
func (s *Session) Regenerate() {
	if n := len(s.Messages); n > 0 && s.Messages[n-1].Role == "assistant" {
		s.Messages = s.Messages[:n-1]
	}
	if len(s.Messages) > 0 {
		s.run()
	}
}

// Stop stops the reply streaming in. Call on the main thread.
func (s *Session) Stop() {
	s.mu.Lock()
	s.runID++
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	s.mu.Unlock()
	if n := len(s.Messages); n > 0 && !s.Messages[n-1].Done {
		s.Messages[n-1].Done = true
		s.Messages[n-1].Stopped = s.Messages[n-1].Role == "assistant"
	}
	if s.Status == StatusStreaming || s.Status == StatusSearching {
		s.Status = StatusReady
	}
}

// Busy reports whether a reply is coming.
func (s *Session) Busy() bool { return s.Status == StatusSearching || s.Status == StatusStreaming }

func languageLabel() string { return i18n.T("app.language." + i18n.Language()) }

var imageError = regexp.MustCompile(`(?i)image|vision|multimodal|media type`)

// serverFailure is an error of the relay itself (a 5xx, a crash), never the model saying it takes no images.
var serverFailure = regexp.MustCompile(`(?i)^HTTP 5\d\d|panic`)

// refusesImages reports whether err reads as the model refusing images, rather than a relay failing on them.
func refusesImages(err error) bool {
	s := errString(err)
	return imageError.MatchString(s) && !serverFailure.MatchString(s)
}

// run streams the assistant's reply to the conversation so far. Call on the main thread.
func (s *Session) run() {
	s.mu.Lock()
	s.runID++
	run := s.runID
	if s.cancel != nil {
		s.cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	s.mu.Unlock()

	c := settings.Capabilities.Get()
	m := ai.Resolve(c, "")
	if m == nil {
		s.Status, s.Err = StatusError, i18n.T("selectionChat.error.missingAiConfig")
		return
	}
	history := make([]Message, 0, len(s.Messages))
	for _, msg := range s.Messages {
		history = append(history, *msg)
	}
	reply := &Message{ID: newID(), Role: "assistant"}
	s.Messages = append(s.Messages, reply)
	s.Err = ""
	s.Provider, s.ModelID = m.Name, m.ModelID
	s.Status = StatusStreaming
	search := s.WebSearch
	if p, _ := websearch.Configured(c); p == "" {
		search = false // nothing to search with: no "searching" that never searches
	}
	if search {
		s.Status = StatusSearching
	}
	selection, sourceApp, image, mode := s.SelectionText, s.SourceApp, s.image, s.Mode

	active := func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		return run == s.runID
	}
	update := func(fn func()) {
		s.Update(func() {
			if active() {
				fn()
			}
		})
	}

	go func() {
		defer cancel()
		var all []string
		for _, h := range history {
			all = append(all, h.Text)
		}
		if ai.EstimateTokens(append(all, selection)...) > m.ContextLimit {
			update(func() { s.fail(reply, i18n.T("selectionChat.error.contextLimit")) })
			return
		}
		var sources []websearch.Result
		if search {
			// The conversation's switch decides, the settings' default aside: any provider with a key.
			if provider, key := websearch.Configured(settings.Capabilities.Get()); provider != "" {
				latest := selection
				for _, h := range history {
					if h.Role == "user" {
						latest = h.Text
					}
				}
				sctx, scancel := context.WithTimeout(ctx, searchTimeout)
				res, err := websearch.Search(sctx, provider, key, strings.TrimSpace(selection+"\n"+latest))
				scancel()
				if ctx.Err() != nil {
					return
				}
				if err != nil {
					logx.Warn("[chat] search failed", "provider", provider, "err", err)
				}
				sources = res
				update(func() { s.SearchProvider = provider })
			}
			update(func() { s.Status = StatusStreaming })
		}

		includeImage := len(image) > 0 && m.SupportsImages()
		if len(image) > 0 {
			state := "sent"
			if !includeImage {
				state = "unsupported"
			}
			update(func() { s.ImageState = state })
		}
		style := ai.ImageStyleFor(m)
		ask := func(withImage bool) (string, error) {
			req := ai.Request{System: i18n.T("prompt.explain.system", "languageLabel", languageLabel()), ImageStyle: style}
			if mode == ModeChat {
				req = chatRequest(history, sources)
			} else {
				msg := ai.Message{Role: "user", Content: buildPrompt(selection, history, sources, sourceApp, withImage)}
				if withImage {
					msg.Images = [][]byte{image}
				}
				req.Messages = []ai.Message{msg}
			}
			rctx, rcancel := context.WithTimeout(ctx, requestTimeout)
			defer rcancel()
			var text strings.Builder
			err := ai.Stream(rctx, m, req, func(delta string) {
				text.WriteString(delta)
				full := text.String()
				update(func() { reply.Text = full })
			})
			if errors.Is(rctx.Err(), context.DeadlineExceeded) && ctx.Err() == nil {
				err = errors.New(i18n.T("selectionChat.error.timeout"))
			}
			return text.String(), err
		}
		logx.Info("[chat] request", "provider", m.Provider, "model", m.ModelID, "image", includeImage, "captured", len(image) > 0,
			"imageStyle", style, "context", m.ContextLimit, "sources", len(sources))
		started := time.Now()
		text, err := ask(includeImage)
		failedEarly := func() bool {
			return err != nil && text == "" && ctx.Err() == nil && !strings.Contains(err.Error(), i18n.T("selectionChat.error.timeout"))
		}
		// An OpenAI-compatible relay that fails on the screenshot may take it sent another way (ai.ImageStyles):
		// each is tried once, and the one that works is kept for this model at this address.
		if includeImage && m.UsesOpenAIImages() && !refusesImages(err) {
			for next := style + 1; failedEarly() && next < ai.ImageStylesFor(m); next++ {
				logx.Warn("[chat] image request failed, trying another way", "style", style, "next", next, "err", err)
				style = next
				text, err = ask(true)
				if err == nil {
					ai.RememberImageStyle(m, style)
					logx.Info("[chat] image style works", "style", style, "model", m.ModelID)
				}
			}
		}
		// A request with the screenshot that failed before any answer is asked again without it: a model may
		// refuse images, and relays (new-api) may even crash on them. When the text alone then works, the
		// screenshot was the cause: this model, at this address, is sent none again.
		if includeImage && failedEarly() {
			state := "dropped"
			if refusesImages(err) {
				state = "unsupported"
			}
			logx.Warn("[chat] retry without image", "err", err, "state", state)
			update(func() { s.ImageState = state })
			text, err = ask(false)
			if err == nil {
				ai.NoImages(m)
			}
		}
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			logx.Warn("[chat] request failed", "err", err)
			update(func() { s.fail(reply, err.Error()) })
			return
		}
		logx.Info("[chat] done", "chars", len([]rune(text)), "ms", time.Since(started).Milliseconds())
		update(func() {
			reply.Text, reply.Sources, reply.Done = text, sources, true
			s.Status = StatusReady
		})
	}()
}

func (s *Session) fail(reply *Message, msg string) {
	reply.Err, reply.Done = msg, true
	s.Status, s.Err = StatusError, msg
}

// buildPrompt is buildExplainPrompt of lib/selection-chat/prompt.ts.
func buildPrompt(selection string, messages []Message, sources []websearch.Result, sourceApp string, image bool) string {
	var sections []string
	if strings.TrimSpace(sourceApp) != "" {
		sections = append(sections, "Current application:\n"+strings.TrimSpace(sourceApp))
	}
	if image {
		sections = append(sections, "Attached context image:\nA screenshot of the window the user selected the text in is attached. Find the selected text in it and use what surrounds it (the paragraph, heading, code, table, conversation or UI it belongs to) to tell what the text means in this place: resolve abbreviations, pronouns, jargon and references from that context. Explain the selected text, not the whole screenshot, and do not describe the screenshot itself.")
	}
	sections = append(sections, i18n.T("prompt.explain.user.selection", "selection", selection))

	// The first message repeats the selection; the latest user message is the question.
	var rest []Message
	for i, m := range messages {
		if i == 0 && m.Role == "user" && strings.TrimSpace(m.Text) == strings.TrimSpace(selection) {
			continue
		}
		rest = append(rest, m)
	}
	latest := -1
	for i, m := range rest {
		if m.Role == "user" {
			latest = i
		}
	}
	var history []string
	for i, m := range rest {
		if i == latest || m.Text == "" {
			continue
		}
		role := "User"
		if m.Role == "assistant" {
			role = "Assistant"
		}
		history = append(history, role+": "+m.Text)
	}
	if len(history) > 0 {
		sections = append(sections, "Conversation history:\n"+strings.Join(history, "\n"))
	}
	if latest >= 0 {
		sections = append(sections, i18n.T("prompt.explain.user.followup", "question", strings.TrimSpace(rest[latest].Text)))
	}
	if len(sources) > 0 {
		var ctx []string
		for i, r := range sources {
			ctx = append(ctx, fmt.Sprintf("%d. %s\n%s\n%s", i+1, r.Title, r.URL, r.Snippet))
		}
		sections = append(sections, i18n.T("prompt.explain.user.search", "context", strings.Join(ctx, "\n\n")))
	}
	return strings.Join(sections, "\n\n")
}

// FallbackURL is where explaining goes without an AI provider: Perplexity, asked to explain text.
func FallbackURL(text string) string {
	label := "Chinese"
	if i18n.IsEnglish() {
		label = "English"
	}
	return "https://www.perplexity.ai/search?q=" + urlQueryEscape("Explain the following text in "+label+": "+strings.TrimSpace(text))
}

// HasImage reports whether the session has a capture of the source window.
func (s *Session) HasImage() bool { return len(s.image) > 0 }

// Image is the capture of the source window, if any.
func (s *Session) Image() []byte { return s.image }

// SetImage sets the capture of the source window (previews and tests).
func (s *Session) SetImage(png []byte) { s.image = png }

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
