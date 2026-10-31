package control

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestOCRVerifierPortableDependencies(t *testing.T) {
	for _, platform := range []string{"windows-amd64", "linux-amd64", "linux-arm64"} {
		c, err := loadCatalog(os.DirFS("../assets/bundle"), platform)
		if err != nil {
			t.Fatal(err)
		}
		m := &Manager{root: t.TempDir(), platform: platform, catalog: c, settings: Settings{Layout: "koharu-768", OCR: "hayai-onnx-fp32-kv", Model: "gemma-e4b", Threads: 1}}
		seen := map[string]bool{}
		for _, a := range m.selectedArtifacts() {
			seen[a.ID] = true
		}
		verifier := m.modelForGroup("baberu-int4", "ocr")
		for _, id := range verifier.Artifacts {
			if !seen[id] {
				t.Fatalf("%s missing verifier %s", platform, id)
			}
		}
		if err = m.writeNativeConfig(); err != nil {
			t.Fatal(err)
		}
		read := func() map[string]any {
			data, err := os.ReadFile(filepath.Join(m.root, "config/native_api.json"))
			if err != nil {
				t.Fatal(err)
			}
			var cfg map[string]any
			if err = json.Unmarshal(data, &cfg); err != nil {
				t.Fatal(err)
			}
			return cfg
		}
		cfg := read()
		if cfg["ocr_backend"] != "onnx-v2-kv" || cfg["ocr_verifier_dir"] != verifier.Path || cfg["ocr_verifier_execution"] != "cpu" {
			t.Fatalf("%s wrong primary/verifier configuration", platform)
		}
		m.settings.OCR = "hayai-int8"
		if err = m.writeNativeConfig(); err != nil {
			t.Fatal(err)
		}
		if _, ok := read()["ocr_verifier_dir"]; ok {
			t.Fatal("unrelated OCR selected verifier")
		}
	}
}

func TestOCRVerifierCombinedMemoryBudget(t *testing.T) {
 for _, platform := range []string{"windows-amd64", "linux-amd64", "linux-arm64"} {
  c, err := loadCatalog(os.DirFS("../assets/bundle"), platform)
  if err != nil { t.Fatal(err) }
  m := &Manager{catalog:c, settings:Settings{Layout:"koharu-768", OCR:"hayai-onnx-fp32-kv"}}
  for _, execution := range []string{"cpu", "directml", "cuda"} {
   m.settings.OCRExecution=execution
   limit,free:=m.visionRequirements()
   if limit != 3*1024*1024*1024 || free != 4*1024*1024*1024 { t.Fatalf("%s/%s: combined OCR budget %d %d",platform,execution,limit,free) }
  }
  m.settings.Layout="koharu-1152"
  limit,free:=m.visionRequirements()
  if limit != 6*1024*1024*1024 || free != 8*1024*1024*1024 {t.Fatal("larger detector budget reduced")}
  m.settings.Layout="koharu-768";m.settings.OCR="hayai-int8"
  limit,free=m.visionRequirements()
  if limit != 1536*1024*1024 || free != 3*1024*1024*1024 {t.Fatal("unrelated OCR budget changed")}
 }
}
