package control

import (
	"reflect"
	"strings"
	"testing"
)

func TestLLMCUDASelectionAndDependencies(t *testing.T) {
	for _, platform := range []string{"windows-amd64", "linux-amd64", "linux-arm64"} {
		c, err := loadCatalog(catalogFS(t, releaseCatalog(t)), platform)
		if err != nil {
			t.Fatal(err)
		}
		m := &Manager{catalog: c, platform: platform}
		s := Settings{LLMExecution: "cuda", Model: "gemma-e4b", OCR: "hayai-int8", Layout: "koharu-768"}
		err = m.validateExecution(s)
		if platform != "windows-amd64" {
			if err == nil {
				t.Fatal("unpackaged CUDA runtime accepted", platform)
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		r := m.runtimeForSettings("llama", s)
		if r == nil || r.ID != "llama-cuda" {
			t.Fatal(r)
		}
		ids := map[string]bool{}
		for _, a := range m.artifactsForSettings([]string{s.Model}, false, s) {
			ids[a.ID] = true
		}
		if !ids["llama-cuda-windows-amd64"] || !ids["llama-cudart-windows-amd64"] || ids["llama-windows-amd64"] || ids["llama-vulkan-windows-amd64"] {
			t.Fatal(ids)
		}
	}
}

func TestLLMCUDAGPUSelection(t *testing.T) {
	zero, two := 0, 2
	gpus := []GPUInfo{{ID: "intel", VulkanIndex: &zero}, {ID: "nvidia", Vendor: "10de", CUDAIndex: &two, CUDAComputeCapability: 89, CUDADriverVersion: 13000}}
	for _, id := range []string{"", "nvidia"} {
		g, err := selectedGPU(Settings{LLMExecution: "cuda", GPU: id}, gpus)
		if err != nil || g.ID != "nvidia" {
			t.Fatal(g, err)
		}
		if env := llmGPUEnvironment("cuda", g); env["CUDA_VISIBLE_DEVICES"] != "2" {
			t.Fatal(env)
		}
	}
	if _, err := selectedGPU(Settings{LLMExecution: "cuda", GPU: "intel"}, gpus); err == nil {
		t.Fatal("accepted non-CUDA device")
	}
	if _, err := selectedGPU(Settings{LLMExecution: "cuda"}, nil); err == nil {
		t.Fatal("silently fell back to CPU")
	}
}

func TestLLMBackendArguments(t *testing.T) {
	cpu := []string{"-m", "model.gguf", "--device", "none", "--gpu-layers", "0", "--no-op-offload", "--threads", "8", "--flash-attn", "off"}
	original := append([]string{}, cpu...)
	for _, backend := range []string{"cpu", "vulkan", "cuda"} {
		args := llmExecutionArgs(cpu, backend)
		if !reflect.DeepEqual(cpu, original) {
			t.Fatal("mutated shared args")
		}
		if backend == "cpu" {
			if !reflect.DeepEqual(args, cpu) {
				t.Fatal(args)
			}
			continue
		}
		device := "CUDA0"
		if backend == "vulkan" {
			device = "Vulkan0"
		}
		text := strings.Join(args, " ")
		if !strings.Contains(text, "--device "+device+" --gpu-layers 999") || strings.Contains(text, "--no-op-offload") || strings.Contains(text, "--device none") || !strings.Contains(text, "--threads 8") {
			t.Fatal(text)
		}
	}
}

func TestPresetsChooseCUDAOrVulkanFromActualHardware(t *testing.T) {
	c, err := loadCatalog(catalogFS(t, releaseCatalog(t)), "windows-amd64")
	if err != nil {
		t.Fatal(err)
	}
	m := &Manager{catalog: c, platform: "windows-amd64"}
	zero := 0
	memory := uint64(12 * 1024 * 1024 * 1024)
	for _, tc := range []struct {
		name, vendor string
		cc, driver   int
		want         string
	}{
		{"RTX 2070", "10de", 75, 13000, "cuda"},
		{"RTX 4070 SUPER", "10de", 89, 13040, "cuda"},
		{"RTX 5090", "10de", 120, 13040, "cuda"},
		{"Old NVIDIA driver", "10de", 89, 12040, "vulkan"},
		{"Pascal", "10de", 61, 13000, "vulkan"},
		{"AMD", "1002", 0, 0, "vulkan"},
		{"Intel", "8086", 0, 0, "vulkan"},
	} {
		g := GPUInfo{ID: tc.name, Name: tc.name, Vendor: tc.vendor, MemoryTotal: &memory, VulkanIndex: &zero, DirectMLIndex: &zero, CUDAComputeCapability: tc.cc, CUDADriverVersion: tc.driver}
		if tc.vendor == "10de" {
			g.CUDAIndex = &zero
		}
		profiles := m.executionProfilesFor(HardwareInfo{GPUs: []GPUInfo{g}})
		recommended := 0
		for _, p := range profiles {
			if p.Recommended {
				recommended++
			}
			if p.ID == "cpu" {
				continue
			}
			if !p.Available || p.Settings.LLMExecution != tc.want || p.Settings.GPU != g.ID {
				t.Fatal(tc.name, p)
			}
		}
		if recommended != 1 || !profiles[len(profiles)-1].Recommended {
			t.Fatal(tc.name, profiles)
		}
	}
	// CUDA must select the NVIDIA adapter even when Intel is enumerated first.
	intel := GPUInfo{ID: "intel", Vendor: "8086", VulkanIndex: &zero, DirectMLIndex: &zero}
	nvidia := GPUInfo{ID: "nvidia", Vendor: "10de", VulkanIndex: &zero, DirectMLIndex: &zero, CUDAIndex: &zero, CUDAComputeCapability: 89, CUDADriverVersion: 13040, MemoryTotal: &memory}
	for _, p := range m.executionProfilesFor(HardwareInfo{GPUs: []GPUInfo{intel, nvidia}}) {
		if p.ID != "cpu" && (p.Settings.GPU != "nvidia" || p.Settings.LLMExecution != "cuda") {
			t.Fatal(p)
		}
	}
	for _, p := range m.executionProfilesFor(HardwareInfo{}) {
		if p.ID != "cpu" && p.Available {
			t.Fatal("GPU preset available without a GPU", p)
		}
	}
}
