package control

import "testing"

func TestGPUSelectionUsesStableIdentityAndBackendOrdinals(t *testing.T) {
	zero, one, three := 0, 1, 3
	gpus := []GPUInfo{{ID: "intel", Name: "Intel", VulkanIndex: &zero, DirectMLIndex: &zero}, {ID: "nvidia", Name: "NVIDIA", VulkanIndex: &three, DirectMLIndex: &one, CUDAIndex: &zero}}
	s := Settings{GPU: "nvidia", LLMExecution: "vulkan", LayoutExecution: "directml"}
	g, err := selectedGPU(s, gpus)
	if err != nil || g.ID != "nvidia" || *g.VulkanIndex != 3 || onnxGPUIndex(s, g) != 1 {
		t.Fatal(g, err)
	}
	s.GPU = "intel"
	s.LayoutExecution = "cuda"
	if _, err = selectedGPU(s, gpus); err == nil {
		t.Fatal("accepted incompatible GPU")
	}
	s.GPU = ""
	g, err = selectedGPU(s, gpus)
	if err != nil || g.ID != "nvidia" || onnxGPUIndex(s, g) != 0 {
		t.Fatal(g, err)
	}
	if _, err = selectedGPU(s, nil); err == nil {
		t.Fatal("GPU request silently fell back to CPU")
	}
}

func TestExecutionProfilesSelectMatchingRuntimeArtifacts(t *testing.T) {
	for _, platform := range []string{"linux-arm64", "linux-amd64", "windows-amd64"} {
		c, err := loadCatalog(catalogFS(t, releaseCatalog(t)), platform)
		if err != nil {
			t.Fatal(platform, err)
		}
		m := &Manager{catalog: c, platform: platform}
		for _, profile := range m.executionProfiles() {
			s := profile.Settings
			if err = m.validateExecution(s); err != nil {
				t.Fatal(platform, profile.ID, err)
			}
			artifacts := m.artifactsForSettings([]string{s.Layout, s.OCR, s.Model}, true, s)
			ids := map[string]bool{}
			for _, a := range artifacts {
				ids[a.ID] = true
			}
			for _, family := range []string{"ort", "llama"} {
				r := m.runtimeForSettings(family, s)
				if r == nil {
					t.Fatal("missing runtime", platform, profile.ID, family)
				}
				for _, id := range r.artifactIDs() {
					if !ids[id] {
						t.Fatal("missing dependency", platform, profile.ID, id)
					}
				}
			}
			if s.LLMExecution == "vulkan" && ids["llama-"+platform] {
				t.Fatal("CPU llama downloaded for GPU profile")
			}
		}
	}
}

func TestExecutionRejectsIncompatibleOCRAndUnavailableRuntime(t *testing.T) {
	c, err := loadCatalog(catalogFS(t, releaseCatalog(t)), "linux-arm64")
	if err != nil {
		t.Fatal(err)
	}
	m := &Manager{catalog: c, platform: "linux-arm64"}
	for _, s := range []Settings{{OCR: "hayai-int8", OCRExecution: "cuda"}, {OCR: "hayai-onnx-fp32-kv", OCRExecution: "webgpu"}, {LayoutExecution: "directml"}, {LLMExecution: "automatic-cpu-fallback"}} {
		if err = m.validateExecution(s); err == nil {
			t.Fatal("accepted incompatible settings", s)
		}
	}
	if err = m.validateExecution(Settings{}); err != nil {
		t.Fatal("old CPU settings no longer work", err)
	}
}

func TestGPUOCRSelectionCannotSilentlySwitchToCPU(t *testing.T) {
	c, err := loadCatalog(catalogFS(t, releaseCatalog(t)), "linux-arm64")
	if err != nil {
		t.Fatal(err)
	}
	m := &Manager{catalog: c, platform: "linux-arm64", root: t.TempDir(), settings: Settings{Layout: "koharu-768", OCR: "hayai-onnx-fp32-kv", Model: "gemma-e4b", LLMExecution: "vulkan", OCRExecution: "cuda", Threads: 1}}
	if err = m.SelectModel("hayai-int8"); err == nil {
		t.Fatal("CPU-only OCR remained selectable in GPU mode")
	}
	if m.settings.OCR != "hayai-onnx-fp32-kv" || m.settings.OCRExecution != "cuda" {
		t.Fatal("failed selection changed configuration")
	}
	if err = m.SelectModel("gemma"); err != nil {
		t.Fatal(err)
	}
	if m.settings.LLMExecution != "vulkan" || m.settings.Model != "gemma" {
		t.Fatal("small LLM lost GPU execution")
	}
	m.settings.OCRExecution = "cpu"
	if err = m.SelectModel("hayai-int8"); err != nil {
		t.Fatal("mixed CPU/GPU setup rejected LiteRT", err)
	}
}
