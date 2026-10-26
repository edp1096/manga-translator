package control

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
)

func modelFixture(t *testing.T, root, url string) *Manager {
	t.Helper()
	catalog := Catalog{Version: Version}
	for _, spec := range []struct{ id, group string }{{"det", "layout"}, {"ocr8", "ocr"}, {"ocr4", "ocr"}, {"small", "translation"}, {"large", "translation"}} {
		a := testArtifact([]byte(spec.id), url+"/"+spec.id)
		a.ID = spec.id
		a.Group = spec.group
		a.Platform = "all"
		a.Files[0].Path = "models/" + spec.id + "/model.bin"
		catalog.Artifacts = append(catalog.Artifacts, a)
		catalog.Models = append(catalog.Models, Model{Backend: "litert", ID: spec.id, Group: spec.group, Artifacts: []string{spec.id}, Path: a.Files[0].Path})
	}
	raw, _ := json.Marshal(catalog)
	bundle := fstest.MapFS{"catalog.json": {Data: raw}, "extension/manifest.json": {Data: []byte(`{}`)}}
	m, err := NewManager(root, bundle, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatal(err)
	}
	m.platform = "linux-arm64"
	m.downloader = &Downloader{Client: http.DefaultClient, AllowHTTP: true}
	return m
}
func TestModelConsentSelectionAndDeletion(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); io.WriteString(w, r.URL.Path[1:]) }))
	defer srv.Close()
	root := t.TempDir()
	m := modelFixture(t, root, srv.URL)
	if err := m.StartInstalled(); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 || m.Snapshot().Ready {
		t.Fatal("fresh start fetched or became ready")
	}
	if err := m.BeginSetup(); err == nil {
		t.Fatal("setup accepted no model selection")
	}
	for _, id := range []string{"det", "ocr4", "large"} {
		if err := m.SelectModel(id); err != nil {
			t.Fatal(err)
		}
	}
	if err := m.StartInstalled(); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 {
		t.Fatal("startup fetched selected missing model")
	}
	if err := m.BeginSetup(); err != nil {
		t.Fatal(err)
	}
	waitSetup(t, m)
	if calls.Load() != 3 || !m.Snapshot().Ready {
		t.Fatalf("selected files only: calls=%d ready=%v", calls.Load(), m.Snapshot().Ready)
	}
	if _, err := os.Stat(filepath.Join(root, "models/ocr8/model.bin")); !os.IsNotExist(err) {
		t.Fatal("unselected OCR downloaded")
	}
	if _, err := os.Stat(filepath.Join(root, "models/small/model.bin")); !os.IsNotExist(err) {
		t.Fatal("unselected LLM downloaded")
	}
	if err := m.DeleteModel("large"); err == nil {
		t.Fatal("selected model deleted")
	}
	if err := m.DownloadModel("ocr8"); err != nil {
		t.Fatal(err)
	}
	waitSetup(t, m)
	if m.Snapshot().Settings.OCR != "ocr4" {
		t.Fatal("download switched selected model")
	}
	if err := m.SelectModel("ocr8"); err != nil {
		t.Fatal(err)
	}
	if err := m.DeleteModel("ocr4"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "models/ocr4/model.bin")); !os.IsNotExist(err) {
		t.Fatal("delete did not remove inactive model")
	}
	if err := m.DeleteModel("../../outside"); err == nil {
		t.Fatal("unknown delete accepted")
	}
	if err := m.ClearModel("large"); err != nil {
		t.Fatal(err)
	}
	m.Close()
	m = modelFixture(t, root, srv.URL)
	defer m.Close()
	before := calls.Load()
	if err := m.StartInstalled(); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != before || m.Snapshot().Settings.Model != "" {
		t.Fatal("restart downloaded or reset cleared selection")
	}
}
func TestModelDownloadDoesNotRequireOtherSelections(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); io.WriteString(w, r.URL.Path[1:]) }))
	defer srv.Close()
	m := modelFixture(t, t.TempDir(), srv.URL)
	defer m.Close()
	if err := m.DownloadModel("ocr4"); err != nil {
		t.Fatal(err)
	}
	waitSetup(t, m)
	if calls.Load() != 1 || m.Snapshot().Ready || m.Snapshot().Settings.OCR != "" {
		t.Fatal("individual download selected or fetched other models")
	}
	m.mu.Lock()
	m.busy = true
	m.mu.Unlock()
	if err := m.SelectModel("large"); err == nil {
		t.Fatal("changed model during download")
	}
	if err := m.DeleteModel("ocr4"); err == nil {
		t.Fatal("deleted model during download")
	}
}

