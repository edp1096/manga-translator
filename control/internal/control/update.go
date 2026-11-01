package control

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Compile-time release origins. Tests build isolated binaries against a fixture
// server; installed applications do not accept user-supplied update URLs.
var updateAPIURL = "https://api.github.com/repos/edp1096/manga-translator/releases/latest"
var updateReleaseBase = "https://github.com/edp1096/manga-translator/releases/download/"

type UpdateState struct {
	Status         string    `json:"status"`
	Version        string    `json:"version,omitempty"`
	Notes          string    `json:"notes,omitempty"`
	URL            string    `json:"url,omitempty"`
	Error          string    `json:"error,omitempty"`
	DisabledReason string    `json:"disabledReason,omitempty"`
	CheckedAt      time.Time `json:"checkedAt,omitempty"`
}
type updateAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
	Size int64  `json:"size"`
}
type updateRelease struct {
	Tag        string        `json:"tag_name"`
	Draft      bool          `json:"draft"`
	Prerelease bool          `json:"prerelease"`
	Notes      string        `json:"body"`
	URL        string        `json:"html_url"`
	Assets     []updateAsset `json:"assets"`
}

func numericVersion(s string) ([3]uint64, error) {
	var v [3]uint64
	p := strings.Split(strings.TrimPrefix(s, "v"), ".")
	if len(p) != 3 {
		return v, fmt.Errorf("잘못된 버전: %s", s)
	}
	for i, x := range p {
		if x == "" || (len(x) > 1 && x[0] == '0') {
			return v, fmt.Errorf("잘못된 버전")
		}
		for _, c := range x {
			if c < '0' || c > '9' {
				return v, fmt.Errorf("잘못된 버전")
			}
		}
		n, e := strconv.ParseUint(x, 10, 32)
		if e != nil {
			return v, e
		}
		v[i] = n
	}
	return v, nil
}
func newerVersion(a, b string) bool {
	x, e := numericVersion(a)
	y, f := numericVersion(b)
	if e != nil || f != nil {
		return false
	}
	for i := range x {
		if x[i] != y[i] {
			return x[i] > y[i]
		}
	}
	return false
}
func updateExecutable(platform string) string {
	if platform == "windows-amd64" {
		return "MangaTranslator.exe"
	}
	return "manga-control"
}
func updateZipName(platform, version string) string {
	return "manga-translator-" + strings.ReplaceAll(platform, "amd64", "x64") + "-" + version + ".zip"
}
func (r updateRelease) asset(name string) (updateAsset, error) {
	var found *updateAsset
	for _, a := range r.Assets {
		if a.Name == name {
			if found != nil {
				return updateAsset{}, fmt.Errorf("중복 배포 파일")
			}
			v := a
			found = &v
		}
	}
	if found == nil {
		return updateAsset{}, fmt.Errorf("배포 파일이 없습니다: %s", name)
	}
	expected := updateReleaseBase + r.Tag + "/" + name
	if found.URL != expected || found.Size <= 0 {
		return updateAsset{}, fmt.Errorf("배포 파일 출처 또는 크기가 올바르지 않습니다")
	}
	return *found, nil
}
func updateResponse(ctx context.Context, client *http.Client, address string) (*http.Response, error) {
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if e != nil {
		return nil, e
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "MangaTranslator/"+Version)
	res, e := client.Do(req)
	if e != nil {
		return nil, e
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, fmt.Errorf("업데이트 서버 응답: HTTP %d", res.StatusCode)
	}
	return res, nil
}
func fetchRelease(ctx context.Context, client *http.Client) (updateRelease, error) {
	var r updateRelease
	res, e := updateResponse(ctx, client, updateAPIURL)
	if e != nil {
		return r, e
	}
	defer res.Body.Close()
	e = json.NewDecoder(io.LimitReader(res.Body, 2<<20)).Decode(&r)
	if e != nil {
		return r, e
	}
	if _, e = numericVersion(r.Tag); e != nil || !strings.HasPrefix(r.Tag, "v") || r.Draft || r.Prerelease {
		return r, fmt.Errorf("정식 릴리즈 정보가 아닙니다")
	}
	// Links shown in the UI must not carry arbitrary schemes from release metadata.
	u, e := url.Parse(r.URL)
	if e != nil || u.Scheme != "https" || u.Host != "github.com" {
		r.URL = ""
	}
	if len(r.Notes) > 20000 {
		r.Notes = r.Notes[:20000]
	}
	return r, nil
}
func (m *Manager) updateState() UpdateState {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := m.update
	s.DisabledReason = m.updateDisabledReason()
	return s
}

