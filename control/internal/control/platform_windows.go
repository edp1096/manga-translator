//go:build windows

package control

import (
	"context"
	"fmt"
	"golang.org/x/sys/windows"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

type processResource struct{ job windows.Handle }

func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_NO_WINDOW, HideWindow: true}
}
func attachProcess(cmd *exec.Cmd) (processResource, error) {
	job, e := windows.CreateJobObject(nil, nil)
	if e != nil {
		return processResource{}, e
	}
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, e = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); e != nil {
		windows.CloseHandle(job)
		return processResource{}, e
	}
	p, e := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if e != nil {
		windows.CloseHandle(job)
		return processResource{}, e
	}
	defer windows.CloseHandle(p)
	if e = windows.AssignProcessToJobObject(job, p); e != nil {
		windows.CloseHandle(job)
		return processResource{}, e
	}
	return processResource{job}, nil
}
func releaseProcess(r processResource) {
	if r.job != 0 {
		windows.CloseHandle(r.job)
	}
}
func stopProcess(cmd *exec.Cmd, r processResource, done <-chan struct{}) {
	select {
	case <-done:
		return
	case <-time.After(2 * time.Second):
	}
	if r.job != 0 {
		_ = windows.TerminateJobObject(r.job, 0)
	} else {
		_ = cmd.Process.Kill()
	}
	select {
	case <-done:
	case <-time.After(10 * time.Second):
	}
}
func processEnvironment(root string, libraryDirs []string) []string {
	values := portableEnvironment(root)
	values["TEMP"] = filepath.Join(root, "data", "tmp")
	values["TMP"] = filepath.Join(root, "data", "tmp")
	values["PATH"] = strings.Join(append(libraryDirs, os.Getenv("PATH")), ";")
	return replaceEnvironment(os.Environ(), values)
}

type memoryStatus struct {
	Length        uint32
	Load          uint32
	TotalPhys     uint64
	AvailPhys     uint64
	TotalPage     uint64
	AvailPage     uint64
	TotalVirtual  uint64
	AvailVirtual  uint64
	AvailExtended uint64
}

var memoryStatusProc = windows.NewLazySystemDLL("kernel32.dll").NewProc("GlobalMemoryStatusEx")
var processMemoryProc = windows.NewLazySystemDLL("psapi.dll").NewProc("GetProcessMemoryInfo")

func systemInfo(root string) SystemInfo {
	s := SystemInfo{CPUs: detectedCPU().Logical}
	memory := memoryStatus{}
	memory.Length = uint32(unsafe.Sizeof(memory))
	if ok, _, _ := memoryStatusProc.Call(uintptr(unsafe.Pointer(&memory))); ok != 0 {
		s.MemoryTotal = int64(memory.TotalPhys)
		s.MemoryAvailable = int64(memory.AvailPhys)
	}
	path, _ := windows.UTF16PtrFromString(root)
	var free, total, allFree uint64
	if windows.GetDiskFreeSpaceEx(path, &free, &total, &allFree) == nil {
		s.DiskFree = int64(free)
	}
	return s
}

type processMemory struct {
	Size           uint32
	Faults         uint32
	PeakWorkingSet uintptr
	WorkingSet     uintptr
	PeakPaged      uintptr
	Paged          uintptr
	PeakNonPaged   uintptr
	NonPaged       uintptr
	Pagefile       uintptr
	PeakPagefile   uintptr
	Private        uintptr
}

func processRSS(pid int) int64 {
	h, e := windows.OpenProcess(windows.PROCESS_QUERY_INFORMATION|windows.PROCESS_VM_READ, false, uint32(pid))
	if e != nil {
		return 0
	}
	defer windows.CloseHandle(h)
	p := processMemory{}
	p.Size = uint32(unsafe.Sizeof(p))
	ok, _, _ := processMemoryProc.Call(uintptr(h), uintptr(unsafe.Pointer(&p)), uintptr(p.Size))
	if ok == 0 {
		return 0
	}
	return int64(p.WorkingSet)
}

func ensurePrerequisites(ctx context.Context, root string, files []OutputFile) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	for _, file := range files {
		target, err := safeDestination(root, file.Path)
		if err != nil {
			return err
		}
		if st, err := os.Stat(target); err != nil || !st.Mode().IsRegular() || st.Size() != file.Size {
			return fmt.Errorf("앱 폴더 안의 Visual C++ 런타임을 먼저 준비하세요: %s", file.Path)
		}
	}
	return nil
}

func OpenURL(url string) error {
	for _, base := range []string{os.Getenv("PROGRAMFILES"), os.Getenv("PROGRAMFILES(X86)"), os.Getenv("LOCALAPPDATA")} {
		p := filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe")
		if _, e := os.Stat(p); e == nil {
			cmd := exec.Command(p, "--new-tab", url)
			return openProcess(cmd)
		}
	}
	return shellOpen(url)
}
func openFolder(path string) error { return shellOpen(path) }
func shellOpen(target string) error {
	verb, _ := windows.UTF16PtrFromString("open")
	file, _ := windows.UTF16PtrFromString(target)
	return windows.ShellExecute(0, verb, file, nil, nil, windows.SW_SHOWNORMAL)
}
func openChrome(root string) error {
	for _, base := range []string{os.Getenv("PROGRAMFILES"), os.Getenv("PROGRAMFILES(X86)"), os.Getenv("LOCALAPPDATA")} {
		p := filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe")
		if _, e := os.Stat(p); e == nil {
			cmd := exec.Command(p, "--new-tab", "chrome://extensions/")
			return openProcess(cmd)
		}
	}
	return fmt.Errorf("Chrome을 찾지 못했습니다. Chrome 주소창에 chrome://extensions 를 입력하세요")
}
func lockRoot(root string) (func(), error) {
	f, e := os.OpenFile(filepath.Join(root, "data", "control.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	overlapped := &windows.Overlapped{}
	if e = windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, overlapped); e != nil {
		f.Close()
		return nil, fmt.Errorf("이 폴더의 관리 앱이 이미 실행 중입니다")
	}
	return func() { windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, overlapped); f.Close() }, nil
}

func ShowError(message string) {
	text, _ := windows.UTF16PtrFromString(message)
	title, _ := windows.UTF16PtrFromString("Manga Translator")
	windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x10)
}
