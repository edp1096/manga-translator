package control

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpdateVersions(t *testing.T) {
	for _, p := range [][2]string{{"0.4.2", "0.4.1"}, {"v1.0.0", "0.99.99"}, {"0.10.0", "0.9.10"}} {
		if !newerVersion(p[0], p[1]) {
			t.Fatal(p)
		}
	}
	for _, v := range []string{"0.4.1", "0.4.0", "0.4.2-rc1", "01.4.2", "0.4", "999999999999999999.0.0"} {
		if newerVersion(v, "0.4.1") {
			t.Fatal(v)
		}
	}
}
func updateTestZIP(t *testing.T, entries map[string][]byte) string {
	t.Helper()
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	for n, v := range entries {
		f, e := z.Create(n)
		if e != nil {
			t.Fatal(e)
		}
		f.Write(v)
	}
	z.Close()
	p := filepath.Join(t.TempDir(), "update.zip")
	os.WriteFile(p, b.Bytes(), 0600)
	return p
}
func TestUpdateZIPRestrictions(t *testing.T) {
	base := func() map[string][]byte {
		return map[string][]byte{"manga-control": []byte("exe"), "README.txt": []byte("readme"), "DOWNLOADS.json": []byte(`{"version":"0.4.2"}`)}
	}
	for _, name := range []string{"../outside", "/outside", "data/api-key", "models/weights", "config/control.json", "licenses/../../outside", "licenses/a\\b", "README.TXT"} {
		t.Run(name, func(t *testing.T) {
			e := base()
			e[name] = []byte("bad")
			if extractUpdate(updateTestZIP(t, e), t.TempDir(), "manga-control", "0.4.2") == nil {
				t.Fatal("unsafe ZIP accepted")
			}
		})
	}
	if e := extractUpdate(updateTestZIP(t, base()), t.TempDir(), "manga-control", "0.4.2"); e != nil {
		t.Fatal(e)
	}
	if e := extractUpdate(updateTestZIP(t, base()), t.TempDir(), "manga-control", "0.4.3"); e == nil {
		t.Fatal("wrong catalog version")
	}
	e := base()
	delete(e, "manga-control")
	if extractUpdate(updateTestZIP(t, e), t.TempDir(), "manga-control", "0.4.2") == nil {
		t.Fatal("missing executable")
	}
}
func TestUpdateReleaseAndDownloadValidation(t *testing.T) {
	oldAPI, oldBase := updateAPIURL, updateReleaseBase
	defer func() { updateAPIURL, updateReleaseBase = oldAPI, oldBase }()
	body := []byte("verified archive")
	release := updateRelease{Tag: "v0.4.2", URL: "javascript:bad"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/latest" {
			json.NewEncoder(w).Encode(release)
			return
		}
		w.Write(body)
	}))
	defer server.Close()
	updateAPIURL = server.URL + "/latest"
	updateReleaseBase = server.URL + "/download/"
	r, e := fetchRelease(context.Background(), server.Client())
	if e != nil || r.URL != "" {
		t.Fatal(r, e)
	}
	release.Prerelease = true
	if _, e = fetchRelease(context.Background(), server.Client()); e == nil {
		t.Fatal("prerelease accepted")
	}
	release.Prerelease = false
	a := updateAsset{Name: "file.zip", URL: updateReleaseBase + "v0.4.2/file.zip", Size: int64(len(body))}
	release.Assets = []updateAsset{a}
	if _, e = release.asset(a.Name); e != nil {
		t.Fatal(e)
	}
	release.Assets[0].URL = "https://evil.example/file.zip"
	if _, e = release.asset(a.Name); e == nil {
		t.Fatal("foreign origin accepted")
	}
	if e = downloadUpdate(context.Background(), server.Client(), a, filepath.Join(t.TempDir(), "download"), 1024); e != nil {
		t.Fatal(e)
	}
	a.Size--
	if e = downloadUpdate(context.Background(), server.Client(), a, filepath.Join(t.TempDir(), "download"), 1024); e == nil {
		t.Fatal("truncated/extra bytes accepted")
	}
	h := sha256.Sum256(body)
	sum := hex.EncodeToString(h[:])
	if got, e := checksumFor([]byte(sum+"  file.zip\n"), "file.zip"); e != nil || got != sum {
		t.Fatal(got, e)
	}
	if _, e = checksumFor([]byte(sum+"  file.zip\n"+sum+"  file.zip"), "file.zip"); e == nil {
		t.Fatal("duplicate checksum accepted")
	}
}
func TestUpdateRollbackPreservesData(t *testing.T) {
	root := t.TempDir()
	exe := updateExecutable(currentPlatform())
	put := func(name, value string) {
		p := filepath.Join(root, name)
		os.MkdirAll(filepath.Dir(p), 0700)
		if e := os.WriteFile(p, []byte(value), 0700); e != nil {
			t.Fatal(e)
		}
	}
	for _, p := range []string{exe, "README.txt", "DOWNLOADS.json", "licenses/old.txt", "extension/manifest.json", "models/model.bin", "runtime/library", "config/control.json", "data/api-key", "data/native_api/jobs/result.json"} {
		put(p, "original:"+p)
	}
	j := updateJournal{Version: "0.4.2", Previous: "0.4.1", Executable: exe, Token: strings.Repeat("a", 64), Phase: "prepared", Archive: "archive/update-test"}
	if e := backupUpdate(root, &j); e != nil {
		t.Fatal(e)
	}
	for _, p := range []string{exe, "README.txt", "DOWNLOADS.json", "licenses/new.txt"} {
		put(".app-update/stage/"+p, "updated:"+p)
	}
	if e := installUpdateFiles(root, j); e != nil {
		t.Fatal(e)
	}
	put("extension/manifest.json", "new extension")
	put("extension/new.js", "new file")
	if e := restoreUpdateFiles(root, j); e != nil {
		t.Fatal(e)
	}
	if e := restoreUpdateFiles(root, j); e != nil {
		t.Fatal("non-idempotent rollback", e)
	}
	for _, p := range []string{exe, "README.txt", "DOWNLOADS.json", "licenses/old.txt", "extension/manifest.json", "models/model.bin", "runtime/library", "config/control.json", "data/api-key", "data/native_api/jobs/result.json"} {
		b, e := os.ReadFile(filepath.Join(root, p))
		if e != nil || string(b) != "original:"+p {
			t.Fatal("not preserved", p, e)
		}
	}
	if !absent(filepath.Join(root, "extension/new.js")) || !absent(filepath.Join(root, "licenses/new.txt")) {
		t.Fatal("new files survive rollback")
	}
}
func TestUpdateBlocksConcurrentMutations(t *testing.T) {
	m := &Manager{updatePending: true}
	r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8794/api/start", nil)
	r.Header.Set("Origin", "http://127.0.0.1:8794")
	r.Header.Set("X-Manga-Control", "1")
	w := httptest.NewRecorder()
	m.Handler().ServeHTTP(w, r)
	if w.Code != 409 {
		t.Fatal(w.Code)
	}
}

