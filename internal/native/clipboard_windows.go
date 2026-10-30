package native

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The clipboard on Windows, under the names the app uses on macOS (UTIs), so that the clipboard history
// reads and writes it the same way:
//
//	public.utf8-plain-text  CF_UNICODETEXT
//	public.html             "HTML Format" (CF_HTML, its header taken off and put back)
//	public.rtf              "Rich Text Format"
//	public.png              "PNG", else CF_DIB turned into a PNG
//	public.file-url         CF_HDROP, as file:// URLs, one a line
//
// Password managers mark their copies with "ExcludeClipboardContentFromMonitorProcessing" or
// "CanIncludeInClipboardHistory" = 0: they read as concealed, which the history skips.

var (
	procOpenClipboard              = user32.NewProc("OpenClipboard")
	procCloseClipboard             = user32.NewProc("CloseClipboard")
	procEmptyClipboard             = user32.NewProc("EmptyClipboard")
	procGetClipboardData           = user32.NewProc("GetClipboardData")
	procSetClipboardData           = user32.NewProc("SetClipboardData")
	procEnumClipboardFormats       = user32.NewProc("EnumClipboardFormats")
	procRegisterClipboardFormatW   = user32.NewProc("RegisterClipboardFormatW")
	procGetClipboardFormatNameW    = user32.NewProc("GetClipboardFormatNameW")
	procGetClipboardOwner          = user32.NewProc("GetClipboardOwner")
	procIsClipboardFormatAvailable = user32.NewProc("IsClipboardFormatAvailable")
	procGlobalAlloc                = kernel32.NewProc("GlobalAlloc")
	procGlobalFree                 = kernel32.NewProc("GlobalFree")
	procGlobalLock                 = kernel32.NewProc("GlobalLock")
	procGlobalUnlock               = kernel32.NewProc("GlobalUnlock")
	procGlobalSize                 = kernel32.NewProc("GlobalSize")
)

const (
	cfUnicodeText = 13
	cfDIB         = 8
	cfDIBV5       = 17
	cfHDROP       = 15
	gmemMoveable  = 0x0002
)

const (
	utiText8   = "public.utf8-plain-text"
	utiHTML    = "public.html"
	utiRTF     = "public.rtf"
	utiPNG     = "public.png"
	utiFileURL = "public.file-url"
)

var (
	formatsOnce                                          sync.Once
	cfHTML, cfRTF, cfPNG, cfMarker, cfExclude, cfHistory uintptr
)

// markerFormat names the clipboard format popMind marks its own writes with (the item's ID), as on macOS.
const markerFormat = "com.popmind.clipboard-item-id"

func registerFormats() {
	formatsOnce.Do(func() {
		reg := func(name string) uintptr {
			p, _ := windows.UTF16PtrFromString(name)
			r, _, _ := procRegisterClipboardFormatW.Call(uintptr(unsafe.Pointer(p)))
			return r
		}
		cfHTML = reg("HTML Format")
		cfRTF = reg("Rich Text Format")
		cfPNG = reg("PNG")
		cfMarker = reg(markerFormat)
		cfExclude = reg("ExcludeClipboardContentFromMonitorProcessing")
		cfHistory = reg("CanIncludeInClipboardHistory")
	})
}