func TestReleaseCatalogSelections(t *testing.T) {
	for _, platform := range []string{"linux-arm64", "windows-amd64"} {
		c, err := loadCatalog(os.DirFS("../assets/bundle"), platform)
		if err != nil {
			t.Fatal(err)
		}
		m := &Manager{platform: platform, catalog: c, settings: Settings{Layout: "koharu-768", OCR: "hayai-int8", Model: "gemma-e4b"}}
		seen := map[string]bool{}
		for _, a := range m.selectedArtifacts() {
			seen[a.ID] = true
			if a.ID == "gemma" {
				t.Fatal("unselected default included")
			}
		}
		for _, id := range []string{"layout", "gemma-e4b", "ocr-hayai_encoder_dynamic_wi8", "ort-" + platform, "litert-" + platform, "llama-" + platform, "engine-" + platform} {
			if !seen[id] {
				t.Fatalf("missing dependency %s", id)
			}
		}
		if platform == "windows-amd64" && !seen["vcredist-windows-amd64"] {
			t.Fatal("missing VC runtime")
		}
	}
}

func TestLegacyDefaultInstallationAndExplicitClear(t *testing.T) {
	root := t.TempDir()
	bundle := os.DirFS("../assets/bundle")
	c, err := loadCatalog(bundle, currentPlatform())
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range c.Artifacts {
		if a.ID == "gemma" {
			p := filepath.Join(root, filepath.FromSlash(a.Files[0].Path))
			os.MkdirAll(filepath.Dir(p), 0700)
			f, e := os.Create(p)
			if e != nil {
				t.Fatal(e)
			}
			if e = f.Truncate(a.Files[0].Size); e != nil {
				t.Fatal(e)
			}
			f.Close()
		}
	}
	if err := writeJSON(filepath.Join(root, "config/native_api.json"), map[string]any{"llm_model": "gemma4-e2b-local", "threads": 1}); err != nil {
		t.Fatal(err)
	}
	m, err := NewManager(root, bundle, nil)
	if err != nil {
		t.Fatal(err)
	}
	if m.settings.Model != "gemma" || m.settings.OCR != "hayai-int8" || m.settings.Layout != "koharu-768" || !m.settings.AutoStart || m.settings.Threads != 1 {
		t.Fatal("legacy defaults not preserved")
	}
	if err := m.ClearModel("gemma"); err != nil {
		t.Fatal(err)
	}
	m.Close()
	m, err = NewManager(root, bundle, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	if m.settings.Model != "" {
		t.Fatal("explicit clear treated as old defaults")
	}
	if err := m.StartInstalled(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "data/downloads")); !os.IsNotExist(err) {
		t.Fatal("startup downloaded after clear")
	}
}

