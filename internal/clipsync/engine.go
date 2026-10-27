package clipsync

import (
	"context"
	"errors"
	"net"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"popmind/internal/clipboard"
	"popmind/internal/logx"
)

const (
	itemsPrefix     = "items/"
	blobsPrefix     = "blobs/"
	pinboardsPrefix = "pinboards/"
	checkKey        = "meta/check"
	checkPlain      = "popmind-sync-check-v1"

	concurrency  = 12
	importBatch  = 60
	uploadBatch  = 48
	maxExtraRep  = 2 << 20
	dayMs        = int64(24 * time.Hour / time.Millisecond)
	syncDeadline = 10 * time.Minute
)

var textUTIs = map[string]bool{"public.utf8-plain-text": true, "public.utf16-plain-text": true, "public.html": true}

// Error codes the UI shows (clip.panel.sync.error.*).
const (
	ErrNotConfigured = "not_configured"
	ErrInvalidKey    = "invalid_key"
	ErrAccount       = "account_required"
	ErrAuth          = "auth_failed"
	ErrBucket        = "bucket_missing"
	ErrWrongKey      = "wrong_key"
	ErrNetwork       = "network"
	ErrBusy          = "busy"
	ErrUnknown       = "unknown"
)

// Error is a failed sync with a code for the UI.
type Error struct {
	Code string
	Err  error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return e.Code + ": " + e.Err.Error()
	}
	return e.Code
}

func asSyncError(err error) *Error {
	var se *Error
	if errors.As(err, &se) {
		return se
	}
	var re *R2Error
	if errors.As(err, &re) {
		switch {
		case re.Code == "NoSuchBucket":
			return &Error{ErrBucket, err}
		case re.Status == 401 || re.Status == 403:
			return &Error{ErrAuth, err}
		}
		return &Error{ErrUnknown, err}
	}
	var ne net.Error
	if errors.As(err, &ne) || strings.Contains(err.Error(), "no such host") || strings.Contains(err.Error(), "connection") {
		return &Error{ErrNetwork, err}
	}
	return &Error{ErrUnknown, err}
}

// Summary is the result of a sync.
type Summary struct {
	OK              bool   `json:"ok"`
	Received        int    `json:"received"`
	Uploaded        int    `json:"uploaded"`
	PinboardsChange int    `json:"pinboardsChanged"`
	Skipped         int    `json:"skipped"`
	ErrorCode       string `json:"errorCode,omitempty"`
	ErrorMessage    string `json:"errorMessage,omitempty"`
	FinishedAt      int64  `json:"finishedAt"`
	TookMs          int64  `json:"tookMs"`
}

// verify checks the credentials and that the bucket's data was sealed with this key; initialize writes the
// check object into an empty bucket (the first Mac).
func verify(ctx context.Context, r *R2, c Credentials, initialize bool) (keys, bool, error) {
	k, err := deriveKeys(c.EncryptionKey)
	if err != nil {
		return k, false, err
	}
	data, err := r.Get(ctx, checkKey)
	if err != nil {
		return k, false, asSyncError(err)
	}
	if data != nil {
		plain, err := k.unseal(data)
		if err != nil || string(plain) != checkPlain {
			return k, false, &Error{ErrWrongKey, errors.New("bucket data was encrypted with a different sync key")}
		}
		return k, false, nil
	}
	if initialize {
		if err := r.Put(ctx, checkKey, k.seal([]byte(checkPlain))); err != nil {
			return k, false, asSyncError(err)
		}
		return k, true, nil
	}
	return k, false, nil
}

// mapLimit runs fn over n indexes with at most limit at once.
func mapLimit(n, limit int, fn func(i int)) {
	var wg sync.WaitGroup
	sem := make(chan struct{}, limit)
	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer func() { <-sem; wg.Done() }()
			fn(i)
		}(i)
	}
	wg.Wait()
}

// Options of a sync.
type Options struct {
	Store       *clipboard.Store
	Remote      *R2
	Credentials Credentials
	Range       string // "7d", "30d", "all", "none"
	MaxImage    int64
	StartedAt   int64 // when sync was set up on this Mac
}

