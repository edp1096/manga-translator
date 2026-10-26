package control

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCPURecommendationUsesTopology(t *testing.T) {
	for _, tc := range []struct {
		name                                      string
		cores                                     []cpuCore
		quota, physical, performance, recommended int
	}{
		{"four homogeneous cores", []cpuCore{{0, 0, 1024}, {1, 1, 1024}, {2, 2, 1024}, {3, 3, 1024}}, 0, 4, 0, 4},
		{"SMT", []cpuCore{{0, 0, 1024}, {1, 1, 1024}, {2, 0, 1024}, {3, 1, 1024}}, 0, 2, 0, 2},
		{"heterogeneous", []cpuCore{{0, 0, 397}, {1, 1, 397}, {2, 2, 1024}, {3, 3, 1024}}, 0, 4, 2, 2},
		{"minor capacity differences", []cpuCore{{0, 0, 718}, {1, 1, 731}, {2, 2, 997}, {3, 3, 1017}, {4, 4, 1024}}, 0, 5, 3, 3},
		{"quota", []cpuCore{{0, 0, 1024}, {1, 1, 1024}, {2, 2, 1024}, {3, 3, 1024}}, 2, 4, 0, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := recommendCPU(tc.cores, true, tc.quota)
			if c.Physical != tc.physical || c.Performance != tc.performance || c.RecommendedThreads != tc.recommended {
				t.Fatalf("unexpected hardware recommendation: %+v", c)
			}
		})
	}
}

func TestWindowsTopologyAnd64BitVRAM(t *testing.T) {
	var records []byte
	for _, spec := range []struct {
		mask  uint64
		class byte
	}{{3, 8}, {12, 8}, {16, 0}, {32, 0}} {
		r := make([]byte, 48)
		binary.LittleEndian.PutUint32(r[4:], 48)
		r[9] = spec.class
		binary.LittleEndian.PutUint16(r[30:], 1)
		binary.LittleEndian.PutUint64(r[32:], spec.mask)
		records = append(records, r...)
	}
	cores, err := decodeWindowsCores(records, 0x3f)
	if err != nil || len(cores) != 6 {
		t.Fatal(cores, err)
	}
	c := recommendCPU(cores, true, 0)
	if c.Physical != 4 || c.Performance != 2 || c.RecommendedThreads != 2 {
		t.Fatal(c)
	}
	limited, err := decodeWindowsCores(records, 0x30)
	if err != nil || len(limited) != 2 {
		t.Fatal("process affinity ignored", limited, err)
	}
	if _, err = decodeWindowsCores(records[:len(records)-1], 0); err == nil {
		t.Fatal("truncated Windows topology accepted")
	}
	desc := make([]byte, 312)
	binary.LittleEndian.PutUint32(desc[256:], 0x10de)
	binary.LittleEndian.PutUint64(desc[272:], 12<<30)
	binary.LittleEndian.PutUint32(desc[296:], 0x12345678)
	g := decodeDXGIDescription(desc)
	if g.MemoryTotal == nil || *g.MemoryTotal != 12<<30 {
		t.Fatal("12 GiB VRAM truncated to 32 bits", g)
	}
	if g.MemoryUsed != nil || g.MemoryFree != nil {
		t.Fatal("invented usage from total capacity")
	}
}

func TestGPUSharedMemoryIsNotCountedAsVRAM(t *testing.T) {
	total := uint64(128 << 30)
	result := mergeGPUs([]GPUInfo{{ID: "gpu", Name: "GPU", MemoryKind: "shared"}}, []GPUInfo{{ID: "gpu", Name: "GPU", MemoryKind: "dedicated", MemoryTotal: &total}})
	if len(result) != 1 || result[0].MemoryKind != "shared" || result[0].MemoryTotal != nil {
		t.Fatal("shared system memory double-counted", result)
	}
	if pciID("0000000F:01:00.0") != "000f:01:00.0" {
		t.Fatal("PCI identifiers do not normalize")
	}
}

func TestHardwareBasedThreadsPreserveExistingManualSettings(t *testing.T) {
	root := t.TempDir()
	if err := writeJSON(filepath.Join(root, "config/control.json"), map[string]any{"threads": 1, "autoStart": false}); err != nil {
		t.Fatal(err)
	}
	m, err := NewManager(root, fixtureBundle(testArtifact([]byte("fixture"), "https://example.com/model")), log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	if m.settings.Threads != 1 || m.settings.ThreadsAuto {
		t.Fatal("legacy manual setting overwritten", m.settings)
	}
	s := m.settings
	s.Threads = 0
	s.ThreadsAuto = true
	if err = m.UpdateSettings(s); err != nil {
		t.Fatal(err)
	}
	if m.settings.Threads != detectedCPU().RecommendedThreads {
		t.Fatal("automatic option did not use OS topology")
	}
	raw, err := os.ReadFile(filepath.Join(root, "config/control.json"))
	if err != nil {
		t.Fatal(err)
	}
	var persisted Settings
	if err = json.Unmarshal(raw, &persisted); err != nil || !persisted.ThreadsAuto {
		t.Fatal("automatic policy not persisted", err)
	}
}

func TestHardwareProbesDoNotLaunchExternalPrograms(t *testing.T) {
	paths, err := filepath.Glob("hardware*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range paths {
		if strings.HasSuffix(p, "_test.go") {
			continue
		}
		raw, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), `"os/exec"`) || strings.Contains(string(raw), "syscall.Exec(") || strings.Contains(string(raw), "os.StartProcess(") {
			t.Fatal("hardware probe launches external programs", p)
		}
	}
}
