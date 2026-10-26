package control

import "os/exec"

type SystemInfo struct {
	MemoryTotal     int64 `json:"memoryTotal"`
	MemoryAvailable int64 `json:"memoryAvailable"`
	DiskFree        int64 `json:"diskFree"`
	CPUs            int   `json:"cpus"`
}

func openProcess(cmd *exec.Cmd) error {
	if e := cmd.Start(); e != nil {
		return e
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
