package control

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Only persistent user assets move between releases. Executables, extension
// code, caches, process locks and logs always belong to the new installation.
var migrationPaths = []string{"config", "models", "runtime", "data/api-key", "data/native_api", "data/install-state.json", "data/downloads"}

const migrationDir = ".data-import"

type migrationEntry struct {
	Path   string
	HadOld bool
}
type migrationJournal struct {
	Version   int
	Committed bool
	Entries   []migrationEntry
}
type migrationFile struct {
	relative string
	size     int64
	mode     fs.FileMode
	modified time.Time
}

type MigrationReport struct {
	Source    string    `json:"source"`
	Files     int       `json:"files"`
	Bytes     int64     `json:"bytes"`
	Completed time.Time `json:"completed"`
}

func migrationPathAllowed(p string) bool {
	for _, v := range migrationPaths {
		if p == v {
			return true
		}
	}
	return false
}
func absent(path string) bool { _, e := os.Lstat(path); return os.IsNotExist(e) }
func nestedPath(parent, child string) bool {
	rel, e := filepath.Rel(parent, child)
	return e == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// A journal is written BEFORE each rename. On interruption, backup presence
// distinguishes an old destination from an imported destination. Rollback is
// repeatable, including if recovery itself is interrupted.
func recoverMigration(root string) error {
	work := filepath.Join(root, migrationDir)
	if absent(work) {
		return nil
	}
	if e := migrationParents(root); e != nil {
		return e
	}
	if st, e := os.Lstat(work); e != nil || !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("잘못된 데이터 이전 작업 폴더")
	}
	raw, e := os.ReadFile(filepath.Join(work, "journal.json"))
	if os.IsNotExist(e) {
		files, readErr := os.ReadDir(work)
		if readErr != nil {
			return readErr
		}
		if len(files) == 0 {
			return os.Remove(work)
		}
		return fmt.Errorf("데이터 이전 복구 기록이 없습니다: %s", work)
	}
	if e != nil {
		return e
	}
	var j migrationJournal
	if json.Unmarshal(raw, &j) != nil || j.Version != 1 {
		return fmt.Errorf("데이터 이전 복구 기록이 올바르지 않습니다: %s", work)
	}
	seen := map[string]bool{}
	for _, v := range j.Entries {
		if !migrationPathAllowed(v.Path) || seen[v.Path] {
			return fmt.Errorf("잘못된 데이터 이전 경로")
		}
		seen[v.Path] = true
	}
	if !j.Committed {
		for i := len(j.Entries) - 1; i >= 0; i-- {
			v := j.Entries[i]
			dst := filepath.Join(root, filepath.FromSlash(v.Path))
			backup := filepath.Join(work, "backup", filepath.FromSlash(v.Path))
			if !absent(backup) {
				if e = os.RemoveAll(dst); e != nil {
					return e
				}
				if e = os.Rename(backup, dst); e != nil {
					return e
				}
			} else if !v.HadOld {
				if e = os.RemoveAll(dst); e != nil {
					return e
				}
			}
		}
	}
	return os.RemoveAll(work)
}

func migrationParents(root string) error {
	for _, p := range []string{"data", "config", "models", "runtime"} {
		st, e := os.Lstat(filepath.Join(root, p))
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			return e
		}
		if !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("링크 또는 잘못된 데이터 폴더: %s", p)
		}
	}
	return nil
}

func migrationSource(root, source string) (string, error) {
	if !filepath.IsAbs(source) {
		return "", fmt.Errorf("이전 버전 폴더의 절대 경로를 입력하세요")
	}
	source, e := filepath.EvalSymlinks(filepath.Clean(source))
	if e != nil {
		return "", e
	}
	if nestedPath(root, source) || nestedPath(source, root) {
		return "", fmt.Errorf("서로 분리된 이전·새 버전 폴더를 선택하세요")
	}
	if e = migrationParents(source); e != nil {
		return "", e
	}
	if !absent(filepath.Join(source, migrationDir)) {
		return "", fmt.Errorf("이전 폴더에 미완료 데이터 이전이 있습니다. 이전 앱을 먼저 실행해 복구하세요")
	}
	for _, p := range []string{"config/control.json", "data/api-key", "data/native_api/access-token"} {
		st, e := os.Lstat(filepath.Join(source, filepath.FromSlash(p)))
		if e != nil || !st.Mode().IsRegular() {
			return "", fmt.Errorf("이전 앱의 %s 파일을 찾지 못했습니다", p)
		}
	}
	return source, nil
}

