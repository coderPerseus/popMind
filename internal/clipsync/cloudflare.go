package clipsync

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Cloudflare REST calls of the first setup ("paste an R2 API token"), cloudflare-api.ts.

const cfAPI = "https://api.cloudflare.com/client/v4"

type cfError struct {
	Status int
	Codes  []int
	Msg    string
}

func (e *cfError) Error() string { return e.Msg }

func cfCall(ctx context.Context, token, method, path string, body any, out any) error {
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, cfAPI+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := (&http.Client{Timeout: 20 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var env struct {
		Success bool            `json:"success"`
		Result  json.RawMessage `json:"result"`
		Errors  []struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"errors"`
	}
	_ = json.NewDecoder(res.Body).Decode(&env)
	if res.StatusCode >= 300 || !env.Success {
		e := &cfError{Status: res.StatusCode}
		var msgs []string
		for _, x := range env.Errors {
			e.Codes = append(e.Codes, x.Code)
			msgs = append(msgs, fmt.Sprintf("%d %s", x.Code, x.Message))
		}
		e.Msg = strings.Join(msgs, "; ")
		if e.Msg == "" {
			e.Msg = fmt.Sprintf("HTTP %d", res.StatusCode)
		}
		return e
	}
	if out != nil {
		return json.Unmarshal(env.Result, out)
	}
	return nil
}

// verifyToken returns the token's id (R2's access key id); account tokens verify under the account.
func verifyToken(ctx context.Context, token, account string) (string, error) {
	var r struct {
		ID string `json:"id"`
	}
	err := cfCall(ctx, token, "GET", "/accounts/"+account+"/tokens/verify", nil, &r)
	if err != nil {
		if err2 := cfCall(ctx, token, "GET", "/user/tokens/verify", nil, &r); err2 != nil {
			return "", err
		}
	}
	return r.ID, nil
}

// detectAccount returns the only account the token sees, or "".
func detectAccount(ctx context.Context, token string) string {
	var accounts []struct {
		ID string `json:"id"`
	}
	if cfCall(ctx, token, "GET", "/accounts", nil, &accounts) != nil || len(accounts) != 1 {
		return ""
	}
	return accounts[0].ID
}

// ensureBucket creates the bucket unless it exists.
func ensureBucket(ctx context.Context, token, account, bucket string) error {
	err := cfCall(ctx, token, "GET", "/accounts/"+account+"/r2/buckets/"+bucket, nil, nil)
	if err == nil {
		return nil
	}
	if ce, ok := err.(*cfError); !ok || ce.Status != 404 {
		return err
	}
	return cfCall(ctx, token, "POST", "/accounts/"+account+"/r2/buckets", map[string]string{"name": bucket}, nil)
}
