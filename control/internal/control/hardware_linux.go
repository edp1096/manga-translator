//go:build linux

package control

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	"github.com/ebitengine/purego"
	"golang.org/x/sys/unix"
)

func readHardwareText(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(strings.TrimRight(string(data), "\x00"))
}
func readHardwareInt(path string) int { v, _ := strconv.Atoi(readHardwareText(path)); return v }

func probeCPU() CPUInfo {
	var affinity unix.CPUSet
	var ids []int
	if unix.SchedGetaffinity(0, &affinity) == nil {
		for i := 0; i < 1024; i++ {
			if affinity.IsSet(i) {
				ids = append(ids, i)
			}
		}
	}
	if len(ids) == 0 {
		for i := 0; i < runtime.NumCPU(); i++ {
			ids = append(ids, i)
		}
	}
	return linuxCPUFrom("/sys/devices/system/cpu", "/proc/cpuinfo", ids, linuxCPUQuota())
}

func linuxCPUFrom(sysfs, cpuinfo string, ids []int, quota int) CPUInfo {
	var cores []cpuCore
	physical := map[string]int{}
	known := true
	for _, id := range ids {
		root := filepath.Join(sysfs, fmt.Sprintf("cpu%d", id))
		core := readHardwareText(filepath.Join(root, "topology/core_id"))
		pkg := readHardwareText(filepath.Join(root, "topology/physical_package_id"))
		// ARM core_id may repeat across clusters. The kernel's SMT sibling
		// group identifies a physical core without assuming x86 numbering.
		siblings := readHardwareText(filepath.Join(root, "topology/thread_siblings_list"))
		if siblings == "" {
			siblings = readHardwareText(filepath.Join(root, "topology/core_cpus_list"))
		}
		key := "siblings:" + siblings
		if siblings == "" {
			key = pkg + ":" + readHardwareText(filepath.Join(root, "topology/die_id")) + ":" + readHardwareText(filepath.Join(root, "topology/cluster_id")) + ":" + core
		}
		if siblings == "" && (core == "" || pkg == "" || core == "-1") {
			known = false
			key = fmt.Sprintf("logical:%d", id)
		}
		if _, ok := physical[key]; !ok {
			physical[key] = len(physical)
		}
		cores = append(cores, cpuCore{id, physical[key], readHardwareInt(filepath.Join(root, "cpu_capacity"))})
	}
	c := recommendCPU(cores, known, quota)
	for _, line := range strings.Split(readHardwareText(cpuinfo), "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "model name" || key == "Hardware" || key == "Processor" {
			c.Name = strings.TrimSpace(value)
			if key == "model name" {
				break
			}
		}
	}
	c.Board = readHardwareText("/sys/firmware/devicetree/base/model")
	if c.Board == "" {
		c.Board = readHardwareText("/sys/class/dmi/id/product_name")
	}
	if c.Name == "" {
		c.Name = readHardwareText("/sys/devices/soc0/soc_id")
		if strings.HasPrefix(c.Name, "jep106:") {
			c.Name = ""
		}
	}
	if c.Name == "" {
		parts := []string{}
		seen := map[string]bool{}
		for _, line := range strings.Split(readHardwareText(cpuinfo), "\n") {
			key, value, ok := strings.Cut(line, ":")
			if ok && strings.TrimSpace(key) == "CPU part" {
				value = strings.TrimSpace(value)
				if !seen[value] {
					seen[value] = true
					parts = append(parts, value)
				}
			}
		}
		if len(parts) > 0 {
			c.Name = "ARM CPU (" + strings.Join(parts, " / ") + ")"
		}
	}
	c.Source = "Linux sysfs / procfs / affinity"
	return c
}

