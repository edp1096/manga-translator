package control

import (
	"context"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestWindowsCUDALoadingReleasesMappedRAM(t *testing.T) {
	base := []string{"-m", "model.gguf", "--device", "CUDA0", "--gpu-layers", "999", "--model-draft", "mtp.gguf"}
	for _, platform := range []string{"windows-amd64", "linux-amd64", "linux-arm64"} {
		for _, backend := range []string{"cuda", "vulkan", "cpu"} {
			input := append([]string(nil), base...)
			got := llmMemoryArgs(input, backend, platform)
			if !reflect.DeepEqual(input, base) {
				t.Fatal("mutated caller arguments")
			}
			if platform == "windows-amd64" && backend == "cuda" {
				if !reflect.DeepEqual(got, append(append([]string(nil), base...), "--load-mode", "none")) {
					t.Fatal(got)
				}
			} else if !reflect.DeepEqual(got, base) {
				t.Fatalf("unverified backend changed %s/%s", platform, backend)
			}
		}
	}
	got := llmMemoryArgs([]string{"--load-mode", "mmap"}, "cuda", "windows-amd64")
	if !reflect.DeepEqual(got, []string{"--load-mode", "none"}) {
		t.Fatal("conflicting load modes", got)
	}
}
func TestVisionStartMemoryReportsCombinedHostBudget(t *testing.T) {
	c, err := loadCatalog(os.DirFS("../assets/bundle"), "windows-amd64")
	if err != nil {
		t.Fatal(err)
	}
	m := &Manager{catalog: c, settings: Settings{Layout: "koharu-768", OCR: "hayai-onnx-fp32-kv", RestorationBackend: "libtorch"}}
	const gib = int64(1024 * 1024 * 1024)
	err = m.checkVisionStartupMemory(SystemInfo{MemoryAvailable: 5 * gib})
	if err == nil || !strings.Contains(err.Error(), "5.0 GiB / 필요 6.0 GiB") || !strings.Contains(err.Error(), "OCR·복원") {
		t.Fatal(err)
	}
	for _, free := range []int64{0, 6 * gib, 11 * gib} {
		if err := m.checkVisionStartupMemory(SystemInfo{MemoryAvailable: free}); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := m.start(ctx); err != context.Canceled {
		t.Fatal("cancellation ignored", err)
	}
}
