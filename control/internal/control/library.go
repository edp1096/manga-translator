package control

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Keep reader URL identities aligned with extension/readers.js. Never match
// images by page number alone: reordered pages must not receive another result.
func libraryIdentity(raw string) string {
	u, e := url.Parse(raw)
	if e != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || u.User != nil {
		return ""
	}
	u.Fragment = ""
	switch u.Hostname() {
	case "comic-walker.com":
		if strings.Contains(u.Path, "/episodes/") {
			u.RawQuery = ""
		}
	case "tonarinoyj.jp":
		if strings.HasPrefix(u.Path, "/episode/") {
			u.RawQuery = ""
		}
	case "vw.mangaz.com":
		if p := regexp.MustCompile(`^/virgo/view/[0-9]+`).FindString(u.Path); p != "" {
			u.Path = p
			u.RawQuery = ""
		}
	case "urasunday.com":
		if m := regexp.MustCompile(`^/title/([0-9]+)/([0-9]+)/?$`).FindStringSubmatch(u.Path); m != nil {
			u.Host = "manga-one.com"
			u.Path = "/manga/" + m[1] + "/chapter/" + m[2]
			u.RawQuery = ""
		}
	case "manga-one.com":
		if regexp.MustCompile(`^/manga/[0-9]+/chapter/[0-9]+/?$`).MatchString(u.Path) {
			u.Path = strings.TrimSuffix(u.Path, "/")
			u.RawQuery = ""
		}
	case "www.pixiv.net":
		if m := regexp.MustCompile(`^/(?:[a-z]{2}/)?artworks/([0-9]+)/?$`).FindStringSubmatch(u.Path); m != nil {
			u.Path = "/artworks/" + m[1]
			u.RawQuery = ""
		}
	}
	u.RawPath = ""
	return u.String()
}

var chapterPath = regexp.MustCompile(`(?i)^(.*?)(?:[-_/](?:chapter|chap|ch|episode|ep)[-_/]?[0-9]+(?:[.-][0-9]+)*)(?:\.html?)?/?$`)

func libraryWork(raw string) string {
	u, _ := url.Parse(raw)
	if u == nil {
		return raw
	}
	for _, pattern := range []string{`^(/detail/[^/]+)/episodes/`, `^(/manga/[0-9]+)/chapter/`, `^(/read/[^/]+)/ch[0-9]`} {
		if m := regexp.MustCompile(pattern).FindStringSubmatch(u.Path); m != nil {
			u.Path = m[1]
			u.RawQuery = ""
			return u.String()
		}
	}
	if m := chapterPath.FindStringSubmatch(u.Path); m != nil && m[1] != "" {
		u.Path = m[1]
		u.RawQuery = ""
	}
	return u.String()
}

type LibraryChapter struct {
	URL     string    `json:"url"`
	Work    string    `json:"work"`
	Title   string    `json:"title"`
	Target  string    `json:"target"`
	IDs     []string  `json:"ids"`
	Pages   int       `json:"pages"`
	Ready   int       `json:"ready"`
	Failed  int       `json:"failed"`
	Kept    int       `json:"kept"`
	Updated time.Time `json:"updated"`
}
type LibraryList struct {
	Chapters []LibraryChapter `json:"chapters"`
	Unlinked int              `json:"unlinked"`
	Policy   JobPolicy        `json:"policy"`
}

