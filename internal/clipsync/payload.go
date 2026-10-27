package clipsync

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
)

// Payloads are JSON, deflated (raw), then sealed (sync-payload.ts). They carry no times or usage counts:
// received items are new content.

const payloadVersion = 1

type repJSON struct {
	I int    `json:"i"`
	U string `json:"u"`
	D string `json:"d"`
}

type srcJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type itemPayload struct {
	V     int       `json:"v"`
	FP    string    `json:"fp"`
	Kind  string    `json:"kind"`
	Sub   string    `json:"sub,omitempty"`
	Rich  bool      `json:"rich,omitempty"`
	Title string    `json:"title,omitempty"`
	Text  string    `json:"text,omitempty"`
	HTML  string    `json:"html,omitempty"`
	URL   string    `json:"url,omitempty"`
	Color string    `json:"color,omitempty"`
	W     int       `json:"w,omitempty"`
	H     int       `json:"h,omitempty"`
	Img   string    `json:"img,omitempty"`
	Src   *srcJSON  `json:"src,omitempty"`
	Reps  []repJSON `json:"reps"`
}

type pinboardPayload struct {
	V     int      `json:"v"`
	Name  string   `json:"name"`
	Color string   `json:"color"`
	Items []string `json:"items"`
}

func pack(v any) ([]byte, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var b bytes.Buffer
	w, _ := flate.NewWriter(&b, flate.DefaultCompression)
	_, _ = w.Write(raw)
	_ = w.Close()
	return b.Bytes(), nil
}

func unpack(data []byte, v any) error {
	raw, err := io.ReadAll(io.LimitReader(flate.NewReader(bytes.NewReader(data)), 256<<20))
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

func b64(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func unb64(s string) []byte {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil
	}
	return b
}

func decodePinboard(data []byte) (pinboardPayload, error) {
	var p pinboardPayload
	if err := unpack(data, &p); err != nil {
		return p, err
	}
	if p.V != payloadVersion || p.Name == "" {
		return p, errors.New("unsupported pinboard payload")
	}
	if p.Color == "" {
		p.Color = "gray"
	}
	return p, nil
}