func freshMigrationDestination(root string) error {
	if e := migrationParents(root); e != nil {
		return e
	}
	// The current manager may already have generated credentials and defaults.
	// All meaningful existing data must be absent rather than silently merged.
	allowed := map[string]bool{"config/control.json": true, "data/api-key": true, "data/native_api/access-token": true}
	for _, p := range migrationPaths {
		base := filepath.Join(root, filepath.FromSlash(p))
		if absent(base) {
			continue
		}
		e := filepath.WalkDir(base, func(path string, d fs.DirEntry, e error) error {
			if e != nil {
				return e
			}
			if d.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("링크된 대상 경로는 가져올 수 없습니다")
			}
			if d.IsDir() {
				return nil
			}
			rel, _ := filepath.Rel(root, path)
			if !allowed[filepath.ToSlash(rel)] {
				return fmt.Errorf("새 폴더에 이미 데이터가 있습니다. 새 배포본을 별도 폴더에 풀어 실행하세요: %s", rel)
			}
			return nil
		})
		if e != nil {
			return e
		}
	}
	return nil
}

func scanMigration(source string) ([]migrationFile, []string, int64, error) {
	var files []migrationFile
	var paths []string
	var total int64
	for _, p := range migrationPaths {
		base := filepath.Join(source, filepath.FromSlash(p))
		if absent(base) {
			continue
		}
		paths = append(paths, p)
		e := filepath.WalkDir(base, func(path string, d fs.DirEntry, e error) error {
			if e != nil {
				return e
			}
			info, e := d.Info()
			if e != nil {
				return e
			}
			if info.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("심볼릭 링크·정션은 이전하지 않습니다: %s", path)
			}
			if info.IsDir() {
				return nil
			}
			if !info.Mode().IsRegular() {
				return fmt.Errorf("일반 파일이 아닌 경로: %s", path)
			}
			rel, e := filepath.Rel(source, path)
			if e != nil {
				return e
			}
			total += info.Size()
			if total < 0 {
				return fmt.Errorf("데이터 크기가 너무 큽니다")
			}
			files = append(files, migrationFile{rel, info.Size(), info.Mode(), info.ModTime()})
			return nil
		})
		if e != nil {
			return nil, nil, 0, e
		}
	}
	return files, paths, total, nil
}

type migrationReader struct {
	ctx      context.Context
	r        io.Reader
	progress func(int64)
}

func (r migrationReader) Read(p []byte) (int, error) {
	if e := r.ctx.Err(); e != nil {
		return 0, e
	}
	n, e := r.r.Read(p)
	if n > 0 && r.progress != nil {
		r.progress(int64(n))
	}
	return n, e
}
func copyMigrationFile(ctx context.Context, source, dest string, f migrationFile, progress func(int64)) error {
	in, e := os.Open(source)
	if e != nil {
		return e
	}
	defer in.Close()
	if e = os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
		return e
	}
	out, e := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	hash := sha256.New()
	n, e := io.Copy(io.MultiWriter(out, hash), migrationReader{ctx, in, progress})
	if e == nil {
		e = out.Sync()
	}
	closeErr := out.Close()
	if e == nil {
		e = closeErr
	}
	if e != nil {
		return e
	}
	st, e := in.Stat()
	if e != nil {
		return e
	}
	if n != f.size || st.Size() != f.size || !st.ModTime().Equal(f.modified) {
		return fmt.Errorf("복사 중 원본이 변경됐습니다: %s", f.relative)
	}
	check, e := os.Open(dest)
	if e != nil {
		return e
	}
	copied := sha256.New()
	_, e = io.Copy(copied, migrationReader{ctx, check, nil})
	check.Close()
	if e != nil {
		return e
	}
	if !strings.EqualFold(fmt.Sprintf("%x", hash.Sum(nil)), fmt.Sprintf("%x", copied.Sum(nil))) {
		return fmt.Errorf("복사 검증 실패: %s", f.relative)
	}
	// Keep executable bits for Linux runtimes, and keep keys/data private.
	if e = os.Chmod(dest, 0600|(f.mode.Perm()&0111)); e != nil {
		return e
	}
	return os.Chtimes(dest, f.modified, f.modified)
}

