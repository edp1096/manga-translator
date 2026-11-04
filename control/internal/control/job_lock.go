package control

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Lock files live outside job directories and are never removed: replacing a
// lock inode would allow two processes to acquire different locks for one job.
func jobLease(root, id string, exclusive bool) (func(), error) {
	p, e := jobPath(root, id)
	if e != nil {
		return nil, e
	}
	if st, e := os.Stat(p); e != nil || !st.IsDir() {
		return nil, fmt.Errorf("작업을 찾을 수 없습니다: %s", id)
	}
	lockPath, e := safeDestination(root, "data/native_api/job-locks/"+id+".lock")
	if e != nil {
		return nil, e
	}
	if e = os.MkdirAll(filepath.Dir(lockPath), 0700); e != nil {
		return nil, e
	}
	release, e := lockJobFile(lockPath, exclusive)
	if e != nil {
		return nil, fmt.Errorf("사용 중인 작업은 변경할 수 없습니다. 번역·복원·저장이 끝난 뒤 다시 시도하세요 (%s): %w", id, e)
	}
	if st, e := os.Stat(p); e != nil || !st.IsDir() {
		release()
		return nil, fmt.Errorf("작업이 이미 삭제되었습니다: %s", id)
	}
	return release, nil
}
func leaseJobs(root string, ids []string) (func(), error) {
	releases := []func(){}
	release := func() {
		for i := len(releases) - 1; i >= 0; i-- {
			releases[i]()
		}
	}
	for _, id := range ids {
		r, e := jobLease(root, id, true)
		if e != nil {
			release()
			return nil, e
		}
		releases = append(releases, r)
	}
	return release, nil
}

func (m *Manager) jobDataMaintenance() (func(), error) {
	m.mu.Lock()
	if m.busy || m.updatePending {
		m.mu.Unlock()
		return nil, fmt.Errorf("앱 시작·종료 또는 업데이트가 끝난 뒤 다시 시도하세요")
	}
	hasProcesses := len(m.processes) > 0
	m.busy = true
	m.mu.Unlock()
	m.operation.Lock()
	release := func() { m.operation.Unlock(); m.mu.Lock(); m.busy = false; m.mu.Unlock() }
	client := &http.Client{Timeout: 2 * time.Second}
	response, e := client.Get(fmt.Sprintf("http://127.0.0.1:%d/health", VisionPort))
	if e != nil {
		// A managed process may be starting or stopping: never treat this as offline.
		connection, dialError := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", VisionPort), 200*time.Millisecond)
		if dialError == nil {
			connection.Close()
		}
		if hasProcesses || dialError == nil {
			release()
			return nil, fmt.Errorf("API 상태를 확인하지 못했습니다. 시작·종료가 끝난 뒤 다시 시도하세요")
		}
		return release, nil
	}
	defer response.Body.Close()
	var health struct {
		JobLocksVersion int    `json:"jobLocksVersion"`
		JobStore        string `json:"jobStore"`
	}
	e = json.NewDecoder(response.Body).Decode(&health)
	expected := filepath.Clean(filepath.Join(m.root, "data/native_api/jobs"))
	actual := filepath.Clean(health.JobStore)
	same := actual == expected
	if runtime.GOOS == "windows" {
		same = strings.EqualFold(actual, expected)
	}
	if e != nil || response.StatusCode != 200 || health.JobLocksVersion != 1 || !same {
		release()
		return nil, fmt.Errorf("실행 중인 API가 작업별 삭제 보호를 지원하지 않거나 다른 폴더의 API입니다. API를 중지하거나 업데이트 후 재시작하세요")
	}
	return release, nil
}
