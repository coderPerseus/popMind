package clipsync

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
)

// Objects are AES-256-GCM sealed with a key derived from the sync key; their names are keyed hashes, so the
// bucket shows nothing of the content (sync-crypto.ts).

const (
	formatVersion = 1
	ivBytes       = 12
	tagBytes      = 16
)

type keys struct{ content, names []byte }

func deriveKeys(master []byte) (keys, error) {
	content, err := hkdf.Key(sha256.New, master, []byte("popmind-sync"), "content-v1", 32)
	if err != nil {
		return keys{}, err
	}
	names, err := hkdf.Key(sha256.New, master, []byte("popmind-sync"), "names-v1", 32)
	return keys{content, names}, err
}

// remoteName is the opaque object name of a value in a namespace ("item", "blob", "pinboard").
func (k keys) remoteName(namespace, value string) string {
	m := hmac.New(sha256.New, k.names)
	m.Write([]byte(namespace + "\n" + value))
	return hex.EncodeToString(m.Sum(nil))[:40]
}

func (k keys) seal(plain []byte) []byte {
	block, _ := aes.NewCipher(k.content)
	gcm, _ := cipher.NewGCM(block)
	iv := make([]byte, ivBytes)
	_, _ = rand.Read(iv)
	out := append([]byte{formatVersion}, iv...)
	return gcm.Seal(out, iv, plain, nil) // body then tag, as Node writes them
}

var errFormat = errors.New("unsupported sync object format")

func (k keys) unseal(data []byte) ([]byte, error) {
	if len(data) < 1+ivBytes+tagBytes || data[0] != formatVersion {
		return nil, errFormat
	}
	block, err := aes.NewCipher(k.content)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return gcm.Open(nil, data[1:1+ivBytes], data[1+ivBytes:], nil)
}