// openClipboard opens the clipboard, waiting a little for another app to close it.
func openClipboard() error {
	for i := 0; i < 20; i++ {
		if r, _, _ := procOpenClipboard.Call(0); r != 0 {
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return errors.New("clipboard busy")
}

func closeClipboard() { procCloseClipboard.Call() }

// sysPtr turns an address of memory the system owns (a locked global, a hook's struct) into a pointer;
// the Go collector never moves that memory.
func sysPtr(p uintptr) unsafe.Pointer { return *(*unsafe.Pointer)(unsafe.Pointer(&p)) }

// globalBytes copies the memory of a clipboard handle.
func globalBytes(h uintptr) []byte {
	if h == 0 {
		return nil
	}
	size, _, _ := procGlobalSize.Call(h)
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 || size == 0 {
		return nil
	}
	defer procGlobalUnlock.Call(h)
	return bytes.Clone(unsafe.Slice((*byte)(sysPtr(p)), int(size)))
}

func formatData(format uintptr) []byte {
	h, _, _ := procGetClipboardData.Call(format)
	return globalBytes(h)
}

func formatName(format uintptr) string {
	switch format {
	case cfUnicodeText:
		return "CF_UNICODETEXT"
	case cfDIB:
		return "CF_DIB"
	case cfDIBV5:
		return "CF_DIBV5"
	case cfHDROP:
		return "CF_HDROP"
	}
	buf := make([]uint16, 256)
	n, _, _ := procGetClipboardFormatNameW.Call(format, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if n == 0 {
		return "CF_" + strconv.Itoa(int(format))
	}
	return windows.UTF16ToString(buf[:n])
}

func utf16Text(data []byte) string {
	if len(data) < 2 {
		return ""
	}
	u := unsafe.Slice((*uint16)(unsafe.Pointer(&data[0])), len(data)/2)
	for i, c := range u {
		if c == 0 {
			u = u[:i]
			break
		}
	}
	return string(utf16.Decode(u))
}

// cfHTMLFragment takes the header off CF_HTML: the HTML from StartHTML (else StartFragment) to its end.
func cfHTMLFragment(data []byte) []byte {
	s := string(bytes.TrimRight(data, "\x00"))
	field := func(name string) int {
		m := regexp.MustCompile(name + `:(\d+)`).FindStringSubmatch(s)
		if m == nil {
			return -1
		}
		n, _ := strconv.Atoi(m[1])
		return n
	}
	start, end := field("StartHTML"), field("EndHTML")
	if start < 0 || start > len(s) {
		start, end = field("StartFragment"), field("EndFragment")
	}
	if start < 0 || start > len(s) {
		return []byte(s)
	}
	if end < start || end > len(s) {
		end = len(s)
	}
	return []byte(s[start:end])
}

// makeCFHTML wraps html in CF_HTML's header, its offsets in bytes of UTF-8.
func makeCFHTML(html []byte) []byte {
	const tmpl = "Version:0.9\r\nStartHTML:%010d\r\nEndHTML:%010d\r\nStartFragment:%010d\r\nEndFragment:%010d\r\n"
	body := string(html)
	if !strings.Contains(strings.ToLower(body), "<html") {
		body = "<html><body><!--StartFragment-->" + body + "<!--EndFragment--></body></html>"
	}
	headerLen := len(fmt.Sprintf(tmpl, 0, 0, 0, 0))
	startFrag := strings.Index(body, "<!--StartFragment-->")
	endFrag := strings.Index(body, "<!--EndFragment-->")
	if startFrag < 0 || endFrag < 0 {
		startFrag, endFrag = 0, len(body)
	} else {
		startFrag += len("<!--StartFragment-->")
	}
	header := fmt.Sprintf(tmpl, headerLen, headerLen+len(body), headerLen+startFrag, headerLen+endFrag)
	return append([]byte(header+body), 0)
}

// hdropPaths reads the file paths of a DROPFILES block.
func hdropPaths(data []byte) []string {
	if len(data) < 20 {
		return nil
	}
	offset := binary.LittleEndian.Uint32(data[0:4])
	wide := binary.LittleEndian.Uint32(data[16:20]) != 0
	if int(offset) >= len(data) {
		return nil
	}
	rest := data[offset:]
	var paths []string
	if wide {
		u := unsafe.Slice((*uint16)(unsafe.Pointer(&rest[0])), len(rest)/2)
		start := 0
		for i, c := range u {
			if c == 0 {
				if i == start {
					break
				}
				paths = append(paths, string(utf16.Decode(u[start:i])))
				start = i + 1
			}
		}
	} else {
		for _, p := range bytes.Split(rest, []byte{0}) {
			if len(p) == 0 {
				break
			}
			paths = append(paths, string(p))
		}
	}
	return paths
}

// makeHDROP builds a DROPFILES block for paths.
func makeHDROP(paths []string) []byte {
	var buf bytes.Buffer
	header := make([]byte, 20)
	binary.LittleEndian.PutUint32(header[0:4], 20)
	binary.LittleEndian.PutUint32(header[16:20], 1)
	buf.Write(header)
	for _, p := range paths {
		for _, c := range utf16.Encode([]rune(p)) {
			_ = binary.Write(&buf, binary.LittleEndian, c)
		}
		buf.Write([]byte{0, 0})
	}
	buf.Write([]byte{0, 0})
	return buf.Bytes()
}

func fileURL(path string) string {
	return (&url.URL{Scheme: "file", Path: "/" + filepath.ToSlash(path)}).String()
}

// filePath turns a file:// URL (file:///C:/x) back into a Windows path.
func filePath(u string) string {
	parsed, err := url.Parse(strings.TrimSpace(u))
	if err != nil || parsed.Scheme != "file" {
		return ""
	}
	p := strings.TrimPrefix(parsed.Path, "/")
	if parsed.Host != "" {
		p = `\\` + parsed.Host + "/" + p
	}
	return filepath.FromSlash(p)
}

// dibToImage decodes a packed DIB (BITMAPINFOHEADER and its pixels), 24 or 32 bits a pixel.
func dibToImage(data []byte) (image.Image, error) {
	if len(data) < 40 {
		return nil, errors.New("short DIB")
	}
	hdrSize := int(binary.LittleEndian.Uint32(data[0:4]))
	width := int(int32(binary.LittleEndian.Uint32(data[4:8])))
	height := int(int32(binary.LittleEndian.Uint32(data[8:12])))
	bpp := int(binary.LittleEndian.Uint16(data[14:16]))
	compression := binary.LittleEndian.Uint32(data[16:20])
	colors := int(binary.LittleEndian.Uint32(data[32:36]))
	if width <= 0 || height == 0 || (bpp != 24 && bpp != 32) {
		return nil, fmt.Errorf("unsupported DIB: %dx%d at %d bits", width, height, bpp)
	}
	topDown := height < 0
	if topDown {
		height = -height
	}
	offset := hdrSize + colors*4
	if compression == 3 && hdrSize == 40 { // BI_BITFIELDS: three masks after the header
		offset += 12
	}
	stride := ((width*bpp + 31) / 32) * 4
	if offset+stride*height > len(data) {
		return nil, errors.New("truncated DIB")
	}
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	// 32-bit DIBs often leave alpha at zero: then they are opaque.
	alphaUsed := false
	if bpp == 32 {
		for i := offset + 3; i < offset+stride*height; i += 4 {
			if data[i] != 0 {
				alphaUsed = true
				break
			}
		}
	}
	for y := 0; y < height; y++ {
		row := y
		if !topDown {
			row = height - 1 - y
		}
		line := data[offset+row*stride:]
		for x := 0; x < width; x++ {
			b, g, r := line[x*bpp/8], line[x*bpp/8+1], line[x*bpp/8+2]
			a := uint8(255)
			if bpp == 32 && alphaUsed {
				a = line[x*4+3]
			}
			img.SetNRGBA(x, y, color.NRGBA{r, g, b, a})
		}
	}
	return img, nil
}

// imageToDIB encodes an image as a 32-bit, bottom-up DIB, which every Windows app pastes.
func imageToDIB(img image.Image) []byte {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	var buf bytes.Buffer
	header := make([]byte, 40)
	binary.LittleEndian.PutUint32(header[0:4], 40)
	binary.LittleEndian.PutUint32(header[4:8], uint32(w))
	binary.LittleEndian.PutUint32(header[8:12], uint32(h))
	binary.LittleEndian.PutUint16(header[12:14], 1)
	binary.LittleEndian.PutUint16(header[14:16], 32)
	binary.LittleEndian.PutUint32(header[20:24], uint32(w*h*4))
	buf.Write(header)
	for y := h - 1; y >= 0; y-- {
		for x := 0; x < w; x++ {
			c := color.NRGBAModel.Convert(img.At(b.Min.X+x, b.Min.Y+y)).(color.NRGBA)
			buf.Write([]byte{c.B, c.G, c.R, c.A})
		}
	}
	return buf.Bytes()
}

func encodePNG(img image.Image) []byte {
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

// ConvertImageToPNG re-encodes an image the clipboard held: a PNG as it is, a DIB as a PNG.
func ConvertImageToPNG(data []byte) (ConvertedImage, error) {
	if img, err := png.Decode(bytes.NewReader(data)); err == nil {
		b := img.Bounds()
		return ConvertedImage{PNG: data, Width: b.Dx(), Height: b.Dy()}, nil
	}
	img, err := dibToImage(data)
	if err != nil {
		return ConvertedImage{}, err
	}
	b := img.Bounds()
	return ConvertedImage{PNG: encodePNG(img), Width: b.Dx(), Height: b.Dy()}, nil
}

// ReadPasteboard reads the clipboard as one item of macOS types (Windows holds one item at a time).
func ReadPasteboard(opts PasteboardReadOptions) (PasteboardContent, error) {
	registerFormats()
	if err := openClipboard(); err != nil {
		return PasteboardContent{}, err
	}
	defer closeClipboard()
	out := PasteboardContent{ChangeCount: ClipboardChangeCount()}
	allowed := func(t string) bool {
		if len(opts.AllowTypes) == 0 {
			return true
		}
		for _, a := range opts.AllowTypes {
			if a == t {
				return true
			}
		}
		return false
	}
	var formats []uintptr
	for f := uintptr(0); ; {
		f, _, _ = procEnumClipboardFormats.Call(f)
		if f == 0 {
			break
		}
		formats = append(formats, f)
		out.AllTypes = append(out.AllTypes, formatName(f))
	}
	has := func(f uintptr) bool {
		for _, x := range formats {
			if x == f {
				return true
			}
		}
		return false
	}
	if has(cfExclude) {
		out.Flags.Concealed = true
	}
	if has(cfHistory) {
		if d := formatData(cfHistory); len(d) >= 4 && binary.LittleEndian.Uint32(d) == 0 {
			out.Flags.Concealed = true
		}
	}
	if has(cfMarker) {
		m := strings.TrimRight(string(formatData(cfMarker)), "\x00")
		out.PopMindMarker = &m
	}
	if owner, _, _ := procGetClipboardOwner.Call(); owner != 0 {
		if pid := windowPID(owner); pid > 0 {
			out.SourceBundleID = strings.ToLower(processPath(pid))
		}
	}
	var item PasteboardItem
	add := func(t string, data []byte) {
		if len(data) == 0 || !allowed(t) {
			return
		}
		limit := opts.MaxBytes
		if t == utiPNG && opts.MaxImageBytes > 0 {
			limit = opts.MaxImageBytes
		}
		out.TotalBytes += float64(len(data))
		if limit > 0 && float64(len(data)) > limit {
			out.TooLarge = true
			return
		}
		item.Representations = append(item.Representations, PasteboardRepresentation{Type: t, Data: data})
	}
	if has(cfUnicodeText) {
		add(utiText8, []byte(utf16Text(formatData(cfUnicodeText))))
	}
	if has(cfHTML) {
		add(utiHTML, cfHTMLFragment(formatData(cfHTML)))
	}
	if has(cfRTF) {
		add(utiRTF, bytes.TrimRight(formatData(cfRTF), "\x00"))
	}
	switch {
	case has(cfPNG):
		add(utiPNG, formatData(cfPNG))
	case has(cfDIBV5) || has(cfDIB):
		f := uintptr(cfDIB)
		if !has(cfDIB) {
			f = cfDIBV5
		}
		if allowed(utiPNG) {
			if c, err := ConvertImageToPNG(formatData(f)); err == nil {
				add(utiPNG, c.PNG)
			}
		}
	}
	if has(cfHDROP) {
		var urls []string
		for _, p := range hdropPaths(formatData(cfHDROP)) {
			urls = append(urls, fileURL(p))
		}
		add(utiFileURL, []byte(strings.Join(urls, "\n")))
	}
	if len(item.Representations) > 0 {
		out.Items = []PasteboardItem{item}
	}
	return out, nil
}

// setFormat puts data on the open clipboard as format.
func setFormat(format uintptr, data []byte) bool {
	h, _, _ := procGlobalAlloc.Call(gmemMoveable, uintptr(len(data)))
	if h == 0 {
		return false
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		procGlobalFree.Call(h)
		return false
	}
	copy(unsafe.Slice((*byte)(sysPtr(p)), len(data)), data)
	procGlobalUnlock.Call(h)
	if r, _, _ := procSetClipboardData.Call(format, h); r == 0 {
		procGlobalFree.Call(h)
		return false
	}
	return true
}

func utf16Bytes(s string) []byte {
	u := utf16.Encode([]rune(s))
	u = append(u, 0)
	return bytes.Clone(unsafe.Slice((*byte)(unsafe.Pointer(&u[0])), len(u)*2))
}

// WritePasteboard puts items on the clipboard, in every Windows format they have, marked with marker.
func WritePasteboard(items []PasteboardItem, marker string) bool {
	registerFormats()
	if err := openClipboard(); err != nil {
		return false
	}
	defer closeClipboard()
	procEmptyClipboard.Call()
	var texts, files []string
	ok := false
	for _, item := range items {
		for _, r := range item.Representations {
			switch r.Type {
			case utiText8, "public.utf16-plain-text", "public.plain-text":
				texts = append(texts, string(r.Data))
			case utiHTML:
				ok = setFormat(cfHTML, makeCFHTML(r.Data)) || ok
			case utiRTF:
				ok = setFormat(cfRTF, append(bytes.Clone(r.Data), 0)) || ok
			case utiPNG:
				ok = setFormat(cfPNG, r.Data) || ok
				if img, err := png.Decode(bytes.NewReader(r.Data)); err == nil {
					ok = setFormat(cfDIB, imageToDIB(img)) || ok
				}
			case utiFileURL:
				for _, line := range strings.Split(string(r.Data), "\n") {
					if p := filePath(line); p != "" {
						files = append(files, p)
					}
				}
			}
		}
	}
	if len(texts) > 0 {
		ok = setFormat(cfUnicodeText, utf16Bytes(strings.Join(texts, "\n"))) || ok
	}
	if len(files) > 0 {
		ok = setFormat(cfHDROP, makeHDROP(files)) || ok
	}
	if marker != "" {
		setFormat(cfMarker, append([]byte(marker), 0))
	}
	return ok
}

// clipboardText reads CF_UNICODETEXT.
func clipboardText() string {
	if err := openClipboard(); err != nil {
		return ""
	}
	defer closeClipboard()
	return utf16Text(formatData(cfUnicodeText))
}

// savedClipboard is what was on the clipboard before popMind copied a selection, to put back.
type savedClipboard map[uintptr][]byte

func saveClipboard() savedClipboard {
	registerFormats()
	saved := savedClipboard{}
	if openClipboard() != nil {
		return saved
	}
	defer closeClipboard()
	for _, f := range []uintptr{cfUnicodeText, cfHTML, cfRTF, cfPNG, cfDIB, cfHDROP} {
		if r, _, _ := procIsClipboardFormatAvailable.Call(f); r != 0 {
			if d := formatData(f); len(d) > 0 {
				saved[f] = d
			}
		}
	}
	return saved
}

func (s savedClipboard) restore() {
	if openClipboard() != nil {
		return
	}
	defer closeClipboard()
	procEmptyClipboard.Call()
	for f, d := range s {
		setFormat(f, d)
	}
}

var (
	fallbackMu     sync.Mutex
	fallbackActive bool
)

// IsClipboardFallbackActive reports a copy of the selection in progress (the history ignores it).
func IsClipboardFallbackActive() bool {
	fallbackMu.Lock()
	defer fallbackMu.Unlock()
	return fallbackActive
}

// sendKeys presses vk with Ctrl, as the user would.
func sendCtrl(vk uint16) bool {
	inputs := []keyInput{
		{Type: inputKeyboard, Vk: vkControl},
		{Type: inputKeyboard, Vk: vk},
		{Type: inputKeyboard, Vk: vk, Flags: keyUp},
		{Type: inputKeyboard, Vk: vkControl, Flags: keyUp},
	}
	n, _, _ := procSendInput.Call(uintptr(len(inputs)), uintptr(unsafe.Pointer(&inputs[0])), unsafe.Sizeof(inputs[0]))
	return int(n) == len(inputs)
}

const vkC = 0x43

// GetTextByClipboard copies the selection of the foreground app with Ctrl+C, reads it, and puts the
// clipboard back as it was. Empty when nothing was copied within 400 ms.
func GetTextByClipboard(useMenu bool, pid int) string {
	fallbackMu.Lock()
	fallbackActive = true
	fallbackMu.Unlock()
	defer func() {
		// The history looks for a change a quarter second later: keep the flag past it.
		time.AfterFunc(600*time.Millisecond, func() {
			fallbackMu.Lock()
			fallbackActive = false
			fallbackMu.Unlock()
		})
	}()
	saved := saveClipboard()
	before := ClipboardChangeCount()
	if !sendCtrl(vkC) {
		return ""
	}
	deadline := time.Now().Add(400 * time.Millisecond)
	for time.Now().Before(deadline) && ClipboardChangeCount() == before {
		time.Sleep(15 * time.Millisecond)
	}
	if ClipboardChangeCount() == before {
		return ""
	}
	text := clipboardText()
	saved.restore()
	return text
}

// CopySelection copies the selection with Ctrl+C and reports whether the clipboard took it.
func CopySelection(useMenu bool, pid int, expected string) bool {
	before := ClipboardChangeCount()
	if !sendCtrl(vkC) {
		return false
	}
	deadline := time.Now().Add(400 * time.Millisecond)
	for time.Now().Before(deadline) {
		if ClipboardChangeCount() != before {
			return expected == "" || strings.TrimSpace(clipboardText()) == strings.TrimSpace(expected)
		}
		time.Sleep(15 * time.Millisecond)
	}
	return false
}
