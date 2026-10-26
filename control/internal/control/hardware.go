package control

import (
	"encoding/binary"
	"fmt"
	"math/bits"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf16"
)

type CPUInfo struct {
	Name               string `json:"name"`
	Board              string `json:"board,omitempty"`
	Logical            int    `json:"logical"`
	Physical           int    `json:"physical"`
	Performance        int    `json:"performance"`
	RecommendedThreads int    `json:"recommendedThreads"`
	ThreadBasis        string `json:"threadBasis"`
	Source             string `json:"source"`
}

type GPUInfo struct {
	VulkanIndex   *int    `json:"vulkanIndex,omitempty"`
	CUDAIndex     *int    `json:"cudaIndex,omitempty"`
	DirectMLIndex *int    `json:"directmlIndex,omitempty"`
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Vendor        string  `json:"vendor"`
	MemoryKind    string  `json:"memoryKind"` // dedicated, shared, unknown
	MemoryTotal   *uint64 `json:"memoryTotal"`
	MemoryUsed    *uint64 `json:"memoryUsed"`
	MemoryFree    *uint64 `json:"memoryFree"`
	Source        string  `json:"source"`
}

type HardwareInfo struct {
	CPU          CPUInfo   `json:"cpu"`
	GPUs         []GPUInfo `json:"gpus"`
	GPUStatus    string    `json:"gpuStatus"`
	RAMTotal     int64     `json:"ramTotal"`
	RAMAvailable int64     `json:"ramAvailable"`
}

// HardwareReport is also exposed by --hardware-info for offline diagnostics.
// It does not create application files, launch subprocesses or start APIs.
func HardwareReport() HardwareInfo {
	ram := systemInfo("")
	return HardwareInfo{CPU: detectedCPU(), GPUs: executionGPUs(probeGPUs()), GPUStatus: "ready", RAMTotal: ram.MemoryTotal, RAMAvailable: ram.MemoryAvailable}
}

type cpuCore struct{ id, physical, capacity int }

// A hardware-derived starting point, not a claim of benchmark-optimal threads.
// Capacity classes must have a substantial gap; slight per-core differences
// must not reduce a 10-core performance cluster to a single "fastest" core.
func recommendCPU(cores []cpuCore, physicalKnown bool, quota int) CPUInfo {
	c := CPUInfo{Logical: len(cores)}
	if c.Logical == 0 {
		c.Logical = max(1, runtime.NumCPU())
	}
	physical := map[int]bool{}
	for _, core := range cores {
		physical[core.physical] = true
	}
	if physicalKnown {
		c.Physical = len(physical)
	}
	c.RecommendedThreads = c.Physical
	c.ThreadBasis = "물리 코어 수 기준"
	if c.RecommendedThreads == 0 {
		c.RecommendedThreads = c.Logical
		c.ThreadBasis = "물리 코어 정보 없음 · 사용 가능한 논리 CPU 수 기준"
	}
	capacities := []int{}
	for _, core := range cores {
		if core.capacity <= 0 {
			capacities = nil
			break
		}
		capacities = append(capacities, core.capacity)
	}
	sort.Ints(capacities)
	threshold, gap := 0, 0
	for i := 1; i < len(capacities); i++ {
		if d := capacities[i] - capacities[i-1]; d > gap {
			gap = d
			threshold = capacities[i]
		}
	}
	if len(capacities) > 0 && gap > capacities[len(capacities)-1]/10 {
		fast := map[int]bool{}
		for _, core := range cores {
			if core.capacity >= threshold {
				fast[core.physical] = true
			}
		}
		c.Performance = len(fast)
		c.RecommendedThreads = c.Performance
		c.ThreadBasis = "OS가 보고한 성능 코어 수 기준"
	}
	if quota > 0 && quota < c.RecommendedThreads {
		c.RecommendedThreads = quota
		c.ThreadBasis = "OS CPU 할당 한도 기준"
	}
	c.RecommendedThreads = max(1, min(c.RecommendedThreads, c.Logical))
	return c
}

var detectedCPU = sync.OnceValue(probeCPU)
var hardwareGPUs struct {
	sync.Mutex
	values  []GPUInfo
	updated time.Time
	busy    bool
}