func TestUpdateAbandonedDownloadCleanup(t *testing.T) {
	root := t.TempDir()
	work := filepath.Join(root, ".app-update")
	os.Mkdir(work, 0700)
	os.WriteFile(filepath.Join(work, "release.zip"), []byte("partial"), 0600)
	if e := cleanFinishedUpdate(root); e != nil {
		t.Fatal(e)
	}
	if !absent(work) {
		t.Fatal("abandoned download blocks retry")
	}
}

func TestUpdateRejectsIncompleteRecoveryJournal(t *testing.T) {
	root := t.TempDir()
	j := updateJournal{Version: "0.4.2", Previous: "0.4.1", Executable: updateExecutable(currentPlatform()), Token: strings.Repeat("a", 64), Phase: "launching", Archive: "archive/update-test"}
	if e := saveUpdateJournal(root, j); e != nil {
		t.Fatal(e)
	}
	if _, e := readUpdateJournal(root); e == nil {
		t.Fatal("incomplete backup journal accepted")
	}
	j.Phase = "unexpected"
	if e := saveUpdateJournal(root, j); e != nil {
		t.Fatal(e)
	}
	if _, e := readUpdateJournal(root); e == nil {
		t.Fatal("unknown transaction stage accepted")
	}
}

func TestFreshRootDoesNotTriggerUpdateRecovery(t *testing.T) {
	root := filepath.Join(t.TempDir(), "new-folder", "application")
	resumed, e := ResumeInterruptedUpdate(root, "")
	if e != nil || resumed {
		t.Fatal("fresh root falsely rejected", resumed, e)
	}
	if !absent(root) {
		t.Fatal("recovery check should not create fresh root")
	}
}