func TestFP32OCRSelectsONNXRuntimeAndBackend(t *testing.T) {
	for _, platform := range []string{"linux-arm64", "windows-amd64"} {
		c, err := loadCatalog(os.DirFS("../assets/bundle"), platform)
		if err != nil {
			t.Fatal(err)
		}
		m := &Manager{root: t.TempDir(), platform: platform, catalog: c, settings: Settings{Layout: "koharu-768", OCR: "hayai-onnx-fp32-kv", Model: "gemma-e4b", Threads: 1}}
		seen := map[string]bool{}
		for _, a := range m.selectedArtifacts() {
			seen[a.ID] = true
			if a.ID == "litert-"+platform || a.Group == "ocr" && a.Files[0].Path[:7] != "models/" {
				t.Fatal("unexpected OCR dependency")
			}
		}
		if !seen["ort-"+platform] || !seen["ocr-kv-fp32-hayai_encoder_onnx_data"] || !seen["ocr-kv-fp32-hayai_decoder_kv_step_onnx"] {
			t.Fatal("incomplete FP32 model")
		}
		if m.selectedOCRBackend() != "onnx-v2-kv" {
			t.Fatal("wrong backend")
		}
		if err = m.writeNativeConfig(); err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(filepath.Join(m.root, "config/native_api.json"))
		if err != nil {
			t.Fatal(err)
		}
		var cfg map[string]any
		if err = json.Unmarshal(data, &cfg); err != nil {
			t.Fatal(err)
		}
		if cfg["ocr_backend"] != "onnx-v2-kv" || cfg["ocr_dir"] != "models/vadik82__hayai-ocr-v2-onnx/onnx" || cfg["llm_model"] != "gemma-e4b" {
			t.Fatal("selection not applied to native API")
		}
		m.settings.OCR = "hayai-int8"
		if m.selectedOCRBackend() != "litert" {
			t.Fatal("switch back to LiteRT failed")
		}
	}
}

func TestOnlyApprovedOCRChoicesAreShipped(t *testing.T) {
	c, err := loadCatalog(os.DirFS("../assets/bundle"), "linux-arm64")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, m := range c.Models {
		if m.Group == "ocr" {
			seen[m.ID] = true
		}
	}
	if len(seen) != 4 || !seen["hayai-onnx-fp32-kv"] || !seen["hayai-int8"] || !seen["baberu-int4"] || !seen["baberu-fp16"] {
		t.Fatalf("unexpected OCR choices: %v", seen)
	}
	for _, a := range c.Artifacts {
		if strings.Contains(a.ID, "wi4") || strings.Contains(a.URL, "dynamic_wi4") {
			t.Fatal("excluded INT4 download still shipped")
		}
	}
}

func TestOriginalKoharuUsesItsOwnMemoryBudget(t *testing.T) {
	c, err := loadCatalog(os.DirFS("../assets/bundle"), "linux-arm64")
	if err != nil {
		t.Fatal(err)
	}
	m := &Manager{catalog: c, settings: Settings{Layout: "koharu-1152"}}
	limit, free := m.visionRequirements()
	if limit != 6*1024*1024*1024 || free != 8*1024*1024*1024 {
		t.Fatal("original layout budget incorrect")
	}
	original := m.modelForGroup("koharu-1152", "layout")
	if original == nil || original.InputSize != 1152 {
		t.Fatal("missing original model")
	}
	m.settings.Layout = "koharu-768"
	limit, free = m.visionRequirements()
	if limit != 1536*1024*1024 || free != 3*1024*1024*1024 {
		t.Fatal("lightweight protection changed")
	}
}

func TestSharedModelWeightsSurviveOtherVariantDeletion(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, r.URL.Path[1:]) }))
	defer srv.Close()
	m := modelFixture(t, t.TempDir(), srv.URL)
	defer m.Close()
	shared := testArtifact([]byte("shared"), srv.URL+"/shared")
	shared.ID = "shared"
	shared.Group = "ocr"
	shared.Platform = "all"
	shared.Files[0].Path = "models/shared.bin"
	m.catalog.Artifacts = append(m.catalog.Artifacts, shared)
	for i := range m.catalog.Models {
		if m.catalog.Models[i].Group == "ocr" {
			m.catalog.Models[i].Artifacts = append(m.catalog.Models[i].Artifacts, "shared")
		}
	}
	for _, id := range []string{"ocr8", "ocr4"} {
		if err := m.DownloadModel(id); err != nil {
			t.Fatal(err)
		}
		waitSetup(t, m)
	}
	if err := m.SelectModel("ocr4"); err != nil {
		t.Fatal(err)
	}
	if err := m.DeleteModel("ocr8"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(m.root, "models/shared.bin")); err != nil {
		t.Fatal("removed shared decoder", err)
	}
	if _, err := os.Stat(filepath.Join(m.root, "models/ocr8/model.bin")); !os.IsNotExist(err) {
		t.Fatal("deleted model's own encoder remains")
	}
	for _, s := range m.modelStates() {
		if s.ID == "ocr4" && !s.Installed {
			t.Fatal("remaining variant is no longer installed")
		}
	}
	if err := m.ClearModel("ocr4"); err != nil {
		t.Fatal(err)
	}
	if err := m.DeleteModel("ocr4"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(m.root, "models/shared.bin")); !os.IsNotExist(err) {
		t.Fatal("last variant did not remove unused shared files")
	}
}

