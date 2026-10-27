package translation

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/md5"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"

var httpClient = &http.Client{Timeout: 15 * time.Second}

func do(ctx context.Context, method, endpoint string, body io.Reader, headers map[string]string) (*http.Response, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	return resp, data, err
}

// ---- Google ----

func googleRequest(ctx context.Context, text, source, target string) (translated, detected string, err error) {
	q := url.Values{"client": {"gtx"}, "sl": {source}, "tl": {target}, "dt": {"t"}, "dj": {"1"}, "ie": {"UTF-8"}, "q": {text}}
	resp, data, err := do(ctx, http.MethodGet, "https://translate.googleapis.com/translate_a/single?"+q.Encode(), nil, nil)
	if err != nil {
		return "", "", err
	}
	if resp.StatusCode != 200 {
		return "", "", fmt.Errorf("Google translate request failed with status %d", resp.StatusCode)
	}
	var payload struct {
		Src       string `json:"src"`
		Sentences []struct {
			Trans string `json:"trans"`
		} `json:"sentences"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return "", "", err
	}
	var b strings.Builder
	for _, s := range payload.Sentences {
		b.WriteString(s.Trans)
	}
	return strings.TrimSpace(b.String()), payload.Src, nil
}

func googleTranslate(ctx context.Context, r Request) (Result, error) {
	text, src, err := googleRequest(ctx, r.Text, r.SourceLanguage, r.TargetLanguage)
	if err != nil {
		return Result{}, err
	}
	if text == "" {
		return Result{}, errors.New("Google translate returned an empty result")
	}
	return textResult(Google, r, text, cmpOr(src, r.SourceLanguage)), nil
}

func googleDetect(ctx context.Context, text string) (string, error) {
	_, src, err := googleRequest(ctx, text, "auto", "en")
	return cmpOr(src, "auto"), err
}

// ---- Bing ----

type bingConfig struct {
	host, ig, iid, key, token string
	refreshAt                 time.Time
}

var (
	bingMu     sync.Mutex
	bingCached *bingConfig
)

func bingCode(l string) string {
	switch l {
	case "auto":
		return "auto-detect"
	case "zh-CN":
		return "zh-Hans"
	case "zh-TW":
		return "zh-Hant"
	case "pt":
		return "pt-PT"
	}
	return l
}

func fromBing(l string) string {
	switch strings.ToLower(l) {
	case "", "auto-detect":
		return "auto"
	case "zh-hans":
		return "zh-CN"
	case "zh-hant":
		return "zh-TW"
	case "pt-pt", "pt":
		return "pt"
	}
	return l
}

var (
	bingIG   = regexp.MustCompile(`IG:\s*"([^"]+)"`)
	bingIID  = regexp.MustCompile(`data-iid\s*=\s*"([^"]+)"`)
	bingHelp = regexp.MustCompile(`params_AbusePreventionHelper\s*=\s*\[([^\]]+)\]`)
)

func bingFetchConfig(ctx context.Context, force bool) (*bingConfig, error) {
	bingMu.Lock()
	defer bingMu.Unlock()
	if !force && bingCached != nil && time.Now().Before(bingCached.refreshAt) {
		return bingCached, nil
	}
	host := "cn.bing.com"
	if resp, _, err := do(ctx, http.MethodGet, "http://cn.bing.com", nil, nil); err == nil && resp.Request != nil {
		host = cmpOr(resp.Request.URL.Host, host)
	}
	resp, data, err := do(ctx, http.MethodGet, "https://"+host+"/translator", nil, nil)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Bing translator page request failed with status %d", resp.StatusCode)
	}
	if resp.Request != nil && resp.Request.URL.Host != "" {
		host = resp.Request.URL.Host
	}
	html := string(data)
	ig, iid, helper := submatch(bingIG, html), submatch(bingIID, html), submatch(bingHelp, html)
	if ig == "" || iid == "" || helper == "" {
		return nil, errors.New("Bing translator config parse failed")
	}
	parts := strings.Split(strings.ReplaceAll(helper, `"`, ""), ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return nil, errors.New("Bing translator token parse failed")
	}
	issued, _ := strconv.ParseInt(parts[0], 10, 64)
	ttl := int64(3_600_000)
	if len(parts) > 2 {
		if v, err := strconv.ParseInt(parts[2], 10, 64); err == nil && v > 0 {
			ttl = v
		}
	}
	refresh := time.Now().Add(time.Duration(ttl/2) * time.Millisecond)
	if issued > 0 {
		refresh = time.UnixMilli(issued + ttl/2)
	}
	bingCached = &bingConfig{host: host, ig: ig, iid: iid, key: parts[0], token: parts[1], refreshAt: refresh}
	return bingCached, nil
}