func linuxCPUQuota() int {
	paths := []string{"/sys/fs/cgroup/cpu.max"}
	for _, line := range strings.Split(readHardwareText("/proc/self/cgroup"), "\n") {
		if strings.HasPrefix(line, "0::/") {
			rel := strings.TrimPrefix(line, "0::/")
			if !strings.Contains(rel, "..") {
				for dir := filepath.Join("/sys/fs/cgroup", rel); dir != "/sys/fs/cgroup"; dir = filepath.Dir(dir) {
					paths = append(paths, filepath.Join(dir, "cpu.max"))
				}
			}
		}
	}
	limit := 0
	for _, p := range paths {
		fields := strings.Fields(readHardwareText(p))
		if len(fields) != 2 || fields[0] == "max" {
			continue
		}
		quota, e1 := strconv.ParseInt(fields[0], 10, 64)
		period, e2 := strconv.ParseInt(fields[1], 10, 64)
		if e1 == nil && e2 == nil && quota > 0 && period > 0 {
			n := int((quota + period - 1) / period)
			if limit == 0 || n < limit {
				limit = n
			}
		}
	}
	return limit
}

func openDriverLibrary(kind string) (driverLibrary, error) {
	name := map[string]string{"nvml": "libnvidia-ml.so.1", "cuda": "libcuda.so.1", "vulkan": "libvulkan.so.1"}[kind]
	if name == "" {
		return driverLibrary{}, fmt.Errorf("unknown driver API")
	}
	handle, err := purego.Dlopen(name, purego.RTLD_NOW|purego.RTLD_LOCAL)
	if err != nil {
		return driverLibrary{}, err
	}
	return driverLibrary{symbol: func(name string) (uintptr, error) { return purego.Dlsym(handle, name) }}, nil
}

func readHardwareUint(path string) *uint64 {
	value, err := strconv.ParseUint(readHardwareText(path), 10, 64)
	if err != nil {
		return nil
	}
	return &value
}

func probeGPUs() []GPUInfo {
	var gpus []GPUInfo
	cards, _ := filepath.Glob("/sys/class/drm/card*")
	for _, card := range cards {
		if _, err := strconv.Atoi(strings.TrimPrefix(filepath.Base(card), "card")); err != nil {
			continue
		}
		device := filepath.Join(card, "device")
		// Ignore display-only framebuffers (simpledrm, HDMI controllers).
		render, _ := filepath.Glob(filepath.Join(device, "drm", "renderD*"))
		if len(render) == 0 {
			continue
		}
		link, _ := filepath.EvalSymlinks(filepath.Join(device, "driver"))
		driver := filepath.Base(link)
		vendor := strings.TrimPrefix(readHardwareText(filepath.Join(device, "vendor")), "0x")
		id := filepath.Base(card)
		for _, line := range strings.Split(readHardwareText(filepath.Join(device, "uevent")), "\n") {
			if strings.HasPrefix(line, "PCI_SLOT_NAME=") {
				id = pciID(strings.TrimPrefix(line, "PCI_SLOT_NAME="))
			}
		}
		g := GPUInfo{ID: id, Name: driver, Vendor: vendor, MemoryKind: "unknown", Source: "Linux DRM sysfs"}
		if g.Name == "." || g.Name == "" {
			g.Name = "GPU " + filepath.Base(card)
		}
		g.MemoryTotal = readHardwareUint(filepath.Join(device, "mem_info_vram_total"))
		g.MemoryUsed = readHardwareUint(filepath.Join(device, "mem_info_vram_used"))
		if g.MemoryTotal != nil && *g.MemoryTotal > 0 {
			g.MemoryKind = "dedicated"
			if g.MemoryUsed != nil && *g.MemoryUsed <= *g.MemoryTotal {
				free := *g.MemoryTotal - *g.MemoryUsed
				g.MemoryFree = &free
			}
		}
		// These SoC DRM drivers explicitly use system-memory allocations.
		switch driver {
		case "panthor", "panfrost", "lima", "v3d", "vc4":
			g.MemoryKind = "shared"
			g.MemoryTotal = nil
			g.MemoryUsed = nil
			g.MemoryFree = nil
		}
		gpus = append(gpus, g)
	}
	return mergeGPUs(gpus, nvidiaGPUs())
}