// Never run a driver query under the controller's state lock or on every poll.
func hardwareSnapshot() HardwareInfo {
	ram := systemInfo("")
	h := HardwareInfo{CPU: detectedCPU(), GPUs: []GPUInfo{}, GPUStatus: "ready", RAMTotal: ram.MemoryTotal, RAMAvailable: ram.MemoryAvailable}
	hardwareGPUs.Lock()
	defer hardwareGPUs.Unlock()
	if hardwareGPUs.updated.IsZero() {
		h.GPUStatus = "probing"
	}
	h.GPUs = append(h.GPUs, hardwareGPUs.values...)
	if !hardwareGPUs.busy && time.Since(hardwareGPUs.updated) > 10*time.Second {
		hardwareGPUs.busy = true
		go func() {
			gpus := executionGPUs(probeGPUs())
			hardwareGPUs.Lock()
			defer hardwareGPUs.Unlock()
			hardwareGPUs.values = gpus
			hardwareGPUs.updated = time.Now()
			hardwareGPUs.busy = false
		}()
	}
	return h
}

func pciID(s string) string {
	var domain, bus, slot, function uint32
	if _, err := fmt.Sscanf(strings.ToLower(s), "%x:%x:%x.%x", &domain, &bus, &slot, &function); err == nil {
		return fmt.Sprintf("%04x:%02x:%02x.%x", domain, bus, slot, function)
	}
	return strings.ToLower(s)
}

func mergeGPUs(osGPUs, driverGPUs []GPUInfo) []GPUInfo {
	result := append([]GPUInfo{}, osGPUs...)
	for _, gpu := range driverGPUs {
		match := -1
		for i, old := range result {
			if old.ID == gpu.ID {
				match = i
				break
			}
		}
		if match < 0 {
			// DXGI identifies adapters by LUID, NVML by PCI address. A name is
			// usable only when unique; never merge two identical discrete cards.
			count := 0
			for i, old := range result {
				if old.Name == gpu.Name {
					match = i
					count++
				}
			}
			if count != 1 {
				match = -1
			}
		}
		if match >= 0 {
			old := result[match]
			if gpu.DirectMLIndex == nil {
				gpu.DirectMLIndex = old.DirectMLIndex
			}
			if old.MemoryKind == "shared" || gpu.MemoryKind == "shared" {
				gpu.MemoryKind = "shared"
				gpu.MemoryTotal, gpu.MemoryUsed, gpu.MemoryFree = nil, nil, nil
			}
			if gpu.MemoryKind == "unknown" {
				gpu.MemoryKind = old.MemoryKind
			}
			if gpu.MemoryTotal == nil && gpu.MemoryKind != "shared" {
				gpu.MemoryTotal = old.MemoryTotal
			}
			result[match] = gpu
		} else {
			result = append(result, gpu)
		}
	}
	return result
}

// Windows processor topology ABI, parsed independently for cross-platform tests.
func decodeWindowsCores(data []byte, allowed uint64) ([]cpuCore, error) {
	var cores []cpuCore
	physical := 0
	for len(data) >= 8 {
		size := int(binary.LittleEndian.Uint32(data[4:8]))
		if size < 8 || size > len(data) {
			return nil, fmt.Errorf("invalid processor topology record")
		}
		if binary.LittleEndian.Uint32(data[:4]) == 0 {
			if size < 48 {
				return nil, fmt.Errorf("short processor core record")
			}
			groups := int(binary.LittleEndian.Uint16(data[30:32]))
			if groups < 1 || 32+groups*16 > size {
				return nil, fmt.Errorf("invalid processor group count")
			}
			for i := 0; i < groups; i++ {
				offset := 32 + i*16
				mask := binary.LittleEndian.Uint64(data[offset : offset+8])
				group := int(binary.LittleEndian.Uint16(data[offset+8 : offset+10]))
				if group == 0 && allowed != 0 {
					mask &= allowed
				}
				for mask != 0 {
					bit := bits.TrailingZeros64(mask)
					cores = append(cores, cpuCore{group*64 + bit, physical, int(data[9]) + 1})
					mask &^= uint64(1) << bit
				}
			}
			physical++
		}
		data = data[size:]
	}
	if len(data) != 0 {
		return nil, fmt.Errorf("truncated processor topology")
	}
	return cores, nil
}

func decodeDXGIDescription(data []byte) GPUInfo {
	if len(data) < 312 {
		return GPUInfo{}
	}
	name := make([]uint16, 128)
	for i := range name {
		name[i] = binary.LittleEndian.Uint16(data[i*2 : i*2+2])
	}
	s := strings.TrimRight(string(utf16.Decode(name)), "\x00")
	vendor := binary.LittleEndian.Uint32(data[256:260])
	total := binary.LittleEndian.Uint64(data[272:280])
	g := GPUInfo{ID: fmt.Sprintf("dxgi:%08x:%08x", binary.LittleEndian.Uint32(data[300:304]), binary.LittleEndian.Uint32(data[296:300])), Name: s, Vendor: fmt.Sprintf("%04x", vendor), MemoryKind: "unknown", Source: "DXGI"}
	if total > 0 {
		g.MemoryTotal = &total
	}
	return g
}
