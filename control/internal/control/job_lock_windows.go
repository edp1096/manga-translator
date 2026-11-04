package control

import (
	"golang.org/x/sys/windows"
	"os"
)

func lockJobFile(path string, exclusive bool) (func(), error) {
	f, e := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	ov := &windows.Overlapped{}
	flags := uint32(windows.LOCKFILE_FAIL_IMMEDIATELY)
	if exclusive {
		flags |= windows.LOCKFILE_EXCLUSIVE_LOCK
	}
	if e = windows.LockFileEx(windows.Handle(f.Fd()), flags, 0, 1, 0, ov); e != nil {
		f.Close()
		return nil, e
	}
	return func() { windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, ov); f.Close() }, nil
}
