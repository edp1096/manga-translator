package control

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"
)

const fixtureExtension = "namkdikenjddkgkhfdpbbepgbelliidp"

func fixtureBundle(a Artifact) fstest.MapFS {
	a.Platform = "all"
	a.Group = "ocr"
	raw, _ := json.Marshal(Catalog{Version: Version, Artifacts: []Artifact{a}})
	return fstest.MapFS{"catalog.json": {Data: raw}, "extension/manifest.json": {Data: []byte(`{"name":"test"}`)}, "extension-id.txt": {Data: []byte(fixtureExtension)}, "web/index.html": {Data: []byte("<html>local control</html>")}}
}
func fixtureManager(t *testing.T, root string, a Artifact) *Manager {
	t.Helper()
	m, e := NewManager(root, fixtureBundle(a), log.New(io.Discard, "", 0))
	if e != nil {
		t.Fatal(e)
	}
	m.platform = "linux-arm64"
	m.prerequisites = func(context.Context, string, []OutputFile) error { return nil }
	m.downloader = &Downloader{Client: http.DefaultClient, AllowHTTP: true}
	if e = m.UpdateSettings(Settings{Threads: 1, AutoStart: false}); e != nil {
		t.Fatal(e)
	}
	return m
}
func waitSetup(t *testing.T, m *Manager) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		state := m.Snapshot()
		if !state.Busy {
			if state.Phase != "ready" {
				t.Fatalf("setup phase %s: %s", state.Phase, state.Error)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("setup did not finish")
}
func TestFreshSetupAndRestartReuse(t *testing.T) {
	data := []byte("pinned model bytes")
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.Write(data) }))
	defer srv.Close()
	a := testArtifact(data, srv.URL)
	root := t.TempDir()
	m := fixtureManager(t, root, a)
	if e := m.BeginSetup(); e != nil {
		t.Fatal(e)
	}
	waitSetup(t, m)
	if !m.Snapshot().Ready {
		t.Fatal("fresh install not ready")
	}
	if calls.Load() != 1 {
		t.Fatalf("requests %d", calls.Load())
	}
	token, _ := os.ReadFile(filepath.Join(root, "data", "native_api", "access-token"))
	m.Close()
	m = fixtureManager(t, root, a)
	defer m.Close()
	if e := m.BeginSetup(); e != nil {
		t.Fatal(e)
	}
	waitSetup(t, m)
	if calls.Load() != 1 {
		t.Fatal("redownloaded valid installed model")
	}
	current, _ := os.ReadFile(filepath.Join(root, "data", "native_api", "access-token"))
	if !bytes.Equal(token, current) {
		t.Fatal("existing extension access key changed")
	}
	// A modified file must lose ready status and be repaired, never merely trusted by its size.
	time.Sleep(10 * time.Millisecond)
	os.WriteFile(filepath.Join(root, "models", "model.bin"), bytes.Repeat([]byte("x"), len(data)), 0600)
	if m.Snapshot().Ready {
		t.Fatal("modified model trusted")
	}
	if e := m.BeginSetup(); e != nil {
		t.Fatal(e)
	}
	waitSetup(t, m)
	if calls.Load() != 2 {
		t.Fatal("modified model was not repaired")
	}
}
func TestExistingFilesAreHashedAndAdopted(t *testing.T) {
	data := []byte("existing model")
	a := testArtifact(data, "http://127.0.0.1:1/should-not-download")
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "models"), 0700)
	os.WriteFile(filepath.Join(root, "models", "model.bin"), data, 0600)
	m := fixtureManager(t, root, a)
	defer m.Close()
	if m.Snapshot().Ready {
		t.Fatal("unverified files marked ready")
	}
	if e := m.BeginSetup(); e != nil {
		t.Fatal(e)
	}
	waitSetup(t, m)
	if !m.Snapshot().Ready {
		t.Fatal("existing files were not adopted")
	}
}
func TestStopDuringSetupDoesNotRestart(t *testing.T) {
	started := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(started); <-r.Context().Done() }))
	defer srv.Close()
	a := testArtifact([]byte("fixture"), srv.URL)
	m := fixtureManager(t, t.TempDir(), a)
	defer m.Close()
	if e := m.BeginSetup(); e != nil {
		t.Fatal(e)
	}
	<-started
	if e := m.Stop(); e != nil {
		t.Fatal(e)
	}
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		state := m.Snapshot()
		if !state.Busy {
			if state.Phase != "ready" {
				t.Fatalf("stale setup overwrote stop state: %s", state.Phase)
			}
			if len(m.processes) != 0 {
				t.Fatal("unexpected process")
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("stop stuck")
}
func requestTo(t *testing.T, h http.Handler, method, path, origin string, body string, control bool) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://127.0.0.1:8794"+path, strings.NewReader(body))
	r.Host = "127.0.0.1:8794"
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	r.Header.Set("Content-Type", "application/json")
	if control {
		r.Header.Set("X-Manga-Control", "1")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestControlAPIRejectsCrossOriginAndRebinding(t *testing.T) {
	m := fixtureManager(t, t.TempDir(), testArtifact([]byte("model"), "https://example.invalid"))
	defer m.Close()
	handler := m.Handler()
	for _, origin := range []string{"https://evil.example", "http://127.0.0.1:9000", ""} {
		w := requestTo(t, handler, "POST", "/api/stop", origin, "{}", true)
		if w.Code != 403 {
			t.Fatalf("origin %q accepted: %d", origin, w.Code)
		}
	}
	r := httptest.NewRequest("GET", "http://attacker.example:8794/api/state", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("DNS rebinding host accepted")
	}
	w = requestTo(t, handler, "GET", "/api/state", "", "", false)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	token, _ := os.ReadFile(filepath.Join(m.root, "data", "native_api", "access-token"))
	if strings.Contains(w.Body.String(), strings.TrimSpace(string(token))) {
		t.Fatal("state leaks token")
	}
}
func TestPairingIsOneUseAndRestrictedToExtension(t *testing.T) {
	m := fixtureManager(t, t.TempDir(), testArtifact([]byte("model"), "https://example.invalid"))
	defer m.Close()
	code, e := m.PairCode()
	if e != nil {
		t.Fatal(e)
	}
	body := fmtJSON(map[string]string{"code": code})
	h := m.Handler()
	w := requestTo(t, h, "POST", "/api/extension/pair", "chrome-extension://wrong", body, false)
	if w.Code != 403 {
		t.Fatal("wrong extension accepted")
	}
	w = requestTo(t, h, "POST", "/api/extension/pair", "chrome-extension://"+fixtureExtension, body, false)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "token") {
		t.Fatalf("valid pair failed: %d %s", w.Code, w.Body.String())
	}
	w = requestTo(t, h, "POST", "/api/extension/pair", "chrome-extension://"+fixtureExtension, body, false)
	if w.Code != 400 {
		t.Fatal("pair code reused")
	}
}
func TestSettingsCannotBeChangedWhilePreparing(t *testing.T) {
	m := fixtureManager(t, t.TempDir(), testArtifact([]byte("model"), "https://example.invalid"))
	defer m.Close()
	m.mu.Lock()
	m.busy = true
	m.mu.Unlock()
	if e := m.UpdateSettings(Settings{Threads: 1, AutoStart: true}); e == nil {
		t.Fatal("changed settings during operation")
	}
}
func fmtJSON(v any) string { data, _ := json.Marshal(v); return string(data) }
