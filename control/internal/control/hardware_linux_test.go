//go:build linux

package control

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestARMRepeatedCoreIDsAcrossClusters(t *testing.T) {
	root := t.TempDir()
	var ids []int
	for i := 0; i < 8; i++ {
		ids = append(ids, i)
		dir := filepath.Join(root, fmt.Sprintf("cpu%d", i))
		if err := os.MkdirAll(filepath.Join(dir, "topology"), 0700); err != nil {
			t.Fatal(err)
		}
		capacity := "397"
		if i >= 4 {
			capacity = "1024"
		}
		for name, value := range map[string]string{"topology/core_id": fmt.Sprint(i % 2), "topology/physical_package_id": "0", "topology/thread_siblings_list": fmt.Sprint(i), "cpu_capacity": capacity} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte(value), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	c := linuxCPUFrom(root, filepath.Join(root, "missing-cpuinfo"), ids, 0)
	if c.Logical != 8 || c.Physical != 8 || c.Performance != 4 || c.RecommendedThreads != 4 {
		t.Fatalf("ARM clusters mistaken for SMT: %+v", c)
	}
}