// Run pulls the remote items and pinboards this Mac has not seen, then pushes its own (runSync).
func Run(ctx context.Context, o Options) Summary {
	started := time.Now()
	ctx, cancel := context.WithTimeout(ctx, syncDeadline)
	defer cancel()
	sum := Summary{}
	err := run(ctx, o, &sum)
	if err != nil {
		se := asSyncError(err)
		sum.ErrorCode, sum.ErrorMessage = se.Code, se.Error()
		logx.Warn("[clip-sync] failed", "code", se.Code, "err", se.Err)
	} else {
		sum.OK = true
	}
	sum.FinishedAt, sum.TookMs = time.Now().UnixMilli(), time.Since(started).Milliseconds()
	logx.Info("[clip-sync] done", "ok", sum.OK, "received", sum.Received, "uploaded", sum.Uploaded,
		"pinboards", sum.PinboardsChange, "skipped", sum.Skipped, "ms", sum.TookMs)
	return sum
}

func name(key, prefix string) string { return strings.TrimPrefix(key, prefix) }

func run(ctx context.Context, o Options, sum *Summary) error {
	r, store := o.Remote, o.Store
	k, _, err := verify(ctx, r, o.Credentials, true)
	if err != nil {
		return err
	}

	// 1. Pull items.
	remoteItems, err := r.List(ctx, itemsPrefix)
	if err != nil {
		return err
	}
	remoteBlobs, err := r.List(ctx, blobsPrefix)
	if err != nil {
		return err
	}
	itemNames, blobNames := map[string]bool{}, map[string]bool{}
	for _, ob := range remoteItems {
		itemNames[name(ob.Key, itemsPrefix)] = true
	}
	for _, ob := range remoteBlobs {
		blobNames[name(ob.Key, blobsPrefix)] = true
	}
	known := store.SyncKnownKeys()
	var fresh []Object
	for _, ob := range remoteItems {
		if !known[name(ob.Key, itemsPrefix)] {
			fresh = append(fresh, ob)
		}
	}
	sort.Slice(fresh, func(i, j int) bool { return fresh[i].LastModified.Before(fresh[j].LastModified) })
	logx.Info("[clip-sync] pull plan", "remoteItems", len(remoteItems), "remoteBlobs", len(remoteBlobs), "known", len(known), "fresh", len(fresh))

	// Received items are new content: newest upload on top, with "now"-based times.
	base := time.Now().UnixMilli() - int64(len(fresh))
	order := 0
	for start := 0; start < len(fresh); start += importBatch {
		batch := fresh[start:min(len(fresh), start+importBatch)]
		got := make([]*clipboard.Incoming, len(batch))
		mapLimit(len(batch), concurrency, func(i int) { got[i] = download(ctx, r, k, batch[i].Key) })
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var incoming []clipboard.Incoming
		var unusable []string
		for i, in := range got {
			order++
			n := name(batch[i].Key, itemsPrefix)
			if in == nil {
				unusable = append(unusable, n)
				continue
			}
			in.RemoteKey = n
			in.Record.CopiedAt = base + int64(order)
			incoming = append(incoming, *in)
		}
		store.SyncMarkSeen(unusable)
		sum.Received += len(store.SyncImportItems(incoming))
	}

	// 2. Pull pinboards.
	pinObjects, err := r.List(ctx, pinboardsPrefix)
	if err != nil {
		return err
	}
	remotePins := map[string]pinboardPayload{}
	var mu sync.Mutex
	mapLimit(len(pinObjects), concurrency, func(i int) {
		data, err := r.Get(ctx, pinObjects[i].Key)
		if err != nil || data == nil {
			return
		}
		plain, err := k.unseal(data)
		if err != nil {
			return
		}
		p, err := decodePinboard(plain)
		if err != nil {
			logx.Warn("[clip-sync] pinboard unreadable", "err", err)
			return
		}
		mu.Lock()
		remotePins[name(pinObjects[i].Key, pinboardsPrefix)] = p
		mu.Unlock()
	})
	for key, p := range remotePins {
		if created, added := store.SyncApplyPinboard(key, p.Name, p.Color, p.Items); created || added > 0 {
			sum.PinboardsChange++
		}
	}

	// 3. Push items.
	since := int64(0)
	switch o.Range {
	case "7d":
		since = o.StartedAt - 7*dayMs
	case "30d":
		since = o.StartedAt - 30*dayMs
	case "none":
		since = o.StartedAt
	}
	pending := store.SyncPendingUploadIDs(since)
	logx.Info("[clip-sync] push plan", "pending", len(pending), "range", o.Range)
	var blobMu sync.Mutex
	for start := 0; start < len(pending); start += uploadBatch {
		outgoing := store.SyncLoadOutgoing(pending[start:min(len(pending), start+uploadBatch)])
		results := make([]string, len(outgoing)) // remote key, "" skipped
		status := make([]string, len(outgoing))
		var firstErr error
		mapLimit(len(outgoing), concurrency, func(i int) {
			st, key, err := upload(ctx, r, k, outgoing[i], itemNames, blobNames, &blobMu, o.MaxImage)
			blobMu.Lock()
			defer blobMu.Unlock()
			if err != nil && firstErr == nil {
				firstErr = err
			}
			status[i], results[i] = st, key
		})
		if firstErr != nil {
			return firstErr
		}
		var done, skipped []clipboard.SyncEntry
		for i, st := range status {
			switch st {
			case "skipped":
				skipped = append(skipped, clipboard.SyncEntry{ItemID: outgoing[i].ID})
				sum.Skipped++
			case "uploaded", "existing":
				done = append(done, clipboard.SyncEntry{ItemID: outgoing[i].ID, RemoteKey: results[i]})
				if st == "uploaded" {
					sum.Uploaded++
				}
			}
		}
		store.SyncMarkUploaded(done, "local")
		store.SyncMarkUploaded(skipped, "skipped")
	}

	// 4. Push pinboards: the union with the remote one, which only grows.
	for _, lp := range store.SyncLocalPinboards() {
		key := k.remoteName("pinboard", lp.Name)
		remote, has := remotePins[key]
		seen := map[string]bool{}
		for _, it := range remote.Items {
			seen[it] = true
		}
		var additions []string
		for _, it := range lp.ItemKeys {
			if !seen[it] {
				additions = append(additions, it)
			}
		}
		if !has || len(additions) > 0 {
			color := lp.Color
			if has && remote.Color != "" {
				color = remote.Color
			}
			data, err := pack(pinboardPayload{V: payloadVersion, Name: lp.Name, Color: color, Items: append(additions, remote.Items...)})
			if err != nil {
				return err
			}
			if err := r.Put(ctx, pinboardsPrefix+key, k.seal(data)); err != nil {
				return err
			}
		}
		store.SyncMarkPinboardMembers(key, lp.ItemKeys)
	}
	return nil
}

