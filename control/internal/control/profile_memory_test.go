package control

import (
	"strings"
	"testing"
)

func TestFiveProfilesFollowMemoryAndBackend(t *testing.T) {
	c, err := loadCatalog(catalogFS(t, releaseCatalog(t)), "windows-amd64")
	if err != nil {
		t.Fatal(err)
	}
	m := &Manager{catalog: c, platform: "windows-amd64"}
	zero := 0
	gib := uint64(1024 * 1024 * 1024)
	for _, tc := range []struct {
		name       string
		vendor     string
		memory     uint64
		want       string
		backend    string
		fifthReady bool
	}{
		{"RTX8", "10de", 8*gib - 6*1024*1024, "gpu-12gb", "cuda", false},
		{"RTX12", "10de", 12878610432, "gpu-12b-qat", "cuda", true},
		{"RTX16", "10de", 16 * gib, "gpu-12b-qat", "cuda", true},
		{"AMD8", "1002", 8 * gib, "gpu-12gb", "vulkan", false},
		{"AMD12", "1002", 12 * gib, "gpu-12b-qat", "vulkan", true},
		{"Intel12", "8086", 12 * gib, "gpu-12b-qat", "vulkan", true},
		{"Unknown memory", "10de", 0, "gpu-balanced", "cuda", false},
	} {
		g := GPUInfo{ID: tc.name, Vendor: tc.vendor, MemoryTotal: &tc.memory, VulkanIndex: &zero, DirectMLIndex: &zero}
		if tc.vendor == "10de" {
			g.CUDAIndex, g.CUDAComputeCapability, g.CUDADriverVersion = &zero, 89, 13040
		}
		profiles := m.executionProfilesFor(HardwareInfo{GPUs: []GPUInfo{g}})
		if len(profiles) != 5 {
			t.Fatal("missing fifth preset", tc.name, profiles)
		}
		for i, id := range []string{"cpu", "gpu-mixed", "gpu-balanced", "gpu-12gb", "gpu-12b-qat"} {
			if profiles[i].ID != id || profiles[i].Settings.Profile != id {
				t.Fatal("existing profile identity/order changed", profiles)
			}
		}
		count := 0
		for _, p := range profiles {
			if p.Recommended {
				count++
				if p.ID != tc.want {
					t.Fatal(tc.name, "wrong recommendation", p)
				}
			}
		}
		if count != 1 {
			t.Fatal(count, tc.name)
		}
		p := profiles[4]
		if p.Available != tc.fifthReady || p.Settings.Model != "gemma-12b-qat" {
			t.Fatal(tc.name, p)
		}
		if tc.fifthReady && (p.Settings.LLMExecution != tc.backend || p.Settings.GPU != g.ID) {
			t.Fatal(tc.name, p)
		}
		if tc.fifthReady && (strings.Contains(p.Note, "MTP4") != (tc.backend == "cuda")) {
			t.Fatal("draft acceleration mislabeled", tc.name, p)
		}
		if !tc.fifthReady && !strings.Contains(p.UnavailableReason, "12GB") {
			t.Fatal("missing memory explanation", tc.name, p)
		}
	}
	// Prefer a 16GB Vulkan GPU over an 8GB CUDA GPU that cannot fit this preset.
	eight, sixteen := 8*gib, 16*gib
	nvidia := GPUInfo{ID: "nvidia8", Vendor: "10de", MemoryTotal: &eight, CUDAIndex: &zero, VulkanIndex: &zero, DirectMLIndex: &zero, CUDAComputeCapability: 89, CUDADriverVersion: 13040}
	amd := GPUInfo{ID: "amd16", Vendor: "1002", MemoryTotal: &sixteen, VulkanIndex: &zero, DirectMLIndex: &zero}
	profiles := m.executionProfilesFor(HardwareInfo{GPUs: []GPUInfo{nvidia, amd}})
	if p := profiles[4]; !p.Available || p.Settings.GPU != amd.ID || p.Settings.LLMExecution != "vulkan" || !p.Recommended {
		t.Fatal(p)
	}
	// Preserve existing CUDA adapter preference for the earlier four presets.
	for _, p := range profiles[1:4] {
		if p.Settings.GPU != nvidia.ID || p.Settings.LLMExecution != "cuda" {
			t.Fatal(p)
		}
	}
}

func TestProfileMemoryClassesKeepDedicatedAndSharedSeparate(t *testing.T) {
	gib := uint64(1024 * 1024 * 1024)
	for _, memory := range []uint64{8 * gib, 11 * gib, 12*gib - 65*1024*1024} {
		if profileMemoryFits(GPUInfo{MemoryTotal: &memory}, 12, 64*1024*1024*1024) {
			t.Fatal("system RAM incorrectly substituted for dedicated VRAM", memory)
		}
	}
	for _, available := range []int64{8 * 1024 * 1024 * 1024, 23 * 1024 * 1024 * 1024} {
		if profileMemoryFits(GPUInfo{MemoryKind: "shared"}, 12, available) {
			t.Fatal("insufficient unified memory", available)
		}
	}
	if !profileMemoryFits(GPUInfo{MemoryKind: "shared"}, 12, 24*1024*1024*1024) || profileMemoryFits(GPUInfo{}, 12, 64*1024*1024*1024) {
		t.Fatal("shared or unknown memory class")
	}
}