func (m *Manager) Library(query string) (LibraryList, error) {
	out := LibraryList{Chapters: []LibraryChapter{}}
	jobs, _, e := scanJobs(m.root)
	if e != nil {
		return out, e
	}
	out.Policy, e = readJobPolicy(m.root)
	if e != nil {
		return out, e
	}
	groups := map[string]*LibraryChapter{}
	groupedJobs := map[string][]JobInfo{}
	pages := map[string]map[string]bool{}
	query = strings.ToLower(strings.TrimSpace(query))
	for _, j := range jobs {
		u := libraryIdentity(j.PageURL)
		if u == "" {
			out.Unlinked++
			continue
		}
		key := u + "\n" + j.Target
		groupedJobs[key] = append(groupedJobs[key], j)
		c := groups[key]
		if c == nil {
			c = &LibraryChapter{URL: u, Work: libraryWork(u), Title: j.Title, Target: j.Target, Updated: j.Updated, IDs: []string{}}
			groups[key] = c
			pages[key] = map[string]bool{}
		}
		c.IDs = append(c.IDs, j.ID)
		if j.Kept {
			c.Kept++
		}
		if j.Status == "error" {
			c.Failed++
		}
		source := j.SourceURL
		if source == "" {
			source = j.ID
		}
		if !pages[key][source] {
			pages[key][source] = true
			c.Pages++
		}
	}
	// Only count results that can actually be reopened, including older successful
	// attempts when a more recent retry failed.
	for _, c := range groups {
		saved, e := m.savedJobs(groupedJobs[c.URL+"\n"+c.Target], c.URL, c.Target, false)
		if e != nil {
			return out, e
		}
		c.Ready = len(saved)
		if query == "" || strings.Contains(strings.ToLower(c.Title+" "+c.URL+" "+c.Work+" "+c.Target), query) {
			out.Chapters = append(out.Chapters, *c)
		}
	}
	sort.Slice(out.Chapters, func(i, j int) bool {
		a, b := out.Chapters[i], out.Chapters[j]
		if a.Updated.Equal(b.Updated) {
			return a.URL+a.Target < b.URL+b.Target
		}
		return a.Updated.After(b.Updated)
	})
	return out, nil
}

type SavedJob struct {
	ID        string          `json:"id"`
	Key       string          `json:"key"`
	SourceURL string          `json:"sourceURL"`
	Result    json.RawMessage `json:"result,omitempty"`
	Bubbles   json.RawMessage `json:"bubbles,omitempty"`
	Updated   int64           `json:"updated"`
}

func readLibraryJSON(root, id, name string) (json.RawMessage, error) {
	p, e := jobPath(root, id)
	if e != nil {
		return nil, e
	}
	p, e = safeDestination(p, name)
	if e != nil {
		return nil, e
	}
	f, e := os.Open(p)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil || !st.Mode().IsRegular() || st.Size() > 8<<20 {
		return nil, fmt.Errorf("저장 결과 크기 또는 형식이 잘못되었습니다")
	}
	raw, e := io.ReadAll(io.LimitReader(f, (8<<20)+1))
	if e != nil || !json.Valid(raw) {
		return nil, fmt.Errorf("저장 결과 JSON이 올바르지 않습니다")
	}
	return raw, nil
}
func (m *Manager) savedJobs(jobs []JobInfo, page, target string, withResult bool) ([]SavedJob, error) {
	out := []SavedJob{}
	seen := map[string]bool{}
	for _, j := range jobs {
		if libraryIdentity(j.PageURL) != page || j.Target != target || j.SourceURL == "" || seen[j.SourceURL] || j.Status != "done" {
			continue
		}
		p, _ := jobPath(m.root, j.ID)
		if absent(filepath.Join(p, "original.png")) || absent(filepath.Join(p, "cleaned.png")) {
			continue
		}
		raw, e := readLibraryJSON(m.root, j.ID, "result.json")
		if e != nil {
			continue
		}
		var result struct {
			Width   int               `json:"width"`
			Height  int               `json:"height"`
			Target  string            `json:"target"`
			Regions []json.RawMessage `json:"regions"`
		}
		if json.Unmarshal(raw, &result) != nil || result.Width <= 0 || result.Height <= 0 || result.Regions == nil || result.Target != target {
			continue
		}
		seen[j.SourceURL] = true
		s := SavedJob{ID: j.ID, Key: j.ID, SourceURL: j.SourceURL, Updated: j.Updated.UnixMilli()}
		if withResult {
			s.Result = raw
			if presentation, e := readLibraryJSON(m.root, j.ID, "presentation.json"); e == nil {
				var view struct {
					Result  json.RawMessage `json:"result"`
					Bubbles json.RawMessage `json:"bubbles"`
				}
				if json.Unmarshal(presentation, &view) == nil {
					if validPresentation(view.Result, raw) {
						s.Result = view.Result
						s.Bubbles = view.Bubbles
					}
				}
			}
		}
		out = append(out, s)
	}
	return out, nil
}
func (m *Manager) libraryRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/library/presentation/{id}", func(w http.ResponseWriter, r *http.Request) {
		token, e := os.ReadFile(filepath.Join(m.root, "data/native_api/access-token"))
		expected := "Bearer " + strings.TrimSpace(string(token))
		if e != nil || len(token) < 32 || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte(expected)) != 1 {
			respond(w, map[string]string{"error": "인증 실패"}, 403)
			return
		}
		id := r.PathValue("id")
		base, e := readLibraryJSON(m.root, id, "result.json")
		if e != nil {
			http.NotFound(w, r)
			return
		}
		var view struct {
			Result  json.RawMessage `json:"result"`
			Bubbles json.RawMessage `json:"bubbles,omitempty"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
		if json.NewDecoder(r.Body).Decode(&view) != nil || !validPresentation(view.Result, base) {
			respond(w, map[string]string{"error": "저장 결과와 맞지 않는 표시 정보"}, 400)
			return
		}
		p, e := jobPath(m.root, id)
		if e == nil {
			p, e = safeDestination(p, "presentation.json")
		}
		if e == nil {
			e = writeJSON(p, view)
		}
		action(w, e)
	})
	mux.HandleFunc("GET /api/library/bubbles/{id}", func(w http.ResponseWriter, r *http.Request) {
		raw, e := readLibraryJSON(m.root, r.PathValue("id"), "presentation.json")
		var view struct {
			Bubbles json.RawMessage `json:"bubbles"`
		}
		if e != nil || json.Unmarshal(raw, &view) != nil || len(view.Bubbles) == 0 || string(view.Bubbles) == "null" {
			http.NotFound(w, r)
			return
		}
		respond(w, view.Bubbles, 200)
	})
	mux.HandleFunc("GET /api/library", func(w http.ResponseWriter, r *http.Request) {
		v, e := m.Library(r.URL.Query().Get("q"))
		if e != nil {
			action(w, e)
			return
		}
		respond(w, v, 200)
	})
	mux.HandleFunc("GET /api/library/restore", func(w http.ResponseWriter, r *http.Request) {
		page := libraryIdentity(r.URL.Query().Get("pageURL"))
		if page == "" {
			respond(w, map[string]string{"error": "잘못된 회차 주소"}, 400)
			return
		}
		jobs, _, e := scanJobs(m.root)
		if e != nil {
			action(w, e)
			return
		}
		v, e := m.savedJobs(jobs, page, r.URL.Query().Get("target"), true)
		if e != nil {
			action(w, e)
			return
		}
		respond(w, v, 200)
	})
	mux.HandleFunc("GET /api/library/assets/{id}/{name}", func(w http.ResponseWriter, r *http.Request) {
		id, name := r.PathValue("id"), r.PathValue("name")
		valid := map[string]bool{"original.png": true, "cleaned.png": true, "mask.png": true, "result.json": true, "restored-v1.png": true, "restoration-v1.json": true}
		if !valid[name] && !regexp.MustCompile(`^manual-[0-9a-f]{32}\.png$`).MatchString(name) {
			http.NotFound(w, r)
			return
		}
		p, e := jobPath(m.root, id)
		if e == nil {
			p, e = safeDestination(p, name)
		}
		if e != nil {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, p)
	})
}

func validPresentation(raw, base json.RawMessage) bool {
	var a, b struct {
		Width   int               `json:"width"`
		Height  int               `json:"height"`
		Target  string            `json:"target"`
		Regions []json.RawMessage `json:"regions"`
	}
	return json.Unmarshal(raw, &a) == nil && json.Unmarshal(base, &b) == nil && a.Width == b.Width && a.Height == b.Height && a.Target == b.Target && a.Regions != nil && len(a.Regions) <= 150
}
