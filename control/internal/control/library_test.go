package control

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLibraryIdentity(t *testing.T) {
	for _, pair := range [][2]string{{"https://comic-walker.com/detail/a/episodes/b?episodeType=first#1", "https://comic-walker.com/detail/a/episodes/b"}, {"https://www.pixiv.net/en/artworks/123#2", "https://www.pixiv.net/artworks/123"}, {"https://urasunday.com/title/2/3", "https://manga-one.com/manga/2/chapter/3"}, {"https://vw.mangaz.com/virgo/view/43776/i:150", "https://vw.mangaz.com/virgo/view/43776"}} {
		if got := libraryIdentity(pair[0]); got != pair[1] {
			t.Fatal(got, pair)
		}
	}
	if libraryIdentity("javascript:alert(1)") != "" {
		t.Fatal("unsafe URL")
	}
	if libraryWork("https://klz9.com/rairairai-chapter-53.1.html") != "https://klz9.com/rairairai" {
		t.Fatal("decimal chapter")
	}
}
func TestLibraryRereading(t *testing.T) {
	root := t.TempDir()
	m := &Manager{root: root}
	page := "https://comic-walker.com/detail/test/episodes/one"
	result := `{"width":100,"height":200,"target":"Korean","regions":[]}`
	makeJob := func(n int, status, target, source string) string {
		id := fixtureJob(t, root, n, false)
		p, _ := jobPath(root, id)
		writeJSON(filepath.Join(p, "request.json"), map[string]any{"title": "작품 1화", "pageURL": page + "?episodeType=first", "sourceURL": source, "target": target})
		writeJSON(filepath.Join(p, "status.json"), map[string]string{"status": status})
		os.WriteFile(filepath.Join(p, "result.json"), []byte(strings.ReplaceAll(result, "Korean", target)), 0600)
		os.WriteFile(filepath.Join(p, "cleaned.png"), []byte("cleaned"), 0600)
		os.Chtimes(p, time.Unix(int64(n), 0), time.Unix(int64(n), 0))
		return id
	}
	good := makeJob(1, "done", "Korean", "image1")
	makeJob(2, "error", "Korean", "image1")
	makeJob(3, "done", "English", "image1")
	makeJob(4, "done", "Korean", "image2")
	bad := makeJob(5, "done", "Korean", "image3")
	p, _ := jobPath(root, bad)
	os.WriteFile(filepath.Join(p, "result.json"), []byte("broken"), 0600)
	fixtureJob(t, root, 6, false)
	handler := m.Handler()
	get := func(path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "http://127.0.0.1:8794"+path, nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	w := get("/api/library/restore?pageURL=" + url.QueryEscape(page+"?episodeType=latest#2") + "&target=Korean")
	var saved []SavedJob
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &saved) != nil || len(saved) != 2 {
		t.Fatal(w.Code, w.Body.String())
	}
	found := false
	for _, s := range saved {
		if s.ID == good {
			found = true
		}
	}
	if !found {
		t.Fatal("failed retry hid older success")
	}
	list, e := m.Library("작품")
	if e != nil || len(list.Chapters) != 2 {
		t.Fatal(list, e)
	}
	token := strings.Repeat("x", 64)
	os.WriteFile(filepath.Join(root, "data/native_api/access-token"), []byte(token), 0600)
	post := func(auth string, raw string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "http://127.0.0.1:8794/api/library/presentation/"+good, strings.NewReader(raw))
		r.Header.Set("Authorization", auth)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	body := `{"result":` + result + `,"bubbles":{"version":3,"width":100,"height":200,"bubbles":[]}}`
	if post("", body).Code != 403 {
		t.Fatal("unauthorized write")
	}
	if w := post("Bearer "+token, body); w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	if post("Bearer "+token, strings.ReplaceAll(body, "Korean", "English")).Code != 400 {
		t.Fatal("wrong language saved")
	}
	if get("/api/library/bubbles/"+good).Code != 200 {
		t.Fatal("saved geometry unavailable")
	}
	if get("/api/library/assets/"+good+"/original.png").Code != 200 {
		t.Fatal("asset requires inference")
	}
	if get("/api/library/assets/"+good+"/request.json").Code != 404 {
		t.Fatal("unexpected file exposed")
	}
	// Removing disk data must remove it from rereading, regardless of browser cache.
	p, _ = jobPath(root, good)
	os.RemoveAll(p)
	w = get("/api/library/restore?pageURL=" + url.QueryEscape(page) + "&target=Korean")
	json.Unmarshal(w.Body.Bytes(), &saved)
	if len(saved) != 1 {
		t.Fatal(w.Body.String())
	}
}
