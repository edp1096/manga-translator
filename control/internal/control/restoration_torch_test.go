package control

import (
	"os"
	"testing"
	"time"
)

func TestTorchRestorationInstallationIsolation(t *testing.T) {
	for _, platform := range []string{"windows-amd64", "linux-arm64", "linux-amd64"} {
		t.Run(platform, func(t *testing.T) {
			c, err := loadCatalog(os.DirFS("../assets/bundle"), platform)
			if err != nil {
				t.Fatal(err)
			}
			m := &Manager{root: t.TempDir(), platform: platform, catalog: c, settings: Settings{Layout: "koharu-768", OCR: "hayai-int8", Model: "gemma", Threads: 1}}
			for _, a := range m.selectedArtifacts() {
				if a.ID == "manga-lama-torch" || a.ID == "libtorch-windows-amd64" || a.ID == "libtorch-torch-linux-arm64" {
					t.Fatal("optional CUDA restoration downloaded for legacy CPU setup")
				}
			}
			m.settings.RestorationBackend = "libtorch"
			if platform == "linux-amd64" {
				if m.validateExecution(m.settings) == nil {
					t.Fatal("unsupported platform accepted")
				}
				return
			}
			if err := m.validateExecution(m.settings); err != nil {
				t.Fatal(err)
			}
			found := map[string]bool{}
			for _, a := range m.selectedArtifacts() {
				found[a.ID] = true
			}
			if !found["manga-lama-torch"] || !found["manga-lama-torch-native-"+platform] {
				t.Fatal("CUDA model/bridge missing", found)
			}
			if found["manga-lama"] {
				t.Fatal("Torch path depends on ONNX restoration model")
			}
			if !m.requiredRuntimeIDs(m.settings)["torch-cuda"] {
				t.Fatal("active CUDA runtime can be deleted")
			}
			r := m.runtimeByID("torch-cuda")
			if !m.protectedRuntimeFiles("torch-cuda", m.settings)[r.Library] {
				t.Fatal("active plugin not protected")
			}
			if m.DeleteModel("manga-lama-torch") == nil {
				t.Fatal("selected CUDA model deletion allowed")
			}
		})
	}
}
func TestTorchRestorationGPUCompatibility(t *testing.T) {
	zero := 0
	s := Settings{RestorationBackend: "libtorch"}
	if !usesGPU(s) {
		t.Fatal("CUDA-only restoration not counted")
	}
	if _, err := selectedGPU(s, []GPUInfo{{ID: "amd", Vendor: "1002", DirectMLIndex: &zero}}); err == nil {
		t.Fatal("non-CUDA GPU accepted")
	}
	if _, err := selectedGPU(s, []GPUInfo{{ID: "old", Vendor: "10de", CUDAIndex: &zero, CUDAComputeCapability: 89, CUDADriverVersion: 12000}}); err == nil {
		t.Fatal("CUDA 12 driver accepted")
	}
	for _, cc := range []int{89, 121} {
		if _, err := selectedGPU(s, []GPUInfo{{ID: "nvidia", Vendor: "10de", CUDAIndex: &zero, CUDAComputeCapability: cc, CUDADriverVersion: 13000}}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRestorationSnapshotSelectionConsistency(t *testing.T) {
	c, err := loadCatalog(os.DirFS("../assets/bundle"), "windows-amd64")
	if err != nil {
		t.Fatal(err)
	}
	m := &Manager{root: t.TempDir(), platform: "windows-amd64", catalog: c}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 40; i++ {
			m.mu.Lock()
			if i%2 == 0 {
				m.settings.RestorationBackend = "libtorch"
			} else {
				m.settings.RestorationBackend = "onnx"
			}
			m.mu.Unlock()
			time.Sleep(time.Millisecond)
		}
	}()
	for i := 0; i < 10; i++ {
		s := m.Snapshot()
		for _, r := range s.Runtimes {
			if r.ID == "torch-cuda" && r.Required != (s.Settings.RestorationBackend == "libtorch") {
				t.Error("snapshot mixes runtime and settings revisions")
			}
		}
	}
	<-done
}
