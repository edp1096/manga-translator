package control

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"unicode/utf8"
)

type LibraryGroup struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Sources []string `json:"sources"`
}
type libraryGroupsFile struct {
	Version int            `json:"version"`
	Groups  []LibraryGroup `json:"groups"`
}

func readLibraryGroups(root string) ([]LibraryGroup, error) {
	p, e := safeDestination(root, "data/library-groups.json")
	if e != nil {
		return nil, e
	}
	raw, e := os.ReadFile(p)
	if os.IsNotExist(e) {
		return []LibraryGroup{}, nil
	}
	if e != nil {
		return nil, e
	}
	var f libraryGroupsFile
	if len(raw) > 2<<20 || json.Unmarshal(raw, &f) != nil || f.Version != 1 || len(f.Groups) > 1000 {
		return nil, fmt.Errorf("서재 연결 정보를 읽을 수 없습니다. 기존 파일을 보존했습니다")
	}
	ids, sources := map[string]bool{}, map[string]bool{}
	for _, g := range f.Groups {
		if g.ID == "" || ids[g.ID] || strings.TrimSpace(g.Title) == "" || len(g.Sources) < 2 || len(g.Sources) > 100 {
			return nil, fmt.Errorf("잘못된 서재 연결 정보")
		}
		ids[g.ID] = true
		for _, s := range g.Sources {
			if libraryIdentity(s) == "" || libraryWork(libraryIdentity(s)) != s || sources[s] {
				return nil, fmt.Errorf("중복되거나 잘못된 작품 주소")
			}
			sources[s] = true
		}
	}
	return f.Groups, nil
}
func (m *Manager) saveLibraryGroups(groups []LibraryGroup) error {
	p, e := safeDestination(m.root, "data/library-groups.json")
	if e != nil {
		return e
	}
	if len(groups) > 1000 {
		return fmt.Errorf("작품 묶음은 1000개까지 저장할 수 있습니다")
	}
	return writeJSON(p, libraryGroupsFile{Version: 1, Groups: groups})
}
func (m *Manager) libraryGroupMutation(change func([]LibraryGroup) ([]LibraryGroup, error)) error {
	m.operation.Lock()
	defer m.operation.Unlock()
	m.mu.Lock()
	blocked := m.updatePending || m.busy
	m.mu.Unlock()
	if blocked {
		return fmt.Errorf("앱 작업이 끝난 뒤 작품 연결을 변경하세요")
	}
	groups, e := readLibraryGroups(m.root)
	if e != nil {
		return e
	}
	groups, e = change(groups)
	if e != nil {
		return e
	}
	return m.saveLibraryGroups(groups)
}
func (m *Manager) MergeLibraryGroups(title string, sources []string) error {
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > 120 || strings.ContainsAny(title, "\r\n\t") {
		return fmt.Errorf("작품 이름을 1~120자로 입력하세요")
	}
	if len(sources) < 2 || len(sources) > 100 {
		return fmt.Errorf("연결할 작품 주소를 2~100개 선택하세요")
	}
	return m.libraryGroupMutation(func(groups []LibraryGroup) ([]LibraryGroup, error) {
		wanted := map[string]bool{}
		for _, s := range sources {
			if libraryIdentity(s) == "" || libraryWork(libraryIdentity(s)) != s || wanted[s] {
				return nil, fmt.Errorf("잘못되었거나 중복된 작품 주소")
			}
			wanted[s] = true
		}
		known := map[string]bool{}
		jobs, _, e := scanJobs(m.root)
		if e != nil {
			return nil, e
		}
		for _, j := range jobs {
			if u := libraryIdentity(j.PageURL); u != "" {
				known[libraryWork(u)] = true
			}
		}
		for _, g := range groups {
			for _, s := range g.Sources {
				known[s] = true
			}
		}
		for s := range wanted {
			if !known[s] {
				return nil, fmt.Errorf("서재에 없는 작품 주소입니다. 목록을 새로고침하세요")
			}
		}
		out := []LibraryGroup{}
		id := ""
		for _, g := range groups {
			overlap := false
			for _, s := range g.Sources {
				if wanted[s] {
					overlap = true
					break
				}
			}
			if overlap {
				if id == "" {
					id = g.ID
				}
				for _, s := range g.Sources {
					wanted[s] = true
				}
			} else {
				out = append(out, g)
			}
		}
		if len(wanted) > 100 {
			return nil, fmt.Errorf("한 작품에는 주소를 100개까지 연결할 수 있습니다")
		}
		if id == "" {
			id, e = randomSecret()
			if e != nil {
				return nil, e
			}
		}
		all := []string{}
		for s := range wanted {
			all = append(all, s)
		}
		sort.Strings(all)
		out = append(out, LibraryGroup{ID: id, Title: title, Sources: all})
		return out, nil
	})
}
func (m *Manager) DetachLibrarySource(id, source string) error {
	return m.libraryGroupMutation(func(groups []LibraryGroup) ([]LibraryGroup, error) {
		out := []LibraryGroup{}
		found := false
		for _, g := range groups {
			if g.ID != id {
				out = append(out, g)
				continue
			}
			found = true
			if source == "" {
				continue
			}
			remaining := []string{}
			matched := false
			for _, s := range g.Sources {
				if s == source {
					matched = true
				} else {
					remaining = append(remaining, s)
				}
			}
			if !matched {
				return nil, fmt.Errorf("연결된 주소가 아닙니다")
			}
			if len(remaining) >= 2 {
				g.Sources = remaining
				out = append(out, g)
			}
		}
		if !found {
			return nil, fmt.Errorf("작품 연결이 변경되었습니다. 목록을 새로고침하세요")
		}
		return out, nil
	})
}
func (m *Manager) libraryGroupRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/library/groups/merge", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Title   string   `json:"title"`
			Sources []string `json:"sources"`
		}
		if !decode(w, r, &b) {
			return
		}
		action(w, m.MergeLibraryGroups(b.Title, b.Sources))
	})
	mux.HandleFunc("POST /api/library/groups/detach", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ID     string `json:"id"`
			Source string `json:"source"`
		}
		if !decode(w, r, &b) {
			return
		}
		action(w, m.DetachLibrarySource(b.ID, b.Source))
	})
}
