package control

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestMeasuredPageOCRPresets(t *testing.T) {
	index := 0
	mem := uint64(12) << 30
	for _, tc := range []struct {
		platform, name string
		cc             int
		want           bool
	}{
		{"windows-amd64", "NVIDIA GeForce RTX 4070 SUPER", 89, true},
		{"linux-arm64", "NVIDIA GB10", 121, true},
		{"windows-amd64", "NVIDIA GeForce RTX 4060", 89, false},
		{"linux-amd64", "NVIDIA GeForce RTX 4070 SUPER", 89, true},
	} {
		c, err := loadCatalog(os.DirFS("../assets/bundle"), tc.platform)
		if err != nil {
			t.Fatal(err)
		}
		m := Manager{catalog: c, platform: tc.platform}
		g := GPUInfo{ID: "gpu", Name: tc.name, Vendor: "10de", MemoryTotal: &mem, CUDAIndex: &index, DirectMLIndex: &index, VulkanIndex: &index, CUDAComputeCapability: tc.cc, CUDADriverVersion: 13000}
		profiles := m.executionProfilesFor(HardwareInfo{GPUs: []GPUInfo{g}, RAMAvailable: 64 << 30})
		for _, model := range []string{"hayai-onnx-fp32-kv", "hayai-supernova-fp32", "hayai-int8"} {
			ids := m.tensorRTOCRGPUs(model, []GPUInfo{g})
			eligible := tc.want && model != "hayai-int8" && (tc.platform != "linux-amd64" || model == "hayai-onnx-fp32-kv")
			if slices.Contains(ids, "") != eligible || slices.Contains(ids, g.ID) != eligible {
				t.Fatalf("%s %s: unexpected manual OCR options %v", tc.platform, model, ids)
			}
		}
		found := map[string]bool{}
		for _, p := range profiles {
			s := p.Settings
			want := tc.want && (p.ID == "gpu-balanced" || p.ID == "gpu-12gb" || (p.ID == "gpu-12b-qat" && tc.platform != "linux-amd64"))
			found[p.ID] = true
			if (s.PageOCR == "tensorrt") != want || m.requiredRuntimeIDs(s)["tensorrt"] != want {
				t.Fatal(tc, p)
			}
			if want && ((s.RestorationBackend == "libtorch") != (p.ID == "gpu-12b-qat") || m.validateExecution(s) != nil) {
				t.Fatal(p)
			}
			if p.ID == "cpu" && s.Model != "plamo-08b" {
				t.Fatal(p)
			}
		}
		if tc.want && !(found["gpu-12b-qat"] && found["gpu-balanced"] && found["gpu-12gb"]) {
			t.Fatal("missing preset", tc)
		}
	}
}

// Run against an isolated portable root containing the selected models and CUDA runtimes.
func TestInstalledTensorRTPreset(t *testing.T) {
	root := os.Getenv("MANGA_TEST_TRT_ROOT")
	if root == "" {
		t.Skip("requires a CUDA test installation")
	}
	plat := currentPlatform()
	bundle := os.DirFS(os.Getenv("MANGA_TEST_BUNDLE"))
	cat, err := loadCatalog(bundle, plat)
	if err != nil {
		t.Fatal(err)
	}
	m := &Manager{root: root, platform: plat, catalog: cat, logger: log.New(io.Discard, "", 0)}
	for _, p := range m.executionProfilesFor(HardwareReport()) {
		if p.ID == "gpu-12b-qat" {
			m.settings = p.Settings
		}
	}
	s := m.settings
	if s.PageOCR != "tensorrt" {
		t.Fatalf("GPU did not select TensorRT: %+v", s)
	}
	rt := m.runtimeByID("tensorrt")
	for _, a := range m.runtimeArtifacts(*rt) {
		source := os.Getenv("MANGA_TEST_TRT_ARCHIVE")
		if isEmbedded(a) {
			source = filepath.Join(os.Getenv("MANGA_TEST_BUNDLE"), a.URL[len("embedded:"):])
		}
		if sum, err := hashFile(source); err != nil || sum != a.SHA256 {
			t.Fatal("archive verification failed", a.ID, err)
		}
		if err := installArtifact(context.Background(), root, a, source, bundle); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.writeNativeConfig(); err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	raw, err := os.ReadFile(filepath.Join(root, "config", "native_api.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg["page_ocr_engine"] != "tensorrt" || cfg["reuse_cuda_sessions"] != (plat == "linux-arm64") {
		t.Fatal("wrong configuration")
	}
	if err = m.prepareTensorRT(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, cfg["tensorrt_plan_dir"].(string), "decode.plan")
	before, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if err = m.prepareTensorRT(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(file)
	if err != nil || !before.ModTime().Equal(after.ModTime()) {
		t.Fatal("cache was rebuilt", err)
	}
}

func TestV21PlanReceiptIncludesEncoder(t *testing.T) {
	const v21 = "hayai-onnx-fp32-kv"
	dir := t.TempDir()
	for _, name := range planNames(v21) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	receipt, err := inspectPlans(dir, v21)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(filepath.Join(dir, "receipt.json"), receipt); err != nil {
		t.Fatal(err)
	}
	if !validPlans(dir, v21) || validPlans(dir, "hayai-supernova-fp32") {
		t.Fatal("model receipt mismatch")
	}
	if err := os.WriteFile(filepath.Join(dir, "encoder.plan"), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if validPlans(dir, v21) {
		t.Fatal("corrupted encoder was accepted")
	}
}
