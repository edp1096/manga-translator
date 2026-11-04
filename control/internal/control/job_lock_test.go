package control

import (
	"bufio"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestJobLeaseSharedExclusive(t *testing.T) {
	root := t.TempDir()
	id := fixtureJob(t, root, 1, false)
	first, e := jobLease(root, id, false)
	if e != nil {
		t.Fatal(e)
	}
	second, e := jobLease(root, id, false)
	if e != nil {
		t.Fatal(e)
	}
	if release, e := jobLease(root, id, true); e == nil {
		release()
		t.Fatal("exclusive acquired while reading")
	}
	first()
	second()
	exclusive, e := jobLease(root, id, true)
	if e != nil {
		t.Fatal(e)
	}
	if release, e := jobLease(root, id, false); e == nil {
		release()
		t.Fatal("reader acquired during deletion")
	}
	exclusive()
}
func TestJobDeletionWithRunningEngine(t *testing.T) {
	root := t.TempDir()
	a := fixtureJob(t, root, 1, false)
	b := fixtureJob(t, root, 2, false)
	listener, e := net.Listen("tcp", "127.0.0.1:8793")
	if e != nil {
		t.Skip("vision port already in use")
	}
	version := 1
	store := filepath.Join(root, "data/native_api/jobs")
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"jobLocksVersion": version, "jobStore": store})
	})}
	go server.Serve(listener)
	defer server.Close()
	m := &Manager{root: root, processes: map[string]*managedProcess{"vision": {}}}
	busy, e := jobLease(root, a, false)
	if e != nil {
		t.Fatal(e)
	}
	if deleted, e := m.DeleteJobs([]string{b, a}, false); e == nil || len(deleted) != 0 {
		t.Fatal("busy batch partially deleted", deleted, e)
	}
	if _, e := readJobInfo(root, b); e != nil {
		t.Fatal(e)
	}
	if e := m.KeepJobs([]string{a}, true); e == nil {
		t.Fatal("changed active job")
	}
	if e := m.KeepJobs([]string{b}, true); e != nil {
		t.Fatal(e)
	}
	if _, e := m.DeleteJobs([]string{b}, false); e == nil {
		t.Fatal("deleted kept job")
	}
	if e := m.KeepJobs([]string{b}, false); e != nil {
		t.Fatal(e)
	}
	if deleted, e := m.DeleteJobs([]string{b}, false); e != nil || len(deleted) != 1 {
		t.Fatal("unrelated job blocked", deleted, e)
	}
	busy()
	version = 0
	if _, e := m.DeleteJobs([]string{a}, false); e == nil {
		t.Fatal("old engine accepted")
	}
	version = 1
	store = t.TempDir()
	if _, e := m.DeleteJobs([]string{a}, false); e == nil {
		t.Fatal("foreign engine accepted")
	}
	store = filepath.Join(root, "data/native_api/jobs")
	if deleted, e := m.DeleteJobs([]string{a}, false); e != nil || len(deleted) != 1 {
		t.Fatal(deleted, e)
	}
	if _, e := jobLease(root, a, false); e == nil {
		t.Fatal("deleted job reopened")
	}
	if _, e := os.Stat(filepath.Join(root, "data/native_api/job-locks", a+".lock")); e != nil {
		t.Fatal("lock identity removed", e)
	}
}

// Runs the native lock implementation against the controller's OS locks.
// The helper is compiled from tests/native_job_lock.cpp on each target platform.
func TestJobLeaseNativeInterop(t *testing.T) {
	helper := os.Getenv("MANGA_JOB_LOCK_HELPER")
	if helper == "" {
		t.Skip("native lock helper not supplied")
	}
	root := t.TempDir()
	id := fixtureJob(t, root, 1, false)
	for _, mode := range []string{"shared", "exclusive"} {
		cmd := exec.Command(helper, filepath.Join(root, "data/native_api/jobs"), id, mode)
		input, e := cmd.StdinPipe()
		if e != nil {
			t.Fatal(e)
		}
		output, e := cmd.StdoutPipe()
		if e != nil {
			t.Fatal(e)
		}
		if e = cmd.Start(); e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { cmd.Process.Kill() })
		reader := bufio.NewReader(output)
		line, e := reader.ReadString('\n')
		if e != nil || strings.TrimSpace(line) != "locked" {
			t.Fatal(line, e)
		}
		if release, e := jobLease(root, id, true); e == nil {
			release()
			t.Fatal("Go exclusive ignored C++ lock")
		}
		release, e := jobLease(root, id, false)
		if mode == "shared" {
			if e != nil {
				t.Fatal(e)
			}
			release()
		} else if e == nil {
			release()
			t.Fatal("Go reader ignored C++ exclusive")
		}
		input.Close()
		if e := cmd.Wait(); e != nil {
			t.Fatal(e)
		}
		release, e = jobLease(root, id, true)
		if e != nil {
			t.Fatal("native handle leaked", e)
		}
		release()
	}
	release, e := jobLease(root, id, true)
	if e != nil {
		t.Fatal(e)
	}
	defer release()
	cmd := exec.Command(helper, filepath.Join(root, "data/native_api/jobs"), id, "shared")
	if e := cmd.Run(); e == nil {
		t.Fatal("C++ ignored Go exclusive lock")
	}
}
