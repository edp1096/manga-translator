package control

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func importFixture(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for p, v := range map[string]string{"config/control.json": `{"model":"gemma","threads":2}`, "data/api-key": strings.Repeat("a", 64), "data/native_api/access-token": strings.Repeat("b", 64), "data/native_api/jobs/job/result.json": `{"translation":"번역문","manualRestoration":{"asset":"manual-test.png"}}`, "data/native_api/jobs/job/manual-test.png": "png", "models/test.gguf": "model bytes", "runtime/test/bin": "runtime bytes", "data/downloads/partial": "partial bytes", "MangaTranslator.exe": "old executable", "extension/render.js": "old extension", "data/control.log": "old log"} {
		file := filepath.Join(root, filepath.FromSlash(p))
		if e := os.MkdirAll(filepath.Dir(file), 0700); e != nil {
			t.Fatal(e)
		}
		if e := os.WriteFile(file, []byte(v), 0600); e != nil {
			t.Fatal(e)
		}
	}
	return root
}
func readImport(t *testing.T, root, path string) string {
	t.Helper()
	b, e := os.ReadFile(filepath.Join(root, filepath.FromSlash(path)))
	if e != nil {
		t.Fatal(e)
	}
	return string(b)
}
func TestImportCopiesPersistentData(t *testing.T) {
	source, dest := importFixture(t), t.TempDir()
	os.MkdirAll(filepath.Join(dest, "data/native_api"), 0700)
	os.WriteFile(filepath.Join(dest, "data/api-key"), []byte("new key"), 0600)
	os.WriteFile(filepath.Join(dest, "MangaTranslator.exe"), []byte("new executable"), 0600)
	report, e := importData(context.Background(), dest, source, nil)
	if e != nil {
		t.Fatal(e)
	}
	if report.Files != 8 || report.Bytes <= 0 {
		t.Fatalf("report %+v", report)
	}
	for _, p := range []string{"config/control.json", "data/api-key", "data/native_api/access-token", "data/native_api/jobs/job/result.json", "data/native_api/jobs/job/manual-test.png", "models/test.gguf", "runtime/test/bin", "data/downloads/partial"} {
		if readImport(t, source, p) != readImport(t, dest, p) {
			t.Fatal(p)
		}
	}
	if readImport(t, dest, "MangaTranslator.exe") != "new executable" || !absent(filepath.Join(dest, "extension")) || !absent(filepath.Join(dest, "data/control.log")) {
		t.Fatal("application files copied")
	}
	if !absent(filepath.Join(dest, migrationDir)) {
		t.Fatal("staging left behind")
	}
	if _, e = importData(context.Background(), dest, source, nil); e == nil {
		t.Fatal("existing user data overwritten")
	}
}
func TestImportRejectsLiveSourceAndOverlaps(t *testing.T) {
	source := importFixture(t)
	unlock, e := lockRoot(source)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = importData(context.Background(), t.TempDir(), source, nil); e == nil {
		t.Fatal("locked source accepted")
	}
	unlock()
	for _, dest := range []string{source, filepath.Join(source, "child"), filepath.Dir(source)} {
		if _, e = importData(context.Background(), dest, source, nil); e == nil {
			t.Fatal("overlapping root accepted")
		}
	}
	if _, e = importData(context.Background(), t.TempDir(), "relative", nil); e == nil {
		t.Fatal("relative source accepted")
	}
}
func TestImportCancelAndInvalidSource(t *testing.T) {
	source, dest := importFixture(t), t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := importData(ctx, dest, source, nil); e == nil {
		t.Fatal("cancel ignored")
	}
	if !absent(filepath.Join(dest, "models")) || !absent(filepath.Join(dest, migrationDir)) {
		t.Fatal("cancel published files")
	}
	os.WriteFile(filepath.Join(source, "config/control.json"), []byte("invalid"), 0600)
	if _, e := importData(context.Background(), dest, source, nil); e == nil {
		t.Fatal("bad settings accepted")
	}
	if !absent(filepath.Join(dest, "config")) {
		t.Fatal("bad settings published")
	}
}
func TestImportChangedFileRejected(t *testing.T) {
	source, dest := importFixture(t), t.TempDir()
	changed := false
	_, e := importData(context.Background(), dest, source, func(p Progress) {
		if !changed && p.Name == "models/test.gguf" {
			changed = true
			os.WriteFile(filepath.Join(source, "models/test.gguf"), []byte("changed model size"), 0600)
		}
	})
	if e == nil || !changed {
		t.Fatalf("changed source accepted: %v", e)
	}
	if !absent(filepath.Join(dest, "models")) {
		t.Fatal("partial migration published")
	}
}
func TestImportSymlinkRejected(t *testing.T) {
	source, dest := importFixture(t), t.TempDir()
	os.Remove(filepath.Join(source, "models/test.gguf"))
	if e := os.Symlink(filepath.Join(source, "data/api-key"), filepath.Join(source, "models/test.gguf")); e != nil {
		t.Skip(e)
	}
	if _, e := importData(context.Background(), dest, source, nil); e == nil {
		t.Fatal("link imported")
	}
}
func TestMigrationJournalRecovery(t *testing.T) {
	for _, phase := range []string{"intent", "backed-up", "installed", "committed"} {
		t.Run(phase, func(t *testing.T) {
			root := t.TempDir()
			work := filepath.Join(root, migrationDir)
			os.MkdirAll(filepath.Join(root, "config"), 0700)
			os.WriteFile(filepath.Join(root, "config/control.json"), []byte("old"), 0600)
			os.MkdirAll(filepath.Join(work, "backup"), 0700)
			j := migrationJournal{Version: 1, Entries: []migrationEntry{{"config", true}, {"models", false}}, Committed: phase == "committed"}
			if phase != "intent" {
				os.Rename(filepath.Join(root, "config"), filepath.Join(work, "backup/config"))
			}
			if phase == "installed" || phase == "committed" {
				os.MkdirAll(filepath.Join(root, "config"), 0700)
				os.WriteFile(filepath.Join(root, "config/control.json"), []byte("imported"), 0600)
				os.Mkdir(filepath.Join(root, "models"), 0700)
			}
			if e := writeJSON(filepath.Join(work, "journal.json"), j); e != nil {
				t.Fatal(e)
			}
			if e := recoverMigration(root); e != nil {
				t.Fatal(e)
			}
			if e := recoverMigration(root); e != nil {
				t.Fatal(e)
			}
			expected := "old"
			if phase == "committed" {
				expected = "imported"
			}
			if readImport(t, root, "config/control.json") != expected {
				t.Fatal("wrong rollback")
			}
			if phase != "committed" && !absent(filepath.Join(root, "models")) {
				t.Fatal("new files survive rollback")
			}
		})
	}
}
func TestMigrationRejectsBadJournalPaths(t *testing.T) {
	root := t.TempDir()
	work := filepath.Join(root, migrationDir)
	os.Mkdir(work, 0700)
	writeJSON(filepath.Join(work, "journal.json"), migrationJournal{Version: 1, Entries: []migrationEntry{{"../outside", false}}})
	if recoverMigration(root) == nil {
		t.Fatal("unsafe journal accepted")
	}
}

func TestNoMigrationDoesNotChangeLinkedExistingInstallation(t *testing.T) {
	root, linked := t.TempDir(), t.TempDir()
	if e := os.Symlink(linked, filepath.Join(root, "models")); e != nil {
		t.Skip(e)
	}
	if e := recoverMigration(root); e != nil {
		t.Fatal("unrelated installation rejected", e)
	}
	if e := freshMigrationDestination(root); e == nil {
		t.Fatal("linked destination allowed for import")
	}
}
