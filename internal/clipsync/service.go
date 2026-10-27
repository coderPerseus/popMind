package clipsync

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"

	"popmind/internal/clipboard"
	"popmind/internal/jsonx"
	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/settings"
)

// The sync key lives in the Keychain (mygo.Secrets); clipboard/sync-state.json keeps the rest: which bucket
// and key the local bookkeeping belongs to, when sync started here, and the last result.

const secretName = "clipboard-sync-key"

type state struct {
	Identity  string   `json:"identity,omitempty"`
	StartedAt int64    `json:"startedAt,omitempty"`
	LastSync  *Summary `json:"lastSync,omitempty"`
}

// Status is what the settings and the panel show.
type Status struct {
	Configured bool
	Running    bool
	Bucket     string
	KeyHint    string
	LastSync   *Summary
	// LegacyAvailable is set while the old popMind has a sync key to import and this Mac has none.
	LegacyAvailable bool
}

// Service is the clipboard sync of one store.
type Service struct {
	store *clipboard.Store

	mu       sync.Mutex
	running  bool
	onChange []func()
}

// NewService makes the sync service of store.
func NewService(store *clipboard.Store) *Service { return &Service{store: store} }

func (s *Service) statePath() string { return filepath.Join(s.store.Root(), "sync-state.json") }

func (s *Service) readState() state {
	var st state
	_ = jsonx.ReadFile(s.statePath(), &st)
	return st
}

func (s *Service) writeState(st state) {
	data, _ := json.Marshal(st)
	_ = os.WriteFile(s.statePath(), data, 0o600)
}

// OnChange calls fn when the status changes (a sync starts or ends, a key is saved or removed).
func (s *Service) OnChange(fn func()) {
	s.mu.Lock()
	s.onChange = append(s.onChange, fn)
	s.mu.Unlock()
}

func (s *Service) changed() {
	s.mu.Lock()
	fns := append([]func(){}, s.onChange...)
	s.mu.Unlock()
	for _, fn := range fns {
		go fn()
	}
}

func (s *Service) key() string {
	b, err := mygo.Secrets.Get(secretName)
	if err != nil {
		return ""
	}
	return string(b)
}

// Credentials returns the saved credentials, if any.
func (s *Service) Credentials() (Credentials, bool) {
	if k := s.key(); k != "" {
		return ParseKey(k)
	}
	return Credentials{}, false
}

// Status is the current status.
func (s *Service) Status() Status {
	key := s.key()
	c, ok := ParseKey(key)
	st := Status{Configured: ok, LastSync: s.readState().LastSync}
	s.mu.Lock()
	st.Running = s.running
	s.mu.Unlock()
	if ok {
		st.Bucket, st.KeyHint = c.Bucket, key[:min(14, len(key))]+"…"
	} else {
		st.LegacyAvailable = LegacyAvailable()
	}
	return st
}

// save keeps verified credentials; another bucket or key resets the bookkeeping, so all syncs afresh.
func (s *Service) save(c Credentials, startedAt int64) error {
	if err := mygo.Secrets.Set(secretName, []byte(c.Encode())); err != nil {
		return err
	}
	prev := s.readState()
	id := c.Identity()
	next := state{Identity: id, StartedAt: prev.StartedAt, LastSync: prev.LastSync}
	if prev.Identity != id {
		if prev.Identity != "" {
			s.store.SyncReset()
			logx.Info("[clip-sync] different sync target, bookkeeping reset")
		}
		next = state{Identity: id, StartedAt: time.Now().UnixMilli()}
		if startedAt > 0 {
			next.StartedAt = startedAt
		}
	}
	s.writeState(next)
	s.changed()
	return nil
}

func failure(err error) error { return asSyncError(err) }

// Connect joins with a pasted sync key.
func (s *Service) Connect(input string) error {
	return s.connect(input, 0)
}

