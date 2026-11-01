//go:build windows

package control

import (
	"golang.org/x/sys/windows"
	"os/exec"
	"syscall"
)

func detachUpdateProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_NO_WINDOW, HideWindow: true}
}
