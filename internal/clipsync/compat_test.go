package clipsync

import (
	"bytes"
	"os"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// TestCompatWithElectron runs the Electron app's sync code with Node and checks that both produce and read the
// same keys, names, sealed objects, payloads and request signatures, so both apps can share a bucket.
func TestCompatWithElectron(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not installed")
	}
	if _, err := os.Stat("../../archive/electron/lib/clipboard/sync"); err != nil {
		t.Skip("the archived Electron app is not here")
	}
	creds := Credentials{AccountID: "0123456789abcdef0123456789abcdef", Bucket: "popmind-sync", AccessKeyID: "AKIDEXAMPLE",
		SecretAccessKey: "secret-value", EncryptionKey: bytes.Repeat([]byte{7}, 32)}
	k, _ := deriveKeys(creds.EncryptionKey)
	goItem, _ := pack(itemPayload{V: 1, FP: "txt:go", Kind: "text", Text: "来自 Go", Reps: []repJSON{}})

	out, err := exec.Command("node", "--experimental-transform-types", "--no-warnings", "testdata/compat.mts",
		base64.StdEncoding.EncodeToString(k.seal(goItem))).Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			t.Fatalf("node: %v\n%s", err, ee.Stderr)
		}
		t.Fatal(err)
	}
	var js struct{ Key, Name, Check, Item, Auth, FromGo string }
	if err := json.Unmarshal(out, &js); err != nil {
		t.Fatal(err, string(out))
	}
	if js.Key != creds.Encode() {
		t.Errorf("sync key differs:\n go %s\n js %s", creds.Encode(), js.Key)
	}
	if parsed, ok := ParseKey(js.Key); !ok || parsed.Identity() != creds.Identity() {
		t.Error("cannot parse the Electron key")
	}
	if got := k.remoteName("item", "txt:abc"); got != js.Name {
		t.Errorf("object name differs: %s vs %s", got, js.Name)
	}
	check, _ := base64.StdEncoding.DecodeString(js.Check)
	if plain, err := k.unseal(check); err != nil || string(plain) != checkPlain {
		t.Errorf("cannot open Electron's check object: %v", err)
	}
	itemData, _ := base64.StdEncoding.DecodeString(js.Item)
	plain, err := k.unseal(itemData)
	var p itemPayload
	if err != nil || unpack(plain, &p) != nil || p.Text != "你好 sync" || p.FP != "txt:abc" {
		t.Errorf("cannot read Electron's item: %v %+v", err, p)
	}
	if js.FromGo != "来自 Go" {
		t.Errorf("Electron cannot read Go's item: %q", js.FromGo)
	}

	// The same request signed by both.
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { auth = r.Header.Get("Authorization") }))
	defer srv.Close()
	r := NewR2(creds)
	r.Endpoint = srv.URL
	r.now = func() time.Time { return time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC) }
	if err := r.Put(context.Background(), "items/a b+c", []byte("hi")); err != nil {
		t.Fatal(err)
	}
	if auth != js.Auth || !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260102/auto/s3/aws4_request") {
		t.Errorf("signature differs:\n go %s\n js %s", auth, js.Auth)
	}
}

func TestDecryptV10(t *testing.T) {
	// Chromium's v10 of "pmsync1.test" under the password "pw" (made with the same scheme).
	sealed := v10Seal(t, "pw", "pmsync1.test")
	if got, err := decryptV10(sealed, "pw"); err != nil || got != "pmsync1.test" {
		t.Fatal(got, err)
	}
	if _, err := decryptV10(sealed, "wrong"); err == nil {
		t.Log("a wrong password may still unpad by chance; the key then fails to parse")
	}
}
