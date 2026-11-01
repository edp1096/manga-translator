package control

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestLibraryCrossSiteGroups(t *testing.T) {
	root := t.TempDir()
	m := &Manager{root: root}
	a := "https://one.test/book"
	b := "https://two.test/other-title"
	c := "https://three.test/edition"
	makeJob := func(n int, base string) {
		id := fixtureJob(t, root, n, false)
		p, _ := jobPath(root, id)
		writeJSON(filepath.Join(p, "request.json"), map[string]any{"title": "Chapter", "pageURL": base + "-chapter-1.html", "sourceURL": base + "/page.png", "target": "Korean"})
		os.WriteFile(filepath.Join(p, "result.json"), []byte(`{"width":100,"height":200,"target":"Korean","regions":[]}`), 0600)
		os.WriteFile(filepath.Join(p, "cleaned.png"), []byte("image"), 0600)
	}
	makeJob(1, a)
	makeJob(2, b)
	makeJob(3, c)
	before, _, _ := scanJobs(root)
	if e := m.MergeLibraryGroups("같은 만화", []string{a, b}); e != nil {
		t.Fatal(e)
	}
	fresh := &Manager{root: root}
	list, e := fresh.Library("같은 만화")
	if e != nil || len(list.Chapters) != 2 || len(list.Groups) != 1 {
		t.Fatal(list, e)
	}
	group := list.Groups[0]
	for _, ch := range list.Chapters {
		if ch.GroupID != group.ID || ch.Ready != 1 {
			t.Fatal(ch)
		}
	}
	// New chapter on either linked source joins after a restart; unrelated titles do not.
	id := fixtureJob(t, root, 4, false)
	p, _ := jobPath(root, id)
	writeJSON(filepath.Join(p, "request.json"), map[string]any{"title": "Different page title", "pageURL": b + "-chapter-2.html", "sourceURL": b + "/page2.png", "target": "English"})
	list, e = fresh.Library("같은 만화")
	if e != nil || len(list.Chapters) != 3 {
		t.Fatal(list, e)
	}
	after, _, _ := scanJobs(root)
	for _, old := range before {
		for _, now := range after {
			if old.ID == now.ID && !reflect.DeepEqual(old, now) {
				t.Fatal("grouping changed translation data", old, now)
			}
		}
	}
	// Merging an existing group includes all its sources, then detach one source only.
	if e = m.MergeLibraryGroups("확장 작품", []string{a, c}); e != nil {
		t.Fatal(e)
	}
	groups, _ := readLibraryGroups(root)
	if len(groups) != 1 || len(groups[0].Sources) != 3 {
		t.Fatal(groups)
	}
	if e = m.DetachLibrarySource(groups[0].ID, b); e != nil {
		t.Fatal(e)
	}
	groups, _ = readLibraryGroups(root)
	if len(groups) != 1 || len(groups[0].Sources) != 2 {
		t.Fatal(groups)
	}
	if e = m.DetachLibrarySource(groups[0].ID, ""); e != nil {
		t.Fatal(e)
	}
	list, _ = m.Library("")
	for _, ch := range list.Chapters {
		if ch.GroupID != "" {
			t.Fatal("unlink failed")
		}
	}
	if e = m.MergeLibraryGroups("invalid", []string{a, "https://unknown.test/title"}); e == nil {
		t.Fatal("unknown scope accepted")
	}
	if e = m.MergeLibraryGroups("invalid", []string{a, a}); e == nil {
		t.Fatal("duplicates accepted")
	}
	// Authenticated management writes must keep the existing CSRF restrictions.
	body := `{"title":"API group","sources":["` + a + `","` + b + `"]}`
	send := func(valid bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "http://127.0.0.1:8794/api/library/groups/merge", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if valid {
			r.Header.Set("Origin", "http://127.0.0.1:8794")
			r.Header.Set("X-Manga-Control", "1")
		}
		w := httptest.NewRecorder()
		m.Handler().ServeHTTP(w, r)
		return w
	}
	if send(false).Code != 403 {
		t.Fatal("cross-origin mutation allowed")
	}
	if w := send(true); w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	raw, _ := os.ReadFile(filepath.Join(root, "data/library-groups.json"))
	var f libraryGroupsFile
	if json.Unmarshal(raw, &f) != nil || f.Version != 1 {
		t.Fatal("persistence")
	}
	m.updatePending = true
	if m.DetachLibrarySource(f.Groups[0].ID, "") == nil {
		t.Fatal("mutation during update")
	}
	m.updatePending = false
	os.WriteFile(filepath.Join(root, "data/library-groups.json"), []byte("corrupt"), 0600)
	if m.MergeLibraryGroups("must not overwrite", []string{a, b}) == nil {
		t.Fatal("corrupt data overwritten")
	}
	raw, _ = os.ReadFile(filepath.Join(root, "data/library-groups.json"))
	if string(raw) != "corrupt" {
		t.Fatal("corrupt original not preserved")
	}
}

func TestLibraryGroupsMigrate(t *testing.T) {
	source, dest := importFixture(t), t.TempDir()
	m := &Manager{root: source}
	groups := []LibraryGroup{{ID: "saved", Title: "연결 작품", Sources: []string{"https://one.test/book", "https://two.test/book"}}}
	if e := m.saveLibraryGroups(groups); e != nil {
		t.Fatal(e)
	}
	if _, e := importData(context.Background(), dest, source, nil); e != nil {
		t.Fatal(e)
	}
	restored, e := readLibraryGroups(dest)
	if e != nil || !reflect.DeepEqual(restored, groups) {
		t.Fatal(restored, e)
	}
}