type bingItem struct {
	DetectedLanguage struct {
		Language string `json:"language"`
	} `json:"detectedLanguage"`
	Translations []struct {
		Text string `json:"text"`
	} `json:"translations"`
}

func bingRequest(ctx context.Context, r Request) ([]bingItem, error) {
	for attempt := 0; ; attempt++ {
		cfg, err := bingFetchConfig(ctx, attempt > 0)
		if err != nil {
			return nil, err
		}
		form := url.Values{"text": {r.Text}, "fromLang": {bingCode(r.SourceLanguage)}, "to": {bingCode(r.TargetLanguage)},
			"token": {cfg.token}, "key": {cfg.key}, "tryFetchingGenderDebiasedTranslations": {"true"}}
		endpoint := fmt.Sprintf("https://%s/ttranslatev3?%s", cfg.host, url.Values{"isVertical": {"1"}, "IG": {cfg.ig}, "IID": {cfg.iid}}.Encode())
		resp, data, err := do(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()), map[string]string{
			"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
			"Referer":      "https://" + cfg.host + "/translator",
		})
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("Bing translate request failed with status %d", resp.StatusCode)
		}
		var items []bingItem
		if json.Unmarshal(data, &items) == nil {
			return items, nil
		}
		if attempt >= 1 {
			return nil, errors.New("Bing translate returned an unexpected payload")
		}
	}
}

func bingTranslate(ctx context.Context, r Request) (Result, error) {
	items, err := bingRequest(ctx, r)
	if err != nil {
		return Result{}, err
	}
	if len(items) == 0 {
		return Result{}, errors.New("Bing translate returned an empty result")
	}
	var lines []string
	for _, t := range items[0].Translations {
		if s := strings.TrimSpace(t.Text); s != "" {
			lines = append(lines, s)
		}
	}
	if len(lines) == 0 {
		return Result{}, errors.New("Bing translate returned an empty result")
	}
	return textResult(Bing, r, strings.Join(lines, "\n"), fromBing(items[0].DetectedLanguage.Language)), nil
}

func bingDetect(ctx context.Context, text string) (string, error) {
	items, err := bingRequest(ctx, Request{Text: text, SourceLanguage: "auto", TargetLanguage: "en"})
	if err != nil || len(items) == 0 {
		return "auto", err
	}
	return fromBing(items[0].DetectedLanguage.Language), nil
}

// ---- DeepL ----

func deeplCode(l string) string {
	switch l {
	case "zh-CN":
		return "zh-Hans"
	case "zh-TW":
		return "zh-Hant"
	case "pt":
		return "pt-PT"
	}
	return l
}

func fromDeepL(l string) string {
	switch strings.ToLower(l) {
	case "":
		return "auto"
	case "zh":
		return "zh-CN"
	}
	return strings.ToLower(l)
}

func deeplRequest(ctx context.Context, text, source, target string) (translated, detected string, err error) {
	id := (rand.IntN(189998-100000+1) + 100000) * 1000
	iCount := strings.Count(text, "i")
	ts := time.Now().UnixMilli()
	if iCount > 0 {
		n := int64(iCount + 1)
		ts = ts - ts%n + n
	}
	variant := deeplCode(target)
	targetCode := strings.ToLower(strings.Split(variant, "-")[0])
	params := map[string]any{
		"texts":     []map[string]any{{"text": text, "requestAlternatives": 3}},
		"splitting": "newlines",
		"lang": map[string]string{
			"source_lang_user_selected": strings.ToLower(strings.Split(deeplCode(source), "-")[0]),
			"target_lang":               targetCode,
		},
		"timestamp": ts,
	}
	if !strings.EqualFold(variant, targetCode) {
		params["commonJobParams"] = map[string]any{"regionalVariant": variant, "mode": "translate", "browserType": 1, "textType": "plaintext"}
	}
	data, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "method": "LMT_handle_texts", "id": id, "params": params})
	body := string(data)
	if (id+5)%29 == 0 || (id+3)%13 == 0 {
		body = strings.Replace(body, `"method":"`, `"method" : "`, 1)
	} else {
		body = strings.Replace(body, `"method":"`, `"method": "`, 1)
	}
	resp, out, err := do(ctx, http.MethodPost, "https://www2.deepl.com/jsonrpc", strings.NewReader(body), map[string]string{"Content-Type": "application/json"})
	if err != nil {
		return "", "", err
	}
	if resp.StatusCode != 200 {
		return "", "", fmt.Errorf("DeepL translate request failed with status %d", resp.StatusCode)
	}
	var payload struct {
		Result struct {
			Lang  string `json:"lang"`
			Texts []struct {
				Text string `json:"text"`
			} `json:"texts"`
		} `json:"result"`
	}
	if err := json.Unmarshal(out, &payload); err != nil {
		return "", "", err
	}
	if len(payload.Result.Texts) > 0 {
		translated = strings.TrimSpace(payload.Result.Texts[0].Text)
	}
	return translated, fromDeepL(payload.Result.Lang), nil
}