func download(ctx context.Context, r *R2, k keys, key string) *clipboard.Incoming {
	data, err := r.Get(ctx, key)
	if err != nil || data == nil {
		return nil
	}
	plain, err := k.unseal(data)
	if err != nil {
		logx.Warn("[clip-sync] item unreadable, skipped", "err", err)
		return nil
	}
	var p itemPayload
	if err := unpack(plain, &p); err != nil || p.V != payloadVersion || p.FP == "" {
		return nil
	}
	switch p.Kind {
	case clipboard.KindText, clipboard.KindLink, clipboard.KindColor, clipboard.KindImage:
	default:
		return nil
	}
	var png []byte
	if p.Kind == clipboard.KindImage {
		if p.Img == "" {
			return nil
		}
		blob, err := r.Get(ctx, blobsPrefix+p.Img)
		if err != nil || blob == nil {
			return nil
		}
		if png, err = k.unseal(blob); err != nil {
			return nil
		}
	}
	var reps []clipboard.Representation
	for _, rep := range p.Reps {
		if d := unb64(rep.D); d != nil {
			reps = append(reps, clipboard.Representation{ItemIndex: rep.I, UTI: rep.U, Data: d})
		}
	}
	srcID, srcName := "", ""
	if p.Src != nil {
		srcID, srcName = p.Src.ID, p.Src.Name
	}
	rec := clipboard.SyncRecord(p.Kind, p.Sub, p.Rich, p.FP, p.Text, p.HTML, p.URL, p.Color, p.W, p.H, png, reps, srcID, srcName, 0)
	return &clipboard.Incoming{Record: rec, CustomTitle: p.Title}
}

