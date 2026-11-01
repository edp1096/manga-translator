package control

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixtureJob(t *testing.T, root string, n int, kept bool) string {
	t.Helper()
	id := fmt.Sprintf("12345678-1234-4234-8234-%012d", n)
	p := filepath.Join(root, "data/native_api/jobs", id)
	os.MkdirAll(p, 0700)
	for name, data := range map[string]string{"status.json": `{"status":"done"}`, "request.json": `{"title":"테스트 만화","pageURL":"https://example.com/ch1","page":2,"target":"Korean"}`, "original.png": "image", "result.json": "translation"} {
		if e := os.WriteFile(filepath.Join(p, name), []byte(data), 0600); e != nil {
			t.Fatal(e)
		}
	}
	if kept {
		os.WriteFile(filepath.Join(p, "keep.json"), []byte(`{"kept":true}`), 0600)
	}
	return id
}
func TestJobDataManagement(t *testing.T) {
	root := t.TempDir()
	m := &Manager{root: root, processes: map[string]*managedProcess{}}
	a, b := fixtureJob(t, root, 1, false), fixtureJob(t, root, 2, true)
	list, e := m.Jobs("테스트", "", 0, 1)
	if e != nil || list.Total != 2 || list.Kept != 1 || list.Matched != 2 || len(list.Items) != 1 || list.Bytes == 0 {
		t.Fatal(list, e)
	}
	if e = m.KeepJobs([]string{a}, true); e != nil {
		t.Fatal(e)
	}
	if _, e = m.DeleteJobs([]string{a}, false); e == nil {
		t.Fatal("kept deletion accepted")
	}
	if e = m.KeepJobs([]string{a}, false); e != nil {
		t.Fatal(e)
	}
	if _, e = m.DeleteJobs([]string{a, b}, false); e == nil {
		t.Fatal("mixed protected batch accepted")
	}
	if _, e = readJobInfo(root, a); e != nil {
		t.Fatal("partial deletion before validation")
	}
	ids, e := m.DeleteJobs(nil, true)
	if e != nil || len(ids) != 1 || ids[0] != a {
		t.Fatal(ids, e)
	}
	if _, e = readJobInfo(root, b); e != nil {
		t.Fatal("protected job lost", e)
	}
	for _, id := range []string{"../config", b + "/../", strings.ToUpper(b)} {
		if id == b {
			continue
		}
		if _, e = m.DeleteJobs([]string{id}, false); e == nil {
			t.Fatal("bad ID", id)
		}
	}
	m.busy = true
	if e = m.KeepJobs([]string{b}, false); e == nil {
		t.Fatal("busy mutation")
	}
	m.busy = false
	m.processes["vision"] = &managedProcess{}
	if _, e = m.DeleteJobs(nil, true); e == nil {
		t.Fatal("running API mutation")
	}
	delete(m.processes, "vision")
	if e = m.SaveJobPolicy(0); e != nil {
		t.Fatal(e)
	}
	p, e := readJobPolicy(root)
	if e != nil || p.RetentionDays != 0 {
		t.Fatal(p, e)
	}
	if e = m.SaveJobPolicy(-1); e == nil {
		t.Fatal("negative retention")
	}
}
func TestJobLinksAreNotManaged(t *testing.T) {
	root := t.TempDir()
	id := fixtureJob(t, root, 1, false)
	outside := t.TempDir()
	os.WriteFile(filepath.Join(outside, "keep"), []byte("safe"), 0600)
	if e := os.Symlink(outside, filepath.Join(root, "data/native_api/jobs", id, "link")); e != nil {
		t.Skip(e)
	}
	m := &Manager{root: root}
	list, e := m.Jobs("", "", 0, 50)
	if e != nil || list.Total != 0 || list.Skipped != 1 {
		t.Fatal(list, e)
	}
	if _, e = m.DeleteJobs([]string{id}, false); e == nil {
		t.Fatal("symlink job accepted")
	}
	if _, e = os.Stat(filepath.Join(outside, "keep")); e != nil {
		t.Fatal(e)
	}
}
func TestImportJobSelection(t *testing.T) {
	for _, mode := range []string{"all", "kept", "none"} {
		t.Run(mode, func(t *testing.T) {
			source := importFixture(t)
			kept := fixtureJob(t, source, 1, true)
			plain := fixtureJob(t, source, 2, false)
			dest := t.TempDir()
			if _, e := importDataOptions(context.Background(), dest, source, ImportOptions{Jobs: mode}, nil); e != nil {
				t.Fatal(e)
			}
			for _, id := range []string{kept, plain, "job"} {
				exists := !absent(filepath.Join(dest, "data/native_api/jobs", id, "result.json"))
				want := mode == "all" || (mode == "kept" && id == kept)
				if exists != want {
					t.Fatalf("%s %s exists=%v", mode, id, exists)
				}
			}
			if readImport(t, dest, "data/api-key") != strings.Repeat("a", 64) || readImport(t, dest, "models/test.gguf") != "model bytes" {
				t.Fatal("non-job data changed")
			}
			if absent(filepath.Join(source, "data/native_api/jobs", plain, "result.json")) {
				t.Fatal("source modified")
			}
		})
	}
}