func deeplTranslate(ctx context.Context, r Request) (Result, error) {
	text, detected, err := deeplRequest(ctx, r.Text, r.SourceLanguage, r.TargetLanguage)
	if err != nil {
		return Result{}, err
	}
	if text == "" {
		return Result{}, errors.New("DeepL translate returned an empty result")
	}
	return textResult(DeepL, r, text, detected), nil
}

func deeplDetect(ctx context.Context, text string) (string, error) {
	_, detected, err := deeplRequest(ctx, text, "auto", "en")
	return detected, err
}

// ---- Youdao ----

const (
	youdaoBase          = "https://dict.youdao.com"
	youdaoDefaultSecret = "asdjnjfenknafdfsdfsd"
	youdaoDictSecret    = "Mk6hqtUp33DGGtoS63tTJbMUYjRrG1Lu"
)

var youdaoHeaders = map[string]string{
	"Referer": "https://fanyi.youdao.com",
	"Cookie":  "OUTFOX_SEARCH_USER_ID=1796239350@10.110.96.157;",
}

type youdaoKey struct {
	secret, aesKey, aesIV string
	expires               time.Time
}

var (
	youdaoMu   sync.Mutex
	youdaoKey_ *youdaoKey
)

func md5hex(s string) string { sum := md5.Sum([]byte(s)); return hex.EncodeToString(sum[:]) }

func youdaoSign(ts, secret string) string {
	return md5hex("client=fanyideskweb&mysticTime=" + ts + "&product=webfanyi&key=" + secret)
}

func youdaoCode(l string) string {
	switch l {
	case "auto":
		return "AUTO"
	case "zh-CN":
		return "zh-CHS"
	case "zh-TW":
		return "zh-CHT"
	}
	return l
}

func fromYoudao(l string) string {
	switch strings.ToLower(l) {
	case "", "auto":
		return "auto"
	case "zh-chs":
		return "zh-CN"
	case "zh-cht":
		return "zh-TW"
	}
	return l
}

