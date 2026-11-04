package control

import (
	"golang.org/x/sys/unix"
	"os"
)

func lockJobFile(path string, exclusive bool) (func(), error) {
	fd, e := unix.Open(path, unix.O_CREAT|unix.O_RDWR|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0600)
	if e != nil {
		return nil, e
	}
	f := os.NewFile(uintptr(fd), path)
	flags := unix.LOCK_SH | unix.LOCK_NB
	if exclusive {
		flags = unix.LOCK_EX | unix.LOCK_NB
	}
	if e = unix.Flock(fd, flags); e != nil {
		f.Close()
		return nil, e
	}
	return func() { unix.Flock(fd, unix.LOCK_UN); f.Close() }, nil
}
