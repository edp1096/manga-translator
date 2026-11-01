package control

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type updateJournal struct {
	Version, Previous, Executable, Token, Phase, Archive string
	Entries                                              []migrationEntry
}

var updateProbeToken string

func SetUpdateProbeToken(token string) { updateProbeToken = token }
func sameUpdatePath(a, b string) bool {
	a = filepath.Clean(a)
	b = filepath.Clean(b)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}
func copyUpdateTree(source, dest string) error {
	st, e := os.Lstat(source)
	if e != nil {
		return e
	}
	if st.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("업데이트 대상에 심볼릭 링크가 있습니다: %s", source)
	}
	if st.IsDir() {
		if e = os.MkdirAll(dest, 0700); e != nil {
			return e
		}
		entries, e := os.ReadDir(source)
		if e != nil {
			return e
		}
		for _, entry := range entries {
			if e = copyUpdateTree(filepath.Join(source, entry.Name()), filepath.Join(dest, entry.Name())); e != nil {
				return e
			}
		}
		return nil
	}
	if !st.Mode().IsRegular() {
		return fmt.Errorf("업데이트 대상은 일반 파일이어야 합니다")
	}
	in, e := os.Open(source)
	if e != nil {
		return e
	}
	defer in.Close()
	if e = os.MkdirAll(filepath.Dir(dest), 0700); e != nil {
		return e
	}
	out, e := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, st.Mode().Perm())
	if e != nil {
		return e
	}
	_, e = io.Copy(out, in)
	if e == nil {
		e = out.Sync()
	}
	closeErr := out.Close()
	if e != nil {
		return e
	}
	return closeErr
}
func readUpdateJournal(root string) (updateJournal, error) {
	var j updateJournal
	p, e := safeDestination(root, ".app-update/journal.json")
	if e != nil {
		return j, e
	}
	raw, e := os.ReadFile(p)
	if e != nil {
		return j, e
	}
	if e = json.Unmarshal(raw, &j); e != nil {
		return j, e
	}
	if _, e = numericVersion(j.Version); e != nil {
		return j, e
	}
	if _, e = numericVersion(j.Previous); e != nil {
		return j, e
	}
	if j.Executable != updateExecutable(currentPlatform()) || len(j.Token) != 64 || !strings.HasPrefix(j.Archive, "archive/update-") || strings.Count(j.Archive, "/") != 1 || strings.ContainsAny(j.Archive, "\\:") {
		return j, fmt.Errorf("잘못된 업데이트 복구 기록")
	}
	switch j.Phase {
	case "prepared", "applying", "launching", "complete", "rolled-back":
	default:
		return j, fmt.Errorf("잘못된 업데이트 단계")
	}
	if token, err := hex.DecodeString(j.Token); err != nil || len(token) != 32 {
		return j, fmt.Errorf("잘못된 업데이트 토큰")
	}
	if (j.Phase == "applying" || j.Phase == "launching" || j.Phase == "complete") && len(j.Entries) != 5 {
		return j, fmt.Errorf("불완전한 업데이트 백업 기록")
	}
	seen := map[string]bool{}
	for _, v := range j.Entries {
		if seen[v.Path] {
			return j, fmt.Errorf("중복 복구 파일")
		}
		seen[v.Path] = true
		if v.Path != j.Executable && v.Path != "README.txt" && v.Path != "DOWNLOADS.json" && v.Path != "licenses" && v.Path != "extension" {
			return j, fmt.Errorf("잘못된 복구 파일")
		}
	}
	return j, nil
}
func saveUpdateJournal(root string, j updateJournal) error {
	return writeJSON(filepath.Join(root, ".app-update", "journal.json"), j)
}
func terminalUpdate(j updateJournal) bool { return j.Phase == "complete" || j.Phase == "rolled-back" }
func cleanFinishedUpdate(root string) error {
	j, e := readUpdateJournal(root)
	if os.IsNotExist(e) {
		work, err := safeDestination(root, ".app-update")
		if err != nil {
			return err
		}
		return os.RemoveAll(work)
	}
	if e != nil {
		return e
	}
	if !terminalUpdate(j) {
		return fmt.Errorf("완료되지 않은 업데이트 복구가 필요합니다")
	}
	return os.RemoveAll(filepath.Join(root, ".app-update"))
}