func (s *Service) connect(input string, startedAt int64) error {
	c, ok := ParseKey(input)
	if !ok {
		return &Error{ErrInvalidKey, errors.New("malformed sync key")}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, _, err := verify(ctx, NewR2(c), c, true); err != nil {
		logx.Warn("[clip-sync] connect failed", "err", err)
		return failure(err)
	}
	if err := s.save(c, startedAt); err != nil {
		return failure(err)
	}
	logx.Info("[clip-sync] connected", "bucket", c.Bucket)
	return nil
}

// ImportLegacy takes the old popMind's sync key (macOS asks for Keychain access) and connects with it, keeping
// its start time so the history range is the same.
func (s *Service) ImportLegacy() error {
	key, startedAt, err := readLegacyKey()
	if err != nil {
		logx.Warn("[clip-sync] legacy key import failed", "err", err)
		return &Error{ErrInvalidKey, err}
	}
	logx.Info("[clip-sync] legacy key read")
	return s.connect(key, startedAt)
}

// SetupWithToken sets up the first Mac from an R2 API token (and account id): bucket, credentials, new key.
func (s *Service) SetupWithToken(token, accountInput string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return &Error{ErrAuth, errors.New("empty token")}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	account := FindAccountID(accountInput)
	if account == "" {
		account = detectAccount(ctx, token)
	}
	if !accountIDRe.MatchString(account) {
		return &Error{ErrAccount, errors.New("account id required")}
	}
	id, err := verifyToken(ctx, token, account)
	if err != nil {
		code := ErrUnknown
		if ce, ok := err.(*cfError); ok && (ce.Status == 401 || ce.Status == 403 || containsInt(ce.Codes, 1000)) {
			code = ErrAuth
		}
		return &Error{code, err}
	}
	if err := ensureBucket(ctx, token, account, DefaultBucket); err != nil {
		logx.Info("[clip-sync] bucket check via API skipped", "err", err)
	}
	c := Credentials{AccountID: account, Bucket: DefaultBucket, AccessKeyID: id, SecretAccessKey: S3SecretFromToken(token),
		EncryptionKey: NewEncryptionKey()}
	if _, _, err := verify(ctx, NewR2(c), c, true); err != nil {
		return failure(err)
	}
	if err := s.save(c, 0); err != nil {
		return failure(err)
	}
	logx.Info("[clip-sync] set up with token")
	return nil
}

func containsInt(v []int, x int) bool {
	for _, y := range v {
		if y == x {
			return true
		}
	}
	return false
}

// Disconnect forgets the key on this Mac; the bookkeeping stays, so reconnecting re-uploads nothing.
func (s *Service) Disconnect() {
	_ = mygo.Secrets.Delete(secretName)
	st := s.readState()
	s.writeState(state{Identity: st.Identity, StartedAt: st.StartedAt})
	logx.Info("[clip-sync] disconnected")
	s.changed()
}

// CopyKey puts the sync key on the pasteboard, marked concealed so no clipboard history keeps it.
func (s *Service) CopyKey() bool {
	key := s.key()
	if key == "" {
		return false
	}
	items := []native.PasteboardItem{{Representations: []native.PasteboardRepresentation{
		{Type: "public.utf8-plain-text", Data: []byte(key)},
		{Type: "org.nspasteboard.ConcealedType", Data: []byte("1")},
	}}}
	if native.WritePasteboard(items, "sync-key") {
		return true
	}
	mygo.Clipboard.WriteText(key)
	return true
}

type syncSettings struct {
	Range      string  `json:"range"`
	MaxImageMb float64 `json:"maxImageMb"`
}

func (s *Service) options() (Options, bool) {
	c, ok := s.Credentials()
	if !ok {
		return Options{}, false
	}
	var ss syncSettings
	_ = jsonx.Convert(jsonx.Get(settings.Capabilities.Raw(), "clipboard", "sync"), &ss)
	if ss.Range == "" {
		ss.Range = "7d"
	}
	if ss.MaxImageMb < 1 {
		ss.MaxImageMb = 10
	}
	started := s.readState().StartedAt
	if started == 0 {
		started = time.Now().UnixMilli()
	}
	return Options{Store: s.store, Remote: NewR2(c), Credentials: c, Range: ss.Range,
		MaxImage: int64(ss.MaxImageMb * 1024 * 1024), StartedAt: started}, true
}

// Run syncs now; a sync already running is not started again.
func (s *Service) Run() Summary {
	o, ok := s.options()
	if !ok {
		return Summary{ErrorCode: ErrNotConfigured, FinishedAt: time.Now().UnixMilli()}
	}
	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		return Summary{ErrorCode: ErrBusy, FinishedAt: time.Now().UnixMilli()}
	}
	s.running = true
	s.mu.Unlock()
	s.changed()
	sum := Run(context.Background(), o)
	st := s.readState()
	st.LastSync = &sum
	s.writeState(st)
	s.mu.Lock()
	s.running = false
	s.mu.Unlock()
	s.changed()
	return sum
}

// Push uploads chosen items now.
func (s *Service) Push(ids []string) PushResult {
	o, ok := s.options()
	if !ok {
		return PushResult{ErrorCode: ErrNotConfigured}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	return Push(ctx, o, ids)
}