// upload sends an item (and its image once); it reports "uploaded", "existing" or "skipped".
func upload(ctx context.Context, r *R2, k keys, it clipboard.Outgoing, itemNames, blobNames map[string]bool, mu *sync.Mutex, maxImage int64) (string, string, error) {
	if it.Kind == clipboard.KindFile {
		return "skipped", "", nil
	}
	key := k.remoteName("item", it.Fingerprint)
	mu.Lock()
	exists := itemNames[key]
	mu.Unlock()
	if exists {
		return "existing", key, nil
	}
	img := ""
	if it.Kind == clipboard.KindImage {
		if it.ImagePath == "" || it.ImageHash == "" {
			return "skipped", "", nil
		}
		info, err := os.Stat(it.ImagePath)
		if err != nil || info.Size() <= 0 || info.Size() > maxImage {
			return "skipped", "", nil
		}
		img = k.remoteName("blob", it.ImageHash)
		mu.Lock()
		has := blobNames[img]
		mu.Unlock()
		if !has {
			data, err := os.ReadFile(it.ImagePath)
			if err != nil {
				return "skipped", "", nil
			}
			if err := r.Put(ctx, blobsPrefix+img, k.seal(data)); err != nil {
				return "", "", err
			}
			mu.Lock()
			blobNames[img] = true
			mu.Unlock()
		}
	}
	p := itemPayload{V: payloadVersion, FP: it.Fingerprint, Kind: it.Kind, Sub: it.SubKind, Rich: it.IsRich, Title: it.CustomTitle,
		Text: it.PlainText, HTML: it.HTML, URL: it.URL, Color: it.Color, W: it.ImageWidth, H: it.ImageHeight, Img: img,
		Reps: []repJSON{}}
	if it.SourceID != "" {
		p.Src = &srcJSON{ID: it.SourceID, Name: it.SourceName}
	}
	for _, rep := range it.Reps {
		if textUTIs[rep.UTI] || len(rep.Data) <= maxExtraRep {
			p.Reps = append(p.Reps, repJSON{I: rep.ItemIndex, U: rep.UTI, D: b64(rep.Data)})
		}
	}
	data, err := pack(p)
	if err != nil {
		return "", "", err
	}
	if err := r.Put(ctx, itemsPrefix+key, k.seal(data)); err != nil {
		return "", "", err
	}
	mu.Lock()
	itemNames[key] = true
	mu.Unlock()
	return "uploaded", key, nil
}

// PushResult is the result of uploading chosen items.
type PushResult struct {
	OK                          bool
	Uploaded, Existing, Skipped int
	ErrorCode                   string
}

// Push uploads chosen items now, whatever the range (context menu "Sync to remote"); it checks each object
// with HEAD instead of listing the bucket.
func Push(ctx context.Context, o Options, ids []string) PushResult {
	res := PushResult{}
	k, _, err := verify(ctx, o.Remote, o.Credentials, true)
	if err != nil {
		res.ErrorCode = asSyncError(err).Code
		return res
	}
	outgoing := o.Store.SyncLoadOutgoing(ids)
	res.Skipped = len(ids) - len(outgoing)
	itemNames, blobNames := map[string]bool{}, map[string]bool{}
	var mu sync.Mutex
	var done []clipboard.SyncEntry
	for _, it := range outgoing {
		if it.Kind == clipboard.KindFile {
			res.Skipped++
			continue
		}
		key := k.remoteName("item", it.Fingerprint)
		if ok, err := o.Remote.Head(ctx, itemsPrefix+key); err == nil && ok {
			res.Existing++
			done = append(done, clipboard.SyncEntry{ItemID: it.ID, RemoteKey: key})
			continue
		}
		if it.ImageHash != "" {
			b := k.remoteName("blob", it.ImageHash)
			if ok, err := o.Remote.Head(ctx, blobsPrefix+b); err == nil && ok {
				blobNames[b] = true
			}
		}
		st, key, err := upload(ctx, o.Remote, k, it, itemNames, blobNames, &mu, o.MaxImage)
		if err != nil {
			res.ErrorCode = asSyncError(err).Code
			return res
		}
		switch st {
		case "uploaded":
			res.Uploaded++
			done = append(done, clipboard.SyncEntry{ItemID: it.ID, RemoteKey: key})
		case "skipped":
			res.Skipped++
		}
	}
	o.Store.SyncMarkUploaded(done, "local")
	res.OK = true
	logx.Info("[clip-sync] push items", "ids", len(ids), "uploaded", res.Uploaded, "existing", res.Existing, "skipped", res.Skipped)
	return res
}