// Called with m.mu held. A portable update must replace this application's own
// executable, not a sibling executable selected through --root.
func (m *Manager) updateDisabledReason() string {
	executable, e := os.Executable()
	if e != nil {
		return "실행 파일 위치를 확인할 수 없습니다"
	}
	executable, e = filepath.EvalSymlinks(executable)
	if e != nil {
		return e.Error()
	}
	expected := filepath.Join(m.root, updateExecutable(m.platform))
	if !sameUpdatePath(executable, expected) {
		return "배포 폴더의 기본 실행 파일로 실행해야 업데이트할 수 있습니다"
	}
	if m.busy || len(m.processes) > 0 {
		return "진행 중인 작업과 API를 중지한 뒤 업데이트하세요"
	}
	return ""
}
func (m *Manager) CheckUpdate() error {
	m.mu.Lock()
	if m.updatePending || m.update.Status == "checking" {
		m.mu.Unlock()
		return fmt.Errorf("업데이트 작업이 진행 중입니다")
	}
	m.update.Status = "checking"
	m.update.Error = ""
	m.mu.Unlock()
	go func() {
		ctx, cancel := context.WithTimeout(m.ctx, 20*time.Second)
		defer cancel()
		r, e := fetchRelease(ctx, &http.Client{Timeout: 20 * time.Second})
		m.mu.Lock()
		defer m.mu.Unlock()
		m.update.CheckedAt = time.Now()
		if e != nil {
			m.update.Status = "error"
			m.update.Error = e.Error()
			return
		}
		m.updateRelease = &r
		m.update.Version = strings.TrimPrefix(r.Tag, "v")
		m.update.Notes = r.Notes
		m.update.URL = r.URL
		m.update.Status = "latest"
		if newerVersion(r.Tag, Version) {
			if _, e = r.asset(updateZipName(m.platform, m.update.Version)); e != nil {
				m.update.Status = "error"
				m.update.Error = e.Error()
			} else {
				m.update.Status = "available"
			}
		}
	}()
	return nil
}
func (m *Manager) InstallUpdate() error {
	m.mu.Lock()
	if m.updatePending || m.update.Status != "available" || m.updateRelease == nil {
		m.mu.Unlock()
		return fmt.Errorf("설치할 새 버전을 먼저 확인하세요")
	}
	if why := m.updateDisabledReason(); why != "" {
		m.mu.Unlock()
		return fmt.Errorf("%s", why)
	}
	r := *m.updateRelease
	m.updatePending = true
	m.busy = true
	m.update.Status = "downloading"
	m.update.Error = ""
	m.mu.Unlock()
	go func() {
		m.operation.Lock()
		defer m.operation.Unlock()
		e := m.prepareUpdate(r)
		if e != nil {
			m.mu.Lock()
			m.updatePending = false
			m.busy = false
			m.update.Status = "error"
			m.update.Error = e.Error()
			m.mu.Unlock()
			m.logf("업데이트 준비 실패: %v", e)
			return
		}
		m.mu.Lock()
		m.update.Status = "restarting"
		m.mu.Unlock()
		time.Sleep(400 * time.Millisecond)
		m.shutdown()
	}()
	return nil
}
func downloadUpdate(ctx context.Context, client *http.Client, a updateAsset, destination string, limit int64) error {
	if a.Size <= 0 || a.Size > limit {
		return fmt.Errorf("업데이트 파일 크기 제한 초과")
	}
	res, e := updateResponse(ctx, client, a.URL)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	f, e := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	n, e := io.Copy(f, io.LimitReader(res.Body, a.Size+1))
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	if n != a.Size {
		return fmt.Errorf("업데이트 다운로드 크기 불일치")
	}
	return nil
}
func checksumFor(raw []byte, name string) (string, error) {
	found := ""
	for _, line := range strings.Split(string(raw), "\n") {
		p := strings.Fields(line)
		if len(p) == 2 && p[1] == name {
			if found != "" {
				return "", fmt.Errorf("중복 체크섬")
			}
			b, e := hex.DecodeString(p[0])
			if e != nil || len(b) != 32 {
				return "", fmt.Errorf("잘못된 SHA256")
			}
			found = strings.ToLower(p[0])
		}
	}
	if found == "" {
		return "", fmt.Errorf("배포 파일 체크섬이 없습니다")
	}
	return found, nil
}
func updateFileAllowed(name, exe string) bool {
	if strings.ContainsAny(name, "\\:") || path.Clean(name) != name || strings.HasPrefix(name, "/") {
		return false
	}
	return name == exe || name == "README.txt" || name == "DOWNLOADS.json" || (strings.HasPrefix(name, "licenses/") && strings.Count(name, "/") == 1 && path.Base(name) != ".")
}
func extractUpdate(archive, stage, exe, version string) error {
	z, e := zip.OpenReader(archive)
	if e != nil {
		return e
	}
	defer z.Close()
	seen := map[string]bool{}
	var total uint64
	for _, f := range z.File {
		if !updateFileAllowed(f.Name, exe) || !f.Mode().IsRegular() || seen[strings.ToLower(f.Name)] {
			return fmt.Errorf("허용되지 않은 업데이트 ZIP 항목: %s", f.Name)
		}
		seen[strings.ToLower(f.Name)] = true
		total += f.UncompressedSize64
		if total > 512<<20 || len(seen) > 256 {
			return fmt.Errorf("업데이트 ZIP 크기 제한 초과")
		}
		dest := filepath.Join(stage, filepath.FromSlash(f.Name))
		if e = os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
			return e
		}
		src, e := f.Open()
		if e != nil {
			return e
		}
		mode := os.FileMode(0644)
		if f.Name == exe {
			mode = 0755
		}
		out, e := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
		if e != nil {
			src.Close()
			return e
		}
		n, copyErr := io.Copy(out, io.LimitReader(src, int64(f.UncompressedSize64)+1))
		syncErr := out.Sync()
		out.Close()
		src.Close()
		if copyErr != nil {
			return copyErr
		}
		if syncErr != nil {
			return syncErr
		}
		if uint64(n) != f.UncompressedSize64 {
			return fmt.Errorf("ZIP 항목 크기 불일치")
		}
	}
	for _, required := range []string{exe, "README.txt", "DOWNLOADS.json"} {
		if !seen[strings.ToLower(required)] {
			return fmt.Errorf("필수 업데이트 파일 누락: %s", required)
		}
	}
	raw, e := os.ReadFile(filepath.Join(stage, "DOWNLOADS.json"))
	if e != nil {
		return e
	}
	var c struct {
		Version string `json:"version"`
	}
	if json.Unmarshal(raw, &c) != nil || c.Version != version {
		return fmt.Errorf("다운로드 카탈로그 버전 불일치")
	}
	return nil
}
func (m *Manager) prepareUpdate(r updateRelease) error {
	version := strings.TrimPrefix(r.Tag, "v")
	asset, e := r.asset(updateZipName(m.platform, version))
	if e != nil {
		return e
	}
	sums, e := r.asset("manga-translator-" + version + "-SHA256SUMS.txt")
	if e != nil {
		return e
	}
	if e = cleanFinishedUpdate(m.root); e != nil {
		return e
	}
	work, e := safeDestination(m.root, ".app-update")
	if e != nil {
		return e
	}
	if e = os.Mkdir(work, 0700); e != nil {
		return fmt.Errorf("이전 업데이트 작업을 먼저 복구해야 합니다: %w", e)
	}
	handedOff := false
	defer func() {
		if !handedOff {
			os.RemoveAll(work)
		}
	}()
	ctx, cancel := context.WithTimeout(m.ctx, 15*time.Minute)
	defer cancel()
	client := &http.Client{Timeout: 15 * time.Minute}
	if e = downloadUpdate(ctx, client, sums, filepath.Join(work, "checksums"), 1<<20); e != nil {
		return e
	}
	raw, e := os.ReadFile(filepath.Join(work, "checksums"))
	if e != nil {
		return e
	}
	sum, e := checksumFor(raw, asset.Name)
	if e != nil {
		return e
	}
	archive := filepath.Join(work, "release.zip")
	if e = downloadUpdate(ctx, client, asset, archive, 256<<20); e != nil {
		return e
	}
	f, e := os.Open(archive)
	if e != nil {
		return e
	}
	h := sha256.New()
	_, e = io.Copy(h, f)
	f.Close()
	if e != nil {
		return e
	}
	if hex.EncodeToString(h.Sum(nil)) != sum {
		return fmt.Errorf("업데이트 SHA256 검증 실패")
	}
	stage := filepath.Join(work, "stage")
	if e = os.Mkdir(stage, 0700); e != nil {
		return e
	}
	exe := updateExecutable(m.platform)
	if e = extractUpdate(archive, stage, exe, version); e != nil {
		return e
	}
	probeCtx, probeCancel := context.WithTimeout(ctx, 10*time.Second)
	probe := exec.CommandContext(probeCtx, filepath.Join(stage, exe), "--version")
	detachUpdateProcess(probe)
	output, probeErr := probe.Output()
	probeCancel()
	if probeErr != nil || strings.TrimSpace(string(output)) != version {
		return fmt.Errorf("업데이트 실행 파일의 플랫폼·버전을 확인하지 못했습니다: %v", probeErr)
	}
	token, e := randomSecret()
	if e != nil {
		return e
	}
	j := updateJournal{Version: version, Previous: Version, Executable: exe, Token: token, Phase: "prepared", Archive: "archive/update-" + Version + "-" + time.Now().UTC().Format("20060102T150405") + "-" + token[:8]}
	if e = writeJSON(filepath.Join(work, "journal.json"), j); e != nil {
		return e
	}
	helper := filepath.Join(work, "helper"+filepath.Ext(exe))
	self, e := os.Executable()
	if e != nil {
		return e
	}
	if e = copyUpdateTree(self, helper); e != nil {
		return e
	}
	cmd := exec.Command(helper, "--apply-update", m.root)
	detachUpdateProcess(cmd)
	log, e := os.OpenFile(filepath.Join(m.root, "data", "update.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	defer log.Close()
	cmd.Stdout = log
	cmd.Stderr = log
	if e = cmd.Start(); e != nil {
		return e
	}
	go cmd.Wait()
	handedOff = true
	return nil
}
