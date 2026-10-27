package clipsync

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

// R2 is a minimal client of Cloudflare R2's S3 API, signed with AWS Signature V4 (r2-client.ts).
type R2 struct {
	creds Credentials
	host  string
	// Endpoint overrides "https://<host>" (tests).
	Endpoint string
	client   *http.Client
	now      func() time.Time
}

// Object is a listed object.
type Object struct {
	Key          string
	LastModified time.Time
	Size         int64
}

// R2Error is a failed request.
type R2Error struct {
	Status int
	Code   string
	Msg    string
}

func (e *R2Error) Error() string {
	return strings.TrimSpace(fmt.Sprintf("%d %s %s", e.Status, e.Code, e.Msg))
}

// NewR2 makes a client for the bucket of c.
func NewR2(c Credentials) *R2 {
	host := c.AccountID + ".r2.cloudflarestorage.com"
	return &R2{creds: c, host: host, Endpoint: "https://" + host, client: &http.Client{Timeout: 60 * time.Second}, now: time.Now}
}

const (
	maxRetries = 3
	retryBase  = 400 * time.Millisecond
)

var emptyHash = sha256hex(nil)

func sha256hex(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

func hmacSHA(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

// encode is RFC 3986 encoding, as SigV4 wants.
func encode(s string) string {
	return strings.ReplaceAll(url.QueryEscape(s), "+", "%20")
}

func (r *R2) request(ctx context.Context, method, key string, query map[string]string, body []byte) (*http.Response, []byte, error) {
	for attempt := 0; ; attempt++ {
		res, data, err := r.send(ctx, method, key, query, body)
		retry := err != nil || res.StatusCode == 429 || res.StatusCode >= 500
		if !retry || attempt >= maxRetries || ctx.Err() != nil {
			return res, data, err
		}
		time.Sleep(retryBase << attempt)
	}
}

func (r *R2) send(ctx context.Context, method, key string, query map[string]string, body []byte) (*http.Response, []byte, error) {
	date := r.now().UTC().Format("20060102T150405Z")
	day := date[:8]
	path := "/" + encode(r.creds.Bucket)
	if key != "" {
		parts := strings.Split(key, "/")
		for i, p := range parts {
			parts[i] = encode(p)
		}
		path += "/" + strings.Join(parts, "/")
	}
	names := make([]string, 0, len(query))
	for n := range query {
		names = append(names, n)
	}
	sort.Strings(names)
	var q []string
	for _, n := range names {
		q = append(q, encode(n)+"="+encode(query[n]))
	}
	canonicalQuery := strings.Join(q, "&")
	payloadHash := emptyHash
	if body != nil {
		payloadHash = sha256hex(body)
	}
	canonicalHeaders := "host:" + r.host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + date + "\n"
	signed := "host;x-amz-content-sha256;x-amz-date"
	canonical := strings.Join([]string{method, path, canonicalQuery, canonicalHeaders, signed, payloadHash}, "\n")
	scope := day + "/auto/s3/aws4_request"
	toSign := strings.Join([]string{"AWS4-HMAC-SHA256", date, scope, sha256hex([]byte(canonical))}, "\n")
	k := hmacSHA(hmacSHA(hmacSHA(hmacSHA([]byte("AWS4"+r.creds.SecretAccessKey), day), "auto"), "s3"), "aws4_request")
	signature := hex.EncodeToString(hmacSHA(k, toSign))

	u := r.Endpoint + path
	if canonicalQuery != "" {
		u += "?" + canonicalQuery
	}
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rd)
	if err != nil {
		return nil, nil, err
	}
	req.Host = r.host
	req.Header.Set("x-amz-content-sha256", payloadHash)
	req.Header.Set("x-amz-date", date)
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+r.creds.AccessKeyID+"/"+scope+", SignedHeaders="+signed+", Signature="+signature)
	if body != nil {
		req.Header.Set("Content-Type", "application/octet-stream")
	}
	res, err := r.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	return res, data, err
}

func xmlValues(s, tag string) []string {
	re := regexp.MustCompile("<" + tag + ">([\\s\\S]*?)</" + tag + ">")
	var out []string
	for _, m := range re.FindAllStringSubmatch(s, -1) {
		out = append(out, html.UnescapeString(m[1]))
	}
	return out
}

func first(v []string) string {
	if len(v) > 0 {
		return v[0]
	}
	return ""
}

func fail(res *http.Response, data []byte) error {
	s := string(data)
	return &R2Error{Status: res.StatusCode, Code: first(xmlValues(s, "Code")), Msg: first(xmlValues(s, "Message"))}
}

// List lists every object under prefix.
func (r *R2) List(ctx context.Context, prefix string) ([]Object, error) {
	var all []Object
	token := ""
	contents := regexp.MustCompile(`<Contents>([\s\S]*?)</Contents>`)
	for {
		q := map[string]string{"list-type": "2", "prefix": prefix, "max-keys": "1000"}
		if token != "" {
			q["continuation-token"] = token
		}
		res, data, err := r.request(ctx, http.MethodGet, "", q, nil)
		if err != nil {
			return nil, err
		}
		if res.StatusCode >= 300 {
			return nil, fail(res, data)
		}
		s := string(data)
		for _, m := range contents.FindAllStringSubmatch(s, -1) {
			t, _ := time.Parse(time.RFC3339, first(xmlValues(m[1], "LastModified")))
			var size int64
			fmt.Sscan(first(xmlValues(m[1], "Size")), &size)
			all = append(all, Object{Key: first(xmlValues(m[1], "Key")), LastModified: t, Size: size})
		}
		if first(xmlValues(s, "IsTruncated")) != "true" {
			return all, nil
		}
		token = first(xmlValues(s, "NextContinuationToken"))
	}
}

// Get returns an object, or nil when there is none.
func (r *R2) Get(ctx context.Context, key string) ([]byte, error) {
	res, data, err := r.request(ctx, http.MethodGet, key, nil, nil)
	if err != nil {
		return nil, err
	}
	if res.StatusCode == 404 {
		if first(xmlValues(string(data), "Code")) == "NoSuchBucket" {
			return nil, &R2Error{Status: 404, Code: "NoSuchBucket", Msg: "bucket missing"}
		}
		return nil, nil
	}
	if res.StatusCode >= 300 {
		return nil, fail(res, data)
	}
	return data, nil
}

// Head reports whether an object exists.
func (r *R2) Head(ctx context.Context, key string) (bool, error) {
	res, data, err := r.request(ctx, http.MethodHead, key, nil, nil)
	if err != nil {
		return false, err
	}
	if res.StatusCode == 404 {
		return false, nil
	}
	if res.StatusCode >= 300 {
		return false, fail(res, data)
	}
	return true, nil
}

// Put stores an object.
func (r *R2) Put(ctx context.Context, key string, body []byte) error {
	if body == nil {
		body = []byte{}
	}
	res, data, err := r.request(ctx, http.MethodPut, key, nil, body)
	if err != nil {
		return err
	}
	if res.StatusCode >= 300 {
		return fail(res, data)
	}
	return nil
}
