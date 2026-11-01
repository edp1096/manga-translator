package control

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var jobIdentifier = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type JobInfo struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	PageURL   string    `json:"pageURL"`
	SourceURL string    `json:"sourceURL"`
	Target    string    `json:"target"`
	Status    string    `json:"status"`
	Error     string    `json:"error,omitempty"`
	Page      int       `json:"page"`
	Bytes     int64     `json:"bytes"`
	Files     int       `json:"files"`
	Updated   time.Time `json:"updated"`
	Kept      bool      `json:"kept"`
	HasImage  bool      `json:"hasImage"`
}
type JobPolicy struct {
	RetentionDays int `json:"retentionDays"`
}
type JobList struct {
	Items       []JobInfo `json:"items"`
	Total       int       `json:"total"`
	Matched     int       `json:"matched"`
	Bytes       int64     `json:"bytes"`
	Kept        int       `json:"kept"`
	UnkeptBytes int64     `json:"unkeptBytes"`
	Offset      int       `json:"offset"`
	Limit       int       `json:"limit"`
	Skipped     int       `json:"skipped"`
	Policy      JobPolicy `json:"policy"`
}

func jobPath(root, id string) (string, error) {
	if !jobIdentifier.MatchString(id) {
		return "", fmt.Errorf("잘못된 작업 ID")
	}
	return safeDestination(root, "data/native_api/jobs/"+id)
}
func readJobMetadata(path string, dest any) {
	f, e := os.Open(path)
	if e != nil {
		return
	}
	defer f.Close()
	_ = json.NewDecoder(io.LimitReader(f, 64<<10)).Decode(dest)
}
func readJobInfo(root, id string) (JobInfo, error) {
	j := JobInfo{ID: id, Status: "unknown"}
	p, e := jobPath(root, id)
	if e != nil {
		return j, e
	}
	st, e := os.Lstat(p)
	if e != nil {
		return j, e
	}
	if !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
		return j, fmt.Errorf("일반 작업 폴더가 아닙니다")
	}
	j.Updated = st.ModTime()
	e = filepath.WalkDir(p, func(name string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		info, e := d.Info()
		if e != nil {
			return e
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("링크를 포함한 작업은 자동 관리하지 않습니다")
		}
		if d.IsDir() {
			return nil
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("일반 파일이 아닌 작업")
		}
		j.Bytes += info.Size()
		j.Files++

		return nil
	})
	if e != nil {
		return j, e
	}
	var request struct {
		Title     string `json:"title"`
		PageURL   string `json:"pageURL"`
		SourceURL string `json:"sourceURL"`
		Target    string `json:"target"`
		Page      int    `json:"page"`
	}
	readJobMetadata(filepath.Join(p, "request.json"), &request)
	j.Title = request.Title
	j.PageURL = request.PageURL
	j.SourceURL = request.SourceURL
	j.Target = request.Target
	j.Page = request.Page
	var status struct {
		Status string `json:"status"`
		Error  string `json:"error"`
	}
	readJobMetadata(filepath.Join(p, "status.json"), &status)
	if status.Status != "" {
		j.Status = status.Status
	}
	j.Error = status.Error
	j.Kept = !absent(filepath.Join(p, "keep.json"))
	j.HasImage = !absent(filepath.Join(p, "original.png"))
	return j, nil
}
func scanJobs(root string) ([]JobInfo, int, error) {
	base, e := safeDestination(root, "data/native_api/jobs")
	if e != nil {
		return nil, 0, e
	}
	entries, e := os.ReadDir(base)
	if os.IsNotExist(e) {
		return []JobInfo{}, 0, nil
	}
	if e != nil {
		return nil, 0, e
	}
	jobs := []JobInfo{}
	skipped := 0
	for _, entry := range entries {
		if !jobIdentifier.MatchString(entry.Name()) || !entry.IsDir() {
			skipped++
			continue
		}
		j, e := readJobInfo(root, entry.Name())
		if e != nil {
			skipped++
			continue
		}
		jobs = append(jobs, j)
	}
	sort.Slice(jobs, func(i, j int) bool {
		if jobs[i].Updated.Equal(jobs[j].Updated) {
			return jobs[i].ID < jobs[j].ID
		}
		return jobs[i].Updated.After(jobs[j].Updated)
	})
	return jobs, skipped, nil
}
func readJobPolicy(root string) (JobPolicy, error) {
	p := JobPolicy{RetentionDays: 1}
	name, e := safeDestination(root, "data/native_api/job-policy.json")
	if e != nil {
		return p, e
	}
	raw, e := os.ReadFile(name)
	if os.IsNotExist(e) {
		return p, nil
	}
	if e != nil {
		return p, e
	}
	if json.Unmarshal(raw, &p) != nil || p.RetentionDays < 0 || p.RetentionDays > 365 {
		return JobPolicy{}, fmt.Errorf("자동 정리 설정이 올바르지 않습니다. API를 중지한 뒤 설정을 다시 저장하세요")
	}
	return p, nil
}
func (m *Manager) Jobs(query, filter string, offset, limit int) (JobList, error) {
	all, skipped, e := scanJobs(m.root)
	if e != nil {
		return JobList{}, e
	}
	policy, e := readJobPolicy(m.root)
	if e != nil {
		return JobList{}, e
	}
	if offset < 0 {
		offset = 0
	}
	if limit < 1 || limit > 100 {
		limit = 50
	}
	out := JobList{Items: []JobInfo{}, Total: len(all), Skipped: skipped, Policy: policy, Offset: offset, Limit: limit}
	matches := []JobInfo{}
	query = strings.ToLower(strings.TrimSpace(query))
	for _, j := range all {
		out.Bytes += j.Bytes
		if j.Kept {
			out.Kept++
		} else {
			out.UnkeptBytes += j.Bytes
		}
		if filter == "kept" && !j.Kept || filter == "unkept" && j.Kept || filter == "error" && j.Status != "error" {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(j.ID+" "+j.Title+" "+j.PageURL+" "+j.SourceURL+" "+j.Target), query) {
			continue
		}
		matches = append(matches, j)
	}
	out.Matched = len(matches)
	if offset < len(matches) {
		end := offset + limit
		if end > len(matches) {
			end = len(matches)
		}
		out.Items = matches[offset:end]
	}
	return out, nil
}
func (m *Manager) jobMaintenance() (func(), error) {
	m.mu.Lock()
	if m.busy || len(m.processes) > 0 || m.updatePending {
		m.mu.Unlock()
		return nil, fmt.Errorf("작업과 API를 중지한 뒤 데이터 관리를 실행하세요")
	}
	m.busy = true
	m.mu.Unlock()
	m.operation.Lock()
	release := func() { m.operation.Unlock(); m.mu.Lock(); m.busy = false; m.mu.Unlock() }
	for _, port := range []int{VisionPort, LLMPort} {
		c, e := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 200*time.Millisecond)
		if e == nil {
			c.Close()
			release()
			return nil, fmt.Errorf("별도로 실행 중인 API도 종료하세요")
		}
	}
	return release, nil
}
func validateJobIDs(ids []string) error {
	if len(ids) == 0 || len(ids) > 500 {
		return fmt.Errorf("작업은 1~500개씩 선택하세요")
	}
	seen := map[string]bool{}
	for _, id := range ids {
		if !jobIdentifier.MatchString(id) || seen[id] {
			return fmt.Errorf("잘못되었거나 중복된 작업 ID")
		}
		seen[id] = true
	}
	return nil
}
func (m *Manager) KeepJobs(ids []string, keep bool) error {
	if e := validateJobIDs(ids); e != nil {
		return e
	}
	release, e := m.jobMaintenance()
	if e != nil {
		return e
	}
	defer release()
	for _, id := range ids {
		if _, e := readJobInfo(m.root, id); e != nil {
			return e
		}
	}
	for _, id := range ids {
		p, _ := jobPath(m.root, id)
		p = filepath.Join(p, "keep.json")
		if keep {
			e = writeJSON(p, map[string]any{"kept": true, "savedAt": time.Now()})
		} else {
			e = os.Remove(p)
			if os.IsNotExist(e) {
				e = nil
			}
		}
		if e != nil {
			return e
		}
	}
	return nil
}
func (m *Manager) DeleteJobs(ids []string, allUnkept bool) ([]string, error) {
	if !allUnkept {
		if e := validateJobIDs(ids); e != nil {
			return nil, e
		}
	}
	release, e := m.jobMaintenance()
	if e != nil {
		return nil, e
	}
	defer release()
	if allUnkept {
		all, _, e := scanJobs(m.root)
		if e != nil {
			return nil, e
		}
		ids = nil
		for _, j := range all {
			if !j.Kept {
				ids = append(ids, j.ID)
			}
		}
	}
	for _, id := range ids {
		j, e := readJobInfo(m.root, id)
		if e != nil {
			return nil, e
		}
		if j.Kept {
			return nil, fmt.Errorf("보관 작업은 먼저 보관을 해제해야 삭제할 수 있습니다")
		}
	}
	deleted := []string{}
	for _, id := range ids {
		p, _ := jobPath(m.root, id)
		if e = os.RemoveAll(p); e != nil {
			return deleted, e
		}
		deleted = append(deleted, id)
	}
	return deleted, nil
}
func (m *Manager) SaveJobPolicy(days int) error {
	if days < 0 || days > 365 {
		return fmt.Errorf("자동 정리 기간은 0~365일입니다")
	}
	release, e := m.jobMaintenance()
	if e != nil {
		return e
	}
	defer release()
	p, e := safeDestination(m.root, "data/native_api/job-policy.json")
	if e != nil {
		return e
	}
	return writeJSON(p, JobPolicy{RetentionDays: days})
}
