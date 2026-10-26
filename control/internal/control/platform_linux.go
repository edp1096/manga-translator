//go:build linux

package control

import (
	"context"
	"fmt"
	"golang.org/x/sys/unix"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type processResource struct{}

func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
}
func attachProcess(cmd *exec.Cmd) (processResource, error) {
	// Leave placement to the OS scheduler. CPU topology informs the default
	// thread count; a generic ARM core count must never imply particular CPU IDs.
	return processResource{}, nil
}

func releaseProcess(processResource) {}
func stopProcess(cmd *exec.Cmd, _ processResource, done <-chan struct{}) {
	select {
	case <-done:
		return
	default:
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	select {
	case <-done:
		return
	case <-time.After(15 * time.Second):
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
	}
}
func processEnvironment(root string, libraryDirs []string) []string {
	values := portableEnvironment(root)
	values["XDG_CACHE_HOME"] = filepath.Join(root, "data", "cache")
	values["TMPDIR"] = filepath.Join(root, "data", "tmp")
	values["LD_LIBRARY_PATH"] = strings.Join(libraryDirs, ":")
	return replaceEnvironment(os.Environ(), values)
}

func systemInfo(root string) SystemInfo {
	s := SystemInfo{CPUs: detectedCPU().Logical}
	if raw, e := os.ReadFile("/proc/meminfo"); e == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			n, _ := strconv.ParseInt(fields[1], 10, 64)
			switch fields[0] {
			case "MemTotal:":
				s.MemoryTotal = n * 1024
			case "MemAvailable:":
				s.MemoryAvailable = n * 1024
			}
		}
	}
	var st unix.Statfs_t
	if unix.Statfs(root, &st) == nil {
		s.DiskFree = int64(st.Bavail) * st.Bsize
	}
	return s
}
func processRSS(pid int) int64 {
	raw, e := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if e != nil {
		return 0
	}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		if len(fields) > 1 && fields[0] == "VmRSS:" {
			n, _ := strconv.ParseInt(fields[1], 10, 64)
			return n * 1024
		}
	}
	return 0
}
func ensurePrerequisites(context.Context, string, []OutputFile) error { return nil }
func OpenURL(url string) error {
	if profile := os.Getenv("MANGA_CHROME_PROFILE"); profile != "" {
		for _, name := range []string{"google-chrome", "chromium", "chromium-browser"} {
			if executable, e := exec.LookPath(name); e == nil {
				return openProcess(exec.Command(executable, "--user-data-dir="+profile, url))
			}
		}
	}
	return openProcess(exec.Command("xdg-open", url))
}
func openFolder(path string) error { return openProcess(exec.Command("xdg-open", path)) }
func openChrome(root string) error {
	for _, name := range []string{"google-chrome", "chromium", "chromium-browser"} {
		if executable, e := exec.LookPath(name); e == nil {
			args := []string{"--new-tab", "chrome://extensions/"}
			if profile := os.Getenv("MANGA_CHROME_PROFILE"); profile != "" {
				args = append([]string{"--user-data-dir=" + profile}, args...)
			}
			return openProcess(exec.Command(executable, args...))
		}
	}
	return fmt.Errorf("Chrome을 찾지 못했습니다. 주소창에 chrome://extensions 를 입력하세요")
}
func lockRoot(root string) (func(), error) {
	f, e := os.OpenFile(filepath.Join(root, "data", "control.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); e != nil {
		f.Close()
		return nil, fmt.Errorf("이 폴더의 관리 앱이 이미 실행 중입니다")
	}
	return func() { unix.Flock(int(f.Fd()), unix.LOCK_UN); f.Close() }, nil
}

func ShowError(string) {}
