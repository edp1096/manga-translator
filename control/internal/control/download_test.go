package control

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"
)

func testArtifact(data []byte, url string) Artifact {
	h := sha256.Sum256(data)
	sum := hex.EncodeToString(h[:])
	return Artifact{ID: "fixture", Name: "test model", URL: url, SHA256: sum, Size: int64(len(data)), Format: "raw", Files: []OutputFile{{Path: "models/model.bin", SHA256: sum, Size: int64(len(data))}}}
}
func TestDownloadResumesPartial(t *testing.T) {
	data := []byte("a model downloaded in two pieces")
	var requested string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requested = r.Header.Get("Range")
		if requested != "bytes=7-" {
			t.Errorf("range %q", requested)
		}
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 7-%d/%d", len(data)-1, len(data)))
		w.WriteHeader(206)
		w.Write(data[7:])
	}))
	defer srv.Close()
	a := testArtifact(data, srv.URL)
	dir := t.TempDir()
	partial := filepath.Join(dir, a.ID+"-"+a.SHA256[:12]+".download.partial")
	os.WriteFile(partial, data[:7], 0600)
	d := &Downloader{Client: srv.Client(), AllowHTTP: true}
	last := int64(0)
	p, e := d.Fetch(context.Background(), a, dir, func(n int64) { last = n })
	if e != nil {
		t.Fatal(e)
	}
	got, _ := os.ReadFile(p)
	if !bytes.Equal(got, data) || last != int64(len(data)) {
		t.Fatalf("incomplete resumed file")
	}
}
func TestIgnoredRangeRestartsWithoutAppending(t *testing.T) {
	data := []byte("replacement bytes")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(data) }))
	defer srv.Close()
	a := testArtifact(data, srv.URL)
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, a.ID+"-"+a.SHA256[:12]+".download.partial"), data[:5], 0600)
	d := &Downloader{Client: srv.Client(), AllowHTTP: true}
	p, e := d.Fetch(context.Background(), a, dir, func(int64) {})
	if e != nil {
		t.Fatal(e)
	}
	got, _ := os.ReadFile(p)
	if !bytes.Equal(got, data) {
		t.Fatalf("range-ignored response appended")
	}
}
func TestBadChecksumNeverCommits(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.Write([]byte("BAD!")) }))
	defer srv.Close()
	a := testArtifact([]byte("good"), srv.URL)
	dir := t.TempDir()
	d := &Downloader{Client: srv.Client(), AllowHTTP: true}
	_, e := d.Fetch(context.Background(), a, dir, func(int64) {})
	if e == nil {
		t.Fatal("accepted corrupt download")
	}
	if calls.Load() != 3 {
		t.Fatalf("retries %d", calls.Load())
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.download"))
	if len(files) != 0 {
		t.Fatal("corrupt file committed")
	}
}
func TestWrongContentRangeIsRejected(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Range", "bytes 0-3/4")
		w.WriteHeader(206)
		w.Write([]byte("good"))
	}))
	defer srv.Close()
	a := testArtifact([]byte("good"), srv.URL)
	dir := t.TempDir()
	part := filepath.Join(dir, "partial")
	os.WriteFile(part, []byte("go"), 0600)
	d := &Downloader{Client: srv.Client(), AllowHTTP: true}
	if e := d.fetchAttempt(context.Background(), a, part, func(int64) {}); e == nil {
		t.Fatal("wrong range accepted")
	}
}
func TestCancellationPreservesPartial(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	a := testArtifact([]byte("test"), "https://example.invalid/model")
	dir := t.TempDir()
	part := filepath.Join(dir, a.ID+"-"+a.SHA256[:12]+".download.partial")
	os.WriteFile(part, []byte("te"), 0600)
	_, e := NewDownloader().Fetch(ctx, a, dir, func(int64) {})
	if e != context.Canceled {
		t.Fatalf("got %v", e)
	}
	data, _ := os.ReadFile(part)
	if string(data) != "te" {
		t.Fatal("partial lost")
	}
}
func TestArchiveTraversalRejected(t *testing.T) {
	var buffer bytes.Buffer
	z := zip.NewWriter(&buffer)
	f, _ := z.Create("../escaped")
	f.Write([]byte("bad"))
	f, _ = z.Create("good")
	f.Write([]byte("ok"))
	z.Close()
	root := t.TempDir()
	source := filepath.Join(t.TempDir(), "bad.zip")
	os.WriteFile(source, buffer.Bytes(), 0600)
	a := testArtifact([]byte("ok"), "https://example.invalid")
	a.Format = "zip"
	a.Files[0].Entry = "good"
	if e := installArtifact(context.Background(), root, a, source, fstest.MapFS{}); e == nil {
		t.Fatal("unsafe archive accepted")
	}
	if _, e := os.Stat(filepath.Join(filepath.Dir(root), "escaped")); !os.IsNotExist(e) {
		t.Fatal("escaped file exists")
	}
}
func TestArchiveOutputChecksum(t *testing.T) {
	var buffer bytes.Buffer
	z := zip.NewWriter(&buffer)
	f, _ := z.Create("good")
	f.Write([]byte("NO"))
	z.Close()
	root := t.TempDir()
	source := filepath.Join(t.TempDir(), "corrupt.zip")
	os.WriteFile(source, buffer.Bytes(), 0600)
	a := testArtifact([]byte("ok"), "https://example.invalid")
	a.Format = "zip"
	a.Files[0].Entry = "good"
	if e := installArtifact(context.Background(), root, a, source, fstest.MapFS{}); e == nil {
		t.Fatal("bad extracted file accepted")
	}
	if _, e := os.Stat(filepath.Join(root, "models", "model.bin")); !os.IsNotExist(e) {
		t.Fatal("bad output committed")
	}
}
func TestDestinationSymlinkCannotLeaveRoot(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if e := os.Symlink(outside, filepath.Join(root, "models")); e != nil {
		t.Skip(e)
	}
	if _, e := safeDestination(root, "models/model.bin"); e == nil {
		t.Fatal("external symlink accepted")
	}
}
func TestRelativePathValidation(t *testing.T) {
	for _, bad := range []string{"../bad", "/etc/passwd", "C:/system", "a/../../bad", "a\\bad", "./file", "a//b"} {
		if _, e := safeRelative(bad); e == nil {
			t.Errorf("accepted %q", bad)
		}
	}
	if _, e := safeRelative("models/日本語/model.bin"); e != nil {
		t.Fatal(e)
	}
}

func TestStalledBodyTimesOutAndPreservesPartial(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("go"))
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer srv.Close()
	a := testArtifact([]byte("good"), srv.URL)
	part := filepath.Join(t.TempDir(), "partial")
	d := &Downloader{Client: srv.Client(), AllowHTTP: true, IdleTimeout: 40 * time.Millisecond}
	start := time.Now()
	if e := d.fetchAttempt(context.Background(), a, part, func(int64) {}); e == nil {
		t.Fatal("stalled request accepted")
	}
	if time.Since(start) > time.Second {
		t.Fatal("idle watchdog failed")
	}
	data, _ := os.ReadFile(part)
	if string(data) != "go" {
		t.Fatalf("partial %q", data)
	}
}