func TestBaberuCatalogAndNativeConfiguration(t *testing.T) {
	for _, platform := range []string{"linux-arm64", "linux-amd64", "windows-amd64"} {
		catalog, err := loadCatalog(os.DirFS("../assets/bundle"), platform)
		if err != nil {
			t.Fatal(err)
		}
		m := &Manager{root: t.TempDir(), platform: platform, catalog: catalog, settings: Settings{Layout: "koharu-768", OCR: "baberu-int4", Model: "gemma", Threads: 4}}
		for _, tier := range []string{"int4", "fp16"} {
			m.settings.OCR = "baberu-" + tier
			if err := m.writeNativeConfig(); err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(filepath.Join(m.root, "config/native_api.json"))
			if err != nil {
				t.Fatal(err)
			}
			var cfg map[string]any
			if err = json.Unmarshal(raw, &cfg); err != nil {
				t.Fatal(err)
			}
			if cfg["ocr_backend"] != "baberu-"+tier || cfg["ocr_dir"] != "models/genshiai-daichi__baberu-ocr" {
				t.Fatalf("bad config: %v", cfg)
			}
			foundVision, foundDecoder, foundLicense := false, false, false
			for _, a := range m.selectedArtifacts() {
				for _, f := range a.Files {
					if strings.Contains(f.Path, "baberu-ocr/") {
						if strings.HasSuffix(f.Path, "vision_"+tier+".onnx") {
							foundVision = true
						}
						if strings.HasSuffix(f.Path, "decoder_step_int8.onnx") {
							foundDecoder = true
						}
						if strings.HasSuffix(f.Path, "/LICENSE") {
							foundLicense = true
						}
						if strings.Contains(f.Path, "vision_") && !strings.HasSuffix(f.Path, "vision_"+tier+".onnx") {
							t.Fatal("downloaded another variant's encoder")
						}
					}
				}
			}
			if !foundVision || !foundDecoder || !foundLicense {
				t.Fatal("incomplete Baberu artifacts")
			}
			if validateOCRExecution(m.modelByID(m.settings.OCR), "cuda") != nil || validateOCRExecution(m.modelByID(m.settings.OCR), "cpu") != nil {
				t.Fatal("supported backend rejected")
			}
			if validateOCRExecution(m.modelByID(m.settings.OCR), "directml") == nil {
				t.Fatal("unverified DirectML enabled")
			}
		}
	}
}

func TestBaberuGPUHasCombinedPipelineMemoryBudget(t *testing.T) {
	c, err := loadCatalog(os.DirFS("../assets/bundle"), "linux-arm64")
	if err != nil {
		t.Fatal(err)
	}
	m := &Manager{catalog: c, settings: Settings{Layout: "koharu-768", OCR: "baberu-fp16"}}
	limit, free := m.visionRequirements()
	if limit != 1536*1024*1024 || free != 3*1024*1024*1024 {
		t.Fatal("CPU budget changed")
	}
	m.settings.OCRExecution = "cuda"
	limit, free = m.visionRequirements()
	if limit != 3*1024*1024*1024 || free != 4*1024*1024*1024 {
		t.Fatal("GPU decoder/encoder pipeline budget missing")
	}
	m.settings.Layout = "koharu-1152"
	limit, free = m.visionRequirements()
	if limit != 6*1024*1024*1024 || free != 8*1024*1024*1024 {
		t.Fatal("larger layout budget reduced")
	}
}
