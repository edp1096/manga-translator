//go:build linux

package control

import (
	"os/exec"
	"syscall"
)

// Updater and replacement controller must survive the original parent exit.
func detachUpdateProcess(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }
