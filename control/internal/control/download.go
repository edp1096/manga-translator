package control

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/kr/binarydist"
)

type transferProgress func(int64)
type Downloader struct {
	Client      *http.Client
	AllowHTTP   bool
	IdleTimeout time.Duration
}

func NewDownloader() *Downloader {
	return &Downloader{Client: &http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, DialContext: (&net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}).DialContext, ForceAttemptHTTP2: true, MaxIdleConns: 4, IdleConnTimeout: 30 * time.Second, TLSHandshakeTimeout: 20 * time.Second, ResponseHeaderTimeout: 45 * time.Second}, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if len(via) > 8 {
			return fmt.Errorf("too many redirects")
		}
		if r.URL.Scheme != "https" {
			return fmt.Errorf("insecure download redirect")
		}
		return nil
	}}}
}
func (d *Downloader) Fetch(ctx context.Context, a Artifact, cache string, progress transferProgress) (string, error) {
	u, e := url.Parse(a.URL)
	if e != nil || u.Scheme != "https" && !(d.AllowHTTP && u.Scheme == "http") {
		return "", fmt.Errorf("download requires HTTPS")
	}
	if !identifier.MatchString(a.ID) {
		return "", fmt.Errorf("invalid artifact id")
	}
	if e = os.MkdirAll(cache, 0700); e != nil {
		return "", e
	}
	final := filepath.Join(cache, a.ID+"-"+a.SHA256[:12]+".download")
	part := final + ".partial"
	if st, e := os.Stat(final); e == nil && st.Size() == a.Size {
		if h, e := hashFile(final); e == nil && h == a.SHA256 {
			progress(a.Size)
			return final, nil
		}
	}
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		if e = ctx.Err(); e != nil {
			return "", e
		}
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(time.Duration(attempt) * time.Second):
			}
		}
		last = d.fetchAttempt(ctx, a, part, progress)
		if last != nil {
			continue
		}
		sum, err := hashFile(part)
		if err != nil {
			last = err
			continue
		}
		if sum != a.SHA256 {
			os.Remove(part)
			last = fmt.Errorf("%s: SHA-256 확인 실패. 파일을 다시 받습니다", a.Name)
			continue
		}
		if e = os.Rename(part, final); e != nil {
			return "", e
		}
		return final, nil
	}
	return "", last
}
func (d *Downloader) fetchAttempt(ctx context.Context, a Artifact, part string, progress transferProgress) (resultErr error) {
	requestCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var timedOut atomic.Bool
	defer func() {
		if resultErr != nil && timedOut.Load() && ctx.Err() == nil {
			resultErr = fmt.Errorf("%s: 다운로드 응답이 멈췄습니다. 다시 시도하면 이어받습니다", a.Name)
		}
	}()
	var lastByte atomic.Int64
	lastByte.Store(time.Now().UnixNano())
	idle := d.IdleTimeout
	if idle <= 0 {
		idle = 90 * time.Second
	}
	go func() {
		timer := time.NewTicker(min(idle/2, 5*time.Second))
		defer timer.Stop()
		for {
			select {
			case <-requestCtx.Done():
				return
			case <-timer.C:
				if time.Since(time.Unix(0, lastByte.Load())) > idle {
					timedOut.Store(true)
					cancel()
					return
				}
			}
		}
	}()

	var offset int64
	if st, e := os.Stat(part); e == nil {
		offset = st.Size()
		if offset > a.Size {
			if e = os.Remove(part); e != nil {
				return e
			}
			offset = 0
		}
	}
	if offset == a.Size {
		return nil
	}
	req, e := http.NewRequestWithContext(requestCtx, http.MethodGet, a.URL, nil)
	if e != nil {
		return e
	}
	req.Header.Set("User-Agent", "MangaTranslator/"+Version)
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	response, e := d.Client.Do(req)
	if e != nil {
		return e
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusOK {
		offset = 0
	} else if response.StatusCode == http.StatusPartialContent {
		var start, end, total int64
		n, err := fmt.Sscanf(response.Header.Get("Content-Range"), "bytes %d-%d/%d", &start, &end, &total)
		if err != nil || n != 3 || start != offset || total != a.Size || end != a.Size-1 {
			return fmt.Errorf("invalid resumed download range")
		}
	} else {
		return fmt.Errorf("%s 다운로드: HTTP %d", a.Name, response.StatusCode)
	}
	if response.ContentLength >= 0 && response.ContentLength != a.Size-offset {
		return fmt.Errorf("download size differs from catalog")
	}
	flags := os.O_CREATE | os.O_WRONLY
	if offset == 0 {
		flags |= os.O_TRUNC
	} else {
		flags |= os.O_APPEND
	}
	f, e := os.OpenFile(part, flags, 0600)
	if e != nil {
		return e
	}
	defer f.Close()
	progress(offset)
	writer := &progressWriter{Writer: f, Done: offset, Notify: progress, Last: time.Now()}
	n, e := io.CopyBuffer(writer, io.LimitReader(activityReader{response.Body, &lastByte}, a.Size-offset+1), make([]byte, 256*1024))
	if e != nil {
		return e
	}
	if n != a.Size-offset {
		return fmt.Errorf("incomplete download: %d / %d bytes", n+offset, a.Size)
	}
	if e = f.Sync(); e != nil {
		return e
	}
	progress(a.Size)
	return nil
}

type progressWriter struct {
	io.Writer
	Done   int64
	Notify transferProgress
	Last   time.Time
}

func (w *progressWriter) Write(p []byte) (int, error) {
	n, e := w.Writer.Write(p)
	w.Done += int64(n)
	if time.Since(w.Last) > 150*time.Millisecond {
		w.Notify(w.Done)
		w.Last = time.Now()
	}
	return n, e
}

type contextReader struct {
	Context context.Context
	Reader  io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if e := r.Context.Err(); e != nil {
		return 0, e
	}
	return r.Reader.Read(p)
}
func installOutput(ctx context.Context, root string, f OutputFile, write func(io.Writer) error) error {
	dest, e := safeDestination(root, f.Path)
	if e != nil {
		return e
	}
	if e = os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
		return e
	}
	temp, e := os.CreateTemp(filepath.Dir(dest), ".manga-install-*")
	if e != nil {
		return e
	}
	defer os.Remove(temp.Name())
	defer temp.Close()
	hash := sha256.New()
	limit := &limitedWriter{W: io.MultiWriter(temp, hash), Remaining: f.Size}
	if e = write(limit); e != nil {
		return e
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	if limit.Remaining != 0 || hex.EncodeToString(hash.Sum(nil)) != f.SHA256 {
		return fmt.Errorf("installed file checksum mismatch: %s", f.Path)
	}
	mode := fs.FileMode(0600)
	if f.Executable {
		mode = 0755
	}
	if e = temp.Chmod(mode); e != nil {
		return e
	}
	if e = temp.Sync(); e != nil {
		return e
	}
	if e = temp.Close(); e != nil {
		return e
	}
	return os.Rename(temp.Name(), dest)
}

type limitedWriter struct {
	W         io.Writer
	Remaining int64
}

func (w *limitedWriter) Write(p []byte) (int, error) {
	if int64(len(p)) > w.Remaining {
		return 0, fmt.Errorf("output exceeds catalog size")
	}
	n, e := w.W.Write(p)
	w.Remaining -= int64(n)
	return n, e
}
func installArtifact(ctx context.Context, root string, a Artifact, source string, bundle fs.FS) error {
	if a.Format == "msvc-cab" {
		return installMSVCCabinet(ctx, root, a, source)
	}
	if a.Format == "raw" {
		if len(a.Files) != 1 {
			return fmt.Errorf("raw artifact requires one output")
		}
		dest, e := safeDestination(root, a.Files[0].Path)
		if e != nil {
			return e
		}
		if e = os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
			return e
		}
		mode := fs.FileMode(0600)
		if a.Files[0].Executable {
			mode = 0755
		}
		if e = os.Chmod(source, mode); e != nil {
			return e
		}
		return os.Rename(source, dest)
	}
	if a.Format == "gzip" || a.Format == "patch" {
		if len(a.Files) != 1 {
			return fmt.Errorf("converted artifact requires one output")
		}
		input, e := os.Open(source)
		if e != nil {
			return e
		}
		defer input.Close()
		if a.Format == "gzip" {
			reader, e := gzip.NewReader(input)
			if e != nil {
				return e
			}
			defer reader.Close()
			return installOutput(ctx, root, a.Files[0], func(w io.Writer) error { _, e := io.Copy(w, contextReader{ctx, reader}); return e })
		}
		data, e := fs.ReadFile(bundle, a.Patch)
		if e != nil {
			return e
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != a.PatchSHA256 {
			return fmt.Errorf("model conversion patch checksum mismatch")
		}
		return installOutput(ctx, root, a.Files[0], func(w io.Writer) error { return binarydist.Patch(contextReader{ctx, input}, w, bytes.NewReader(data)) })
	}
	wanted := map[string][]OutputFile{}
	for _, f := range a.Files {
		if _, e := safeRelative(f.Entry); e != nil {
			return e
		}
		wanted[f.Entry] = append(wanted[f.Entry], f)
	}
	seen := map[string]bool{}
	extract := func(entry string, size int64, reader io.Reader) error {
		targets := wanted[entry]
		if len(targets) == 0 {
			return nil
		}
		if seen[entry] {
			return fmt.Errorf("duplicate archive entry")
		}
		seen[entry] = true
		if len(targets) != 1 {
			return fmt.Errorf("duplicate catalog source entry")
		}
		f := targets[0]
		if size != f.Size {
			return fmt.Errorf("archive file size mismatch: %s", entry)
		}
		return installOutput(ctx, root, f, func(w io.Writer) error {
			_, e := io.Copy(w, contextReader{ctx, io.LimitReader(reader, f.Size+1)})
			return e
		})
	}
	if a.Format == "zip" {
		z, e := zip.OpenReader(source)
		if e != nil {
			return e
		}
		defer z.Close()
		for _, entry := range z.File {
			if entry.FileInfo().IsDir() {
				continue
			}
			archiveName := strings.ReplaceAll(entry.Name, "\\", "/")
			if _, e = safeRelative(archiveName); e != nil {
				return e
			}
			if len(wanted[archiveName]) == 0 {
				continue
			}
			if entry.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("archive symlinks are not extracted")
			}
			r, e := entry.Open()
			if e != nil {
				return e
			}
			e = extract(archiveName, int64(entry.UncompressedSize64), r)
			r.Close()
			if e != nil {
				return e
			}
		}
	} else if a.Format == "tgz" {
		f, e := os.Open(source)
		if e != nil {
			return e
		}
		defer f.Close()
		gz, e := gzip.NewReader(f)
		if e != nil {
			return e
		}
		defer gz.Close()
		tr := tar.NewReader(gz)
		for {
			entry, e := tr.Next()
			if e == io.EOF {
				break
			}
			if e != nil {
				return e
			}
			if entry.Typeflag == tar.TypeDir {
				continue
			}
			archiveName := strings.ReplaceAll(entry.Name, "\\", "/")
			if _, e = safeRelative(archiveName); e != nil {
				return e
			}
			if len(wanted[archiveName]) == 0 {
				continue
			}
			if entry.Typeflag != tar.TypeReg && entry.Typeflag != tar.TypeRegA {
				return fmt.Errorf("catalog source must be a regular file")
			}
			if e = extract(entry.Name, entry.Size, tr); e != nil {
				return e
			}
		}
	} else {
		return fmt.Errorf("unsupported archive format %s", a.Format)
	}
	for entry := range wanted {
		if !seen[entry] {
			return fmt.Errorf("archive missing file: %s", entry)
		}
	}
	return nil
}
func formatBytes(n int64) string {
	if n >= 1<<30 {
		return strconv.FormatFloat(float64(n)/(1<<30), 'f', 1, 64) + " GiB"
	}
	return strconv.FormatInt(n/(1<<20), 10) + " MiB"
}
func isEmbedded(a Artifact) bool { return strings.HasPrefix(a.URL, "embedded:") }

type activityReader struct {
	Reader io.Reader
	Last   *atomic.Int64
}

func (r activityReader) Read(p []byte) (int, error) {
	n, e := r.Reader.Read(p)
	if n > 0 {
		r.Last.Store(time.Now().UnixNano())
	}
	return n, e
}