// Called before opening the app. After an interrupted replacement, use the
// unchanged helper so Windows never tries to overwrite its running executable.
func ResumeInterruptedUpdate(root, probe string) (bool, error) {
	// A fresh --root may not exist yet; Run creates it. Only inspect recovery
	// files after canonicalizing an existing root, not its outside ancestor.
	canonical, err := filepath.EvalSymlinks(root)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	root = canonical

	j, e := readUpdateJournal(root)
	if os.IsNotExist(e) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	if terminalUpdate(j) {
		return false, nil
	}
	if probe != "" && probe == j.Token && j.Phase == "launching" {
		return false, nil
	}
	helper := filepath.Join(root, ".app-update", "helper"+filepath.Ext(j.Executable))
	if absent(helper) && j.Phase == "prepared" {
		return false, os.RemoveAll(filepath.Join(root, ".app-update"))
	}
	cmd := exec.Command(helper, "--apply-update", root)
	detachUpdateProcess(cmd)
	if e = cmd.Start(); e != nil {
		return false, e
	}
	return true, cmd.Process.Release()
}
func waitUpdateLock(root string, timeout time.Duration) (func(), error) {
	deadline := time.Now().Add(timeout)
	for {
		unlock, e := lockRoot(root)
		if e == nil {
			return unlock, nil
		}
		if time.Now().After(deadline) {
			return nil, e
		}
		time.Sleep(100 * time.Millisecond)
	}
}
func backupUpdate(root string, j *updateJournal) error {
	backup, e := safeDestination(root, j.Archive)
	if e != nil {
		return e
	}
	// No files have been replaced in prepared phase. A partial backup can be
	// discarded and retried after interruption without touching user data.
	if e = os.RemoveAll(backup); e != nil {
		return e
	}
	if e = os.MkdirAll(backup, 0700); e != nil {
		return e
	}
	j.Entries = nil
	for _, name := range []string{j.Executable, "README.txt", "DOWNLOADS.json", "licenses", "extension"} {
		src, e := safeDestination(root, name)
		if e != nil {
			return e
		}
		had := !absent(src)
		j.Entries = append(j.Entries, migrationEntry{Path: name, HadOld: had})
		if had {
			if e = copyUpdateTree(src, filepath.Join(backup, name)); e != nil {
				return e
			}
		}
	}
	j.Phase = "applying"
	return saveUpdateJournal(root, *j)
}
func installUpdateFiles(root string, j updateJournal) error {
	for _, name := range []string{j.Executable, "README.txt", "DOWNLOADS.json", "licenses"} {
		dest, e := safeDestination(root, name)
		if e != nil {
			return e
		}
		source := filepath.Join(root, ".app-update", "stage", name)
		if absent(source) && name == "licenses" {
			continue
		}
		if e = os.RemoveAll(dest); e != nil {
			return e
		}
		if e = copyUpdateTree(source, dest); e != nil {
			return e
		}
	}
	return nil
}
func restoreUpdateFiles(root string, j updateJournal) error {
	for _, entry := range j.Entries {
		dest, e := safeDestination(root, entry.Path)
		if e != nil {
			return e
		}
		if e = os.RemoveAll(dest); e != nil {
			return e
		}
		if entry.HadOld {
			if e = copyUpdateTree(filepath.Join(root, j.Archive, entry.Path), dest); e != nil {
				return e
			}
		}
	}
	return nil
}
func launchUpdated(root string, j updateJournal, probe bool) (*exec.Cmd, error) {
	args := []string{"--root", root, "--no-open", "--no-auto-setup"}
	if probe {
		args = append(args, "--update-probe", j.Token)
	}
	cmd := exec.Command(filepath.Join(root, j.Executable), args...)
	cmd.Dir = root
	detachUpdateProcess(cmd)
	log, e := os.OpenFile(filepath.Join(root, "data", "update.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		return nil, e
	}
	defer log.Close()
	cmd.Stdout = log
	cmd.Stderr = log
	e = cmd.Start()
	return cmd, e
}
func waitUpdatedReady(root string, j updateJournal, child *exec.Cmd, timeout time.Duration) error {
	done := make(chan error, 1)
	go func() { done <- child.Wait() }()
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: time.Second}
	for time.Now().Before(deadline) {
		select {
		case e := <-done:
			return fmt.Errorf("새 앱이 준비 전에 종료됐습니다: %v", e)
		default:
		}
		res, e := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/update/health", ControlPort))
		if e == nil {
			var h struct{ Version, Root, Token string }
			e = json.NewDecoder(io.LimitReader(res.Body, 8192)).Decode(&h)
			res.Body.Close()
			if e == nil && h.Version == j.Version && sameUpdatePath(h.Root, root) && h.Token == j.Token {
				return nil
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	_ = child.Process.Kill()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
	}
	return fmt.Errorf("새 앱 기동 확인 시간 초과")
}
func RunUpdateHelper(root string) error {
	if !filepath.IsAbs(root) {
		return fmt.Errorf("잘못된 업데이트 폴더")
	}
	work, e := safeDestination(root, ".app-update")
	if e != nil {
		return e
	}
	if e = os.MkdirAll(filepath.Join(work, "data"), 0700); e != nil {
		return e
	}
	helperUnlock, e := lockRoot(work)
	if e != nil {
		return e
	}
	defer helperUnlock()
	unlock, e := waitUpdateLock(root, 60*time.Second)
	if e != nil {
		return e
	}
	locked := true
	defer func() {
		if locked {
			unlock()
		}
	}()
	time.Sleep(200 * time.Millisecond)
	j, e := readUpdateJournal(root)
	if e != nil {
		return e
	}
	if terminalUpdate(j) {
		return nil
	}
	rollback := func(cause error) error {
		if !locked {
			unlock, e = waitUpdateLock(root, 15*time.Second)
			if e != nil {
				return e
			}
			locked = true
		}
		if e = restoreUpdateFiles(root, j); e != nil {
			return fmt.Errorf("업데이트 실패(%v), 복구 실패: %w", cause, e)
		}
		j.Phase = "rolled-back"
		if e = saveUpdateJournal(root, j); e != nil {
			return e
		}
		_ = writeJSON(filepath.Join(root, "data", "update-result.json"), map[string]string{"status": "rolled-back", "version": j.Version, "message": "업데이트 실패로 이전 버전을 복구했습니다: " + cause.Error()})
		unlock()
		locked = false
		cmd, e := launchUpdated(root, j, false)
		if e == nil {
			_ = cmd.Process.Release()
		}
		return e
	}
	if j.Phase != "prepared" {
		return rollback(fmt.Errorf("중단된 업데이트 복구"))
	}
	if e = backupUpdate(root, &j); e != nil {
		j.Phase = "rolled-back"
		if saveErr := saveUpdateJournal(root, j); saveErr != nil {
			return saveErr
		}
		_ = writeJSON(filepath.Join(root, "data", "update-result.json"), map[string]string{"status": "rolled-back", "message": "백업 실패로 업데이트를 취소했습니다: " + e.Error()})
		unlock()
		locked = false
		cmd, startErr := launchUpdated(root, j, false)
		if startErr == nil {
			_ = cmd.Process.Release()
		}
		return startErr
	}
	if e = installUpdateFiles(root, j); e != nil {
		return rollback(e)
	}
	j.Phase = "launching"
	if e = saveUpdateJournal(root, j); e != nil {
		return rollback(e)
	}
	unlock()
	locked = false
	child, e := launchUpdated(root, j, true)
	if e != nil {
		return rollback(e)
	}
	if e = waitUpdatedReady(root, j, child, 60*time.Second); e != nil {
		return rollback(e)
	}
	j.Phase = "complete"
	if e = saveUpdateJournal(root, j); e != nil {
		_ = child.Process.Kill()
		return rollback(e)
	}
	_ = writeJSON(filepath.Join(root, "data", "update-result.json"), map[string]string{"status": "complete", "version": j.Version, "message": "업데이트 완료. 브라우저 확장 관리 화면에서 기존 확장을 새로고침하세요."})
	client := &http.Client{Timeout: 10 * time.Second}
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/api/update/activate", ControlPort), nil)
	req.Header.Set("Origin", fmt.Sprintf("http://127.0.0.1:%d", ControlPort))
	req.Header.Set("X-Manga-Control", "1")
	req.Header.Set("X-Manga-Update", j.Token)
	if res, err := client.Do(req); err == nil {
		res.Body.Close()
	}
	return nil
}