func youdaoFetchKey(ctx context.Context, force bool) (*youdaoKey, error) {
	youdaoMu.Lock()
	defer youdaoMu.Unlock()
	if !force && youdaoKey_ != nil && time.Now().Before(youdaoKey_.expires) {
		return youdaoKey_, nil
	}
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	q := url.Values{"client": {"fanyideskweb"}, "product": {"webfanyi"}, "appVersion": {"1.0.0"}, "vendor": {"web"},
		"pointParam": {"client,mysticTime,product"}, "keyfrom": {"fanyi.web"}, "keyid": {"webfanyi-key-getter"},
		"sign": {youdaoSign(ts, youdaoDefaultSecret)}, "mysticTime": {ts}}
	resp, data, err := do(ctx, http.MethodGet, youdaoBase+"/webtranslate/key?"+q.Encode(), nil, youdaoHeaders)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Youdao key request failed with status %d", resp.StatusCode)
	}
	var payload struct {
		Code int `json:"code"`
		Data struct {
			SecretKey string `json:"secretKey"`
			AesKey    string `json:"aesKey"`
			AesIv     string `json:"aesIv"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &payload); err != nil || payload.Code != 0 || payload.Data.SecretKey == "" {
		return nil, errors.New("Youdao key response is invalid")
	}
	youdaoKey_ = &youdaoKey{secret: payload.Data.SecretKey, aesKey: payload.Data.AesKey, aesIV: payload.Data.AesIv,
		expires: time.Now().Add(10 * time.Minute)}
	return youdaoKey_, nil
}

func youdaoDecrypt(encrypted, key, iv string) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.NewReplacer("-", "+", "_", "/").Replace(strings.TrimSpace(encrypted)))
	if err != nil {
		return nil, err
	}
	k := md5.Sum([]byte(key))
	v := md5.Sum([]byte(iv))
	block, err := aes.NewCipher(k[:])
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 || len(raw)%aes.BlockSize != 0 {
		return nil, errors.New("bad ciphertext")
	}
	out := make([]byte, len(raw))
	cipher.NewCBCDecrypter(block, v[:]).CryptBlocks(out, raw)
	pad := int(out[len(out)-1])
	if pad == 0 || pad > aes.BlockSize || pad > len(out) {
		return nil, errors.New("bad padding")
	}
	return out[:len(out)-pad], nil
}

type youdaoPayload struct {
	Code            int    `json:"code"`
	Type            string `json:"type"`
	TranslateResult [][]struct {
		Tgt string `json:"tgt"`
	} `json:"translateResult"`
}

func youdaoRequest(ctx context.Context, r Request) (youdaoPayload, error) {
	var payload youdaoPayload
	for attempt := 0; ; attempt++ {
		key, err := youdaoFetchKey(ctx, attempt > 0)
		if err != nil {
			return payload, err
		}
		ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
		form := url.Values{"client": {"fanyideskweb"}, "product": {"webfanyi"}, "appVersion": {"1.0.0"}, "vendor": {"web"},
			"pointParam": {"client,mysticTime,product"}, "keyfrom": {"fanyi.web"}, "keyid": {"webfanyi"},
			"sign": {youdaoSign(ts, key.secret)}, "mysticTime": {ts}, "i": {r.Text},
			"from": {youdaoCode(r.SourceLanguage)}, "to": {youdaoCode(r.TargetLanguage)}, "dictResult": {"false"}}
		headers := map[string]string{"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
		for k, v := range youdaoHeaders {
			headers[k] = v
		}
		resp, data, err := do(ctx, http.MethodPost, youdaoBase+"/webtranslate", strings.NewReader(form.Encode()), headers)
		if err != nil {
			return payload, err
		}
		if resp.StatusCode != 200 {
			return payload, fmt.Errorf("Youdao translate request failed with status %d", resp.StatusCode)
		}
		plain, err := youdaoDecrypt(string(data), key.aesKey, key.aesIV)
		if err == nil {
			err = json.Unmarshal(plain, &payload)
		}
		if err == nil {
			return payload, nil
		}
		if attempt >= 1 {
			return payload, fmt.Errorf("Youdao translate response parse failed: %w", err)
		}
	}
}

func youdaoDetected(t string) string {
	if !strings.Contains(t, "2") {
		return "auto"
	}
	return fromYoudao(strings.Split(t, "2")[0])
}

type youdaoDict struct {
	Simple struct {
		Word []struct {
			Usphone      string `json:"usphone"`
			Ukphone      string `json:"ukphone"`
			ReturnPhrase string `json:"return-phrase"`
		} `json:"word"`
	} `json:"simple"`
	Ec struct {
		Word struct {
			Usphone      string `json:"usphone"`
			Ukphone      string `json:"ukphone"`
			ReturnPhrase string `json:"return-phrase"`
			Trs          []struct {
				Pos  string `json:"pos"`
				Tran string `json:"tran"`
			} `json:"trs"`
			Wfs []struct {
				Wf struct {
					Name  string `json:"name"`
					Value string `json:"value"`
				} `json:"wf"`
			} `json:"wfs"`
		} `json:"word"`
	} `json:"ec"`
	Phrs struct {
		Phrs []struct {
			Headword    string `json:"headword"`
			Translation string `json:"translation"`
		} `json:"phrs"`
	} `json:"phrs"`
	BlngSentsPart struct {
		SentencePair []struct {
			SentenceEng         string `json:"sentence-eng"`
			Sentence            string `json:"sentence"`
			SentenceTranslation string `json:"sentence-translation"`
		} `json:"sentence-pair"`
	} `json:"blng_sents_part"`
}

var htmlTags = regexp.MustCompile(`<[^>]+>`)

func youdaoWord(ctx context.Context, text string) (*WordEntry, error) {
	ww := text + "webdict"
	t := strconv.Itoa(len(ww) % 10)
	salt := md5hex(ww)
	form := url.Values{"q": {text}, "le": {"en"}, "client": {"web"}, "t": {t},
		"sign": {md5hex("web" + text + t + youdaoDictSecret + salt)}, "keyfrom": {"webdict"}}
	headers := map[string]string{"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}
	for k, v := range youdaoHeaders {
		headers[k] = v
	}
	resp, data, err := do(ctx, http.MethodPost, youdaoBase+"/jsonapi_s?doctype=json&jsonversion=4", strings.NewReader(form.Encode()), headers)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Youdao dictionary request failed with status %d", resp.StatusCode)
	}
	var p youdaoDict
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, err
	}
	w := &WordEntry{Headword: text}
	var simpleUS, simpleUK, simplePhrase string
	if len(p.Simple.Word) > 0 {
		simpleUS, simpleUK, simplePhrase = p.Simple.Word[0].Usphone, p.Simple.Word[0].Ukphone, p.Simple.Word[0].ReturnPhrase
	}
	w.Headword = cmpOr(p.Ec.Word.ReturnPhrase, simplePhrase, text)
	if us := cmpOr(p.Ec.Word.Usphone, simpleUS); us != "" {
		w.Phonetics = append(w.Phonetics, WordPhonetic{"US", us})
	}
	if uk := cmpOr(p.Ec.Word.Ukphone, simpleUK); uk != "" {
		w.Phonetics = append(w.Phonetics, WordPhonetic{"UK", uk})
	}
	for _, tr := range p.Ec.Word.Trs {
		if m := strings.TrimSpace(tr.Tran); m != "" {
			w.Definitions = append(w.Definitions, WordDefinition{strings.TrimSpace(tr.Pos), m})
		}
	}
	for _, f := range p.Ec.Word.Wfs {
		if f.Wf.Name != "" && f.Wf.Value != "" {
			w.Forms = append(w.Forms, WordForm{strings.TrimSpace(f.Wf.Name), strings.TrimSpace(f.Wf.Value)})
		}
	}
	for _, ph := range p.Phrs.Phrs {
		if ph.Headword != "" && ph.Translation != "" && len(w.Phrases) < 8 {
			w.Phrases = append(w.Phrases, WordPhrase{strings.TrimSpace(ph.Headword), strings.TrimSpace(ph.Translation)})
		}
	}
	for _, s := range p.BlngSentsPart.SentencePair {
		src := strings.TrimSpace(htmlTags.ReplaceAllString(cmpOr(s.SentenceEng, s.Sentence), ""))
		if src != "" && s.SentenceTranslation != "" && len(w.Examples) < 3 {
			w.Examples = append(w.Examples, WordExample{src, strings.TrimSpace(s.SentenceTranslation)})
		}
	}
	return w, nil
}

func youdaoTranslate(ctx context.Context, r Request) (Result, error) {
	if r.QueryMode == "word" {
		w, err := youdaoWord(ctx, r.Text)
		if err != nil {
			return Result{}, err
		}
		if len(w.Definitions) == 0 && len(w.Phrases) == 0 {
			return Result{}, errors.New("查无此词～")
		}
		var lines []string
		for _, d := range w.Definitions {
			lines = append(lines, strings.TrimSpace(d.Part+" "+d.Meaning))
		}
		res := textResult(Youdao, r, strings.Join(lines, "\n"), "en")
		res.QueryMode = "word"
		res.Word = w
		return res, nil
	}
	p, err := youdaoRequest(ctx, r)
	if err != nil {
		return Result{}, err
	}
	if p.Code != 0 {
		return Result{}, fmt.Errorf("Youdao translate failed with code %d", p.Code)
	}
	var lines []string
	for _, group := range p.TranslateResult {
		var b strings.Builder
		for _, item := range group {
			b.WriteString(item.Tgt)
		}
		lines = append(lines, b.String())
	}
	text := strings.TrimSpace(strings.Join(lines, "\n"))
	if text == "" {
		return Result{}, errors.New("Youdao translate returned an empty result")
	}
	return textResult(Youdao, r, text, youdaoDetected(p.Type)), nil
}

func youdaoDetect(ctx context.Context, text string) (string, error) {
	p, err := youdaoRequest(ctx, Request{Text: text, SourceLanguage: "auto", TargetLanguage: "en"})
	return youdaoDetected(p.Type), err
}

// ---- helpers ----

func textResult(engine string, r Request, translated, detected string) Result {
	return Result{Engine: engine, QueryMode: "text", SourceLanguage: r.SourceLanguage, TargetLanguage: r.TargetLanguage,
		SourceText: Trim(r.Text), TranslatedText: translated, DetectedSourceLanguage: cmpOr(detected, r.SourceLanguage)}
}

func submatch(re *regexp.Regexp, s string) string {
	if m := re.FindStringSubmatch(s); len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

func cmpOr(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
