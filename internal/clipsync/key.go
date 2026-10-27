// Package clipsync syncs the clipboard history between Macs through the user's own Cloudflare R2 bucket,
// end-to-end encrypted, as the Electron app does (lib/clipboard/sync, docs/clipboard-sync.md): the same sync
// key, object names and payloads, so the old and the new app share one bucket. Sync only adds: received items
// are new content, nothing is deleted or overwritten on either side.
package clipsync

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"
)

// KeyPrefix starts every sync key: "pmsync1.<base64url(JSON {a, b, k, s, e})>".
const KeyPrefix = "pmsync1."

// DefaultBucket is the bucket a new setup uses.
const DefaultBucket = "popmind-sync"

// Credentials are what a sync key holds.
type Credentials struct {
	AccountID       string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey string
	// EncryptionKey is 32 random bytes; it never leaves the user's devices except inside the sync key.
	EncryptionKey []byte
}

var (
	accountIDRe = regexp.MustCompile(`(?i)^[0-9a-f]{32}$`)
	bucketRe    = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`)
	spaces      = regexp.MustCompile(`\s+`)
)

// NewEncryptionKey makes a key for a new bucket.
func NewEncryptionKey() []byte {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return b
}

// S3SecretFromToken is R2's S3 secret of an API token: the SHA-256 of its value.
func S3SecretFromToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}

type keyJSON struct {
	A string `json:"a"`
	B string `json:"b"`
	K string `json:"k"`
	S string `json:"s"`
	E string `json:"e"`
}

// Encode makes the sync key of c.
func (c Credentials) Encode() string {
	data, _ := json.Marshal(keyJSON{c.AccountID, c.Bucket, c.AccessKeyID, c.SecretAccessKey,
		base64.RawURLEncoding.EncodeToString(c.EncryptionKey)})
	return KeyPrefix + base64.RawURLEncoding.EncodeToString(data)
}

// ParseKey reads a pasted sync key (spaces and line breaks are ignored), or returns false.
func ParseKey(input string) (Credentials, bool) {
	text := spaces.ReplaceAllString(input, "")
	if !strings.HasPrefix(text, KeyPrefix) {
		return Credentials{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(text[len(KeyPrefix):], "="))
	if err != nil {
		return Credentials{}, false
	}
	var k keyJSON
	if json.Unmarshal(raw, &k) != nil || k.A == "" || k.B == "" || k.K == "" || k.S == "" || k.E == "" {
		return Credentials{}, false
	}
	enc, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(k.E, "="))
	if err != nil || len(enc) != 32 || !accountIDRe.MatchString(k.A) || !bucketRe.MatchString(k.B) {
		return Credentials{}, false
	}
	return Credentials{AccountID: k.A, Bucket: k.B, AccessKeyID: k.K, SecretAccessKey: k.S, EncryptionKey: enc}, true
}

// Identity tells sync targets apart: a different bucket or key restarts the bookkeeping.
func (c Credentials) Identity() string {
	h := sha256.New()
	h.Write([]byte(c.AccountID + "\n" + c.Bucket + "\n"))
	h.Write(c.EncryptionKey)
	return hex.EncodeToString(h.Sum(nil))
}

// FindAccountID finds an account id in what was pasted (the id itself, or the S3 endpoint holding it).
func FindAccountID(s string) string {
	return regexp.MustCompile(`(?i)[0-9a-f]{32}`).FindString(s)
}