func importData(ctx context.Context, root, source string, progress func(Progress)) (report MigrationReport, err error) {
	source, err = migrationSource(root, source)
	if err != nil {
		return
	}
	if err = freshMigrationDestination(root); err != nil {
		return
	}
	// Old applications use the same root lock. Never copy an actively written
	// installation, even if it is not the controller at the usual port.
	unlock, e := lockRoot(source)
	if e != nil {
		err = e
		return
	}
	defer unlock()
	files, paths, total, e := scanMigration(source)
	if e != nil {
		err = e
		return
	}
	raw, e := os.ReadFile(filepath.Join(source, "config", "control.json"))
	var settings Settings
	if e != nil || json.Unmarshal(raw, &settings) != nil {
		err = fmt.Errorf("이전 버전 설정 파일이 올바르지 않습니다")
		return
	}
	for _, key := range []string{"data/api-key", "data/native_api/access-token"} {
		b, e := os.ReadFile(filepath.Join(source, filepath.FromSlash(key)))
		if e != nil || len(strings.TrimSpace(string(b))) < 32 {
			err = fmt.Errorf("이전 버전 인증키가 올바르지 않습니다")
			return
		}
	}
	if available := systemInfo(root).DiskFree; available > 0 && total > available-64*1024*1024 {
		err = fmt.Errorf("이전에 필요한 여유 공간이 부족합니다 (%d 바이트 필요)", total)
		return
	}
	work := filepath.Join(root, migrationDir)
	if err = os.Mkdir(work, 0700); err != nil {
		return
	}
	defer func() {
		if err != nil {
			if recovery := recoverMigration(root); recovery != nil {
				err = errors.Join(err, recovery)
			}
		}
	}()
	if err = writeJSON(filepath.Join(work, "journal.json"), migrationJournal{Version: 1}); err != nil {
		return
	}
	state := Progress{Stage: "importing", Total: total, Count: len(files)}
	// Empty directories (including empty job/download trees) must survive too.
	for _, p := range paths {
		st, e := os.Stat(filepath.Join(source, filepath.FromSlash(p)))
		if e != nil {
			err = e
			return
		}
		if st.IsDir() {
			if err = os.MkdirAll(filepath.Join(work, "staged", filepath.FromSlash(p)), 0700); err != nil {
				return
			}
		}
	}
	for _, f := range files {
		state.Name = filepath.ToSlash(f.relative)
		err = copyMigrationFile(ctx, filepath.Join(source, f.relative), filepath.Join(work, "staged", f.relative), f, func(n int64) {
			state.Bytes += n
			if progress != nil {
				progress(state)
			}
		})
		if err != nil {
			return
		}
		state.Completed++
		if progress != nil {
			progress(state)
		}
	}
	if err = ctx.Err(); err != nil {
		return
	}
	j := migrationJournal{Version: 1}
	for _, p := range paths {
		dst := filepath.Join(root, filepath.FromSlash(p))
		backup := filepath.Join(work, "backup", filepath.FromSlash(p))
		j.Entries = append(j.Entries, migrationEntry{p, !absent(dst)})
		if err = writeJSON(filepath.Join(work, "journal.json"), j); err != nil {
			return
		}
		if err = os.MkdirAll(filepath.Dir(dst), 0700); err != nil {
			return
		}
		if j.Entries[len(j.Entries)-1].HadOld {
			if err = os.MkdirAll(filepath.Dir(backup), 0700); err != nil {
				return
			}
			if err = os.Rename(dst, backup); err != nil {
				return
			}
		}
		if err = os.Rename(filepath.Join(work, "staged", filepath.FromSlash(p)), dst); err != nil {
			return
		}
	}
	j.Committed = true
	if err = writeJSON(filepath.Join(work, "journal.json"), j); err != nil {
		return
	}
	report = MigrationReport{source, len(files), total, time.Now()}
	// A committed journal is also a durable success marker until cleanup. A
	// cleanup failure must never roll back a successfully imported installation.
	_ = writeJSON(filepath.Join(root, "data", "migration-last.json"), report)
	_ = recoverMigration(root)
	return
}

func (m *Manager) ImportData(source string) error {
	m.mu.Lock()
	if m.busy || len(m.processes) > 0 || m.settings.Model != "" || m.settings.Layout != "" || m.settings.OCR != "" {
		m.mu.Unlock()
		return fmt.Errorf("API를 종료하고 모델을 선택하지 않은 새 버전 폴더에서 가져오세요")
	}
	m.busy = true
	m.phase = "importing"
	m.lastError = ""
	m.progress = Progress{Stage: "importing"}
	ctx, cancel := context.WithCancel(m.ctx)
	m.cancel = cancel
	m.mu.Unlock()
	go func() {
		m.operation.Lock()
		defer m.operation.Unlock()
		defer cancel()
		// An independently launched API must also be stopped before credentials or
		// results change. A listening port is enough; don't assume auth succeeds.
		var err error
		for _, port := range []int{VisionPort, LLMPort} {
			c, e := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 300*time.Millisecond)
			if e == nil {
				c.Close()
				err = fmt.Errorf("이전 버전의 API를 완전히 종료한 뒤 가져오세요")
				break
			}
		}
		if err == nil {
			_, err = importData(ctx, m.root, strings.TrimSpace(source), func(p Progress) { m.mu.Lock(); m.progress = p; m.mu.Unlock() })
		}
		var settings Settings
		receipts := map[string]Receipt{}
		if err == nil {
			raw, e := os.ReadFile(filepath.Join(m.root, "config", "control.json"))
			if e != nil {
				err = e
			} else {
				err = json.Unmarshal(raw, &settings)
			}
			if settings.ThreadsAuto || settings.Threads < 1 || settings.Threads > detectedCPU().Logical {
				settings.Threads = detectedCPU().RecommendedThreads
				settings.ThreadsAuto = true
			}
			if b, e := os.ReadFile(filepath.Join(m.root, "data", "install-state.json")); e == nil {
				_ = json.Unmarshal(b, &receipts)
			}
		}
		m.mu.Lock()
		m.busy = false
		m.cancel = nil
		if err != nil {
			m.phase = "error"
			m.lastError = err.Error()
		} else {
			m.settings = settings
			m.receipts = receipts
			m.pairCodes = map[string]time.Time{}
			m.phase = "imported"
			m.progress.Stage = "imported"
		}
		m.mu.Unlock()
	}()
	return nil
}
