package clipsync

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// The Electron app kept its sync key in userData/clipboard/sync-state.json, encrypted with Electron's
// safeStorage: Chromium's "v10" format, AES-128-CBC with a key derived from a password in the login Keychain
// ("<App> Safe Storage"). Reading that password makes macOS ask the user once.

type legacyState struct {
	Key       string   `json:"key"`
	StartedAt int64    `json:"startedAt"`
	LastSync  *Summary `json:"lastSync"`
}

func legacyStatePath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support", "popmind", "clipboard", "sync-state.json")
}

// LegacyAvailable reports whether the old popMind has a sync key this Mac could import.
func LegacyAvailable() bool {
	var st legacyState
	data, err := os.ReadFile(legacyStatePath())
	return err == nil && json.Unmarshal(data, &st) == nil && st.Key != ""
}

// readLegacyKey decrypts the old app's sync key (asking for Keychain access when it is encrypted).
func readLegacyKey() (string, int64, error) {
	var st legacyState
	data, err := os.ReadFile(legacyStatePath())
	if err != nil {
		return "", 0, err
	}
	if err := json.Unmarshal(data, &st); err != nil || st.Key == "" {
		return "", 0, errors.New("no sync key in the old app")
	}
	if strings.HasPrefix(st.Key, "plain:") {
		return st.Key[len("plain:"):], st.StartedAt, nil
	}
	sealed, err := base64.StdEncoding.DecodeString(st.Key)
	if err != nil || !bytes.HasPrefix(sealed, []byte("v10")) {
		return "", 0, errors.New("unknown sync key format")
	}
	var password string
	for _, service := range []string{"popMind Safe Storage", "popmind Safe Storage"} {
		out, err := exec.Command("/usr/bin/security", "find-generic-password", "-w", "-s", service).Output()
		if err == nil {
			password = strings.TrimSpace(string(out))
			break
		}
	}
	if password == "" {
		return "", 0, errors.New("keychain access was not granted")
	}
	key, err := decryptV10(sealed, password)
	return key, st.StartedAt, err
}

// decryptV10 opens Chromium's "v10" safeStorage data with the Keychain password.
func decryptV10(sealed []byte, password string) (string, error) {
	key, err := pbkdf2.Key(sha1.New, password, []byte("saltysalt"), 1003, 16)
	if err != nil {
		return "", err
	}
	body := sealed[3:]
	if len(body) == 0 || len(body)%aes.BlockSize != 0 {
		return "", errors.New("corrupt sync key")
	}
	block, _ := aes.NewCipher(key)
	plain := make([]byte, len(body))
	cipher.NewCBCDecrypter(block, bytes.Repeat([]byte{' '}, aes.BlockSize)).CryptBlocks(plain, body)
	pad := int(plain[len(plain)-1])
	if pad < 1 || pad > aes.BlockSize || pad > len(plain) {
		return "", errors.New("wrong keychain password")
	}
	return string(plain[:len(plain)-pad]), nil
}
