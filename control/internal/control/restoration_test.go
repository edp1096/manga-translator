package control

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestRestorationPortableInstallation(t *testing.T) {
	for _, platform := range []string{"linux-arm64", "linux-amd64", "windows-amd64"} {
		t.Run(platform, func(t *testing.T) {
			c, err := loadCatalog(os.DirFS("../assets/bundle"), platform)
			if err != nil {
				t.Fatal(err)
			}
			m := &Manager{root: t.TempDir(), platform: platform, catalog: c, settings: Settings{Layout: "koharu-768", OCR: "hayai-int8", Model: "gemma", Threads: 1}}
			model := m.modelForGroup("manga-lama", "restoration")
			if model == nil {
				t.Fatal("restoration missing from installer")
			}
			artifacts := m.artifactsFor([]string{model.ID}, false)
			seen := map[string]bool{}
			for _, a := range artifacts {
				seen[a.ID] = true
			}
			if !seen["manga-lama"] || !seen["ort-"+platform] {
				t.Fatal("missing model/runtime", seen)
			}
			if platform == "windows-amd64" && !seen["vcredist-windows-amd64"] {
				t.Fatal("missing Windows runtime")
			}
			before := m.settings
			if m.SelectModel(model.ID) == nil || m.settings != before {
				t.Fatal("optional restoration changed translation selection")
			}
			for _, a := range m.selectedArtifacts() {
				if a.Group == "restoration" {
					t.Fatal("ordinary translation now requires optional model")
				}
			}
			for _, s := range m.modelStates() {
				if s.ID == model.ID && (s.Installed || s.Selected || s.DownloadSize == 0) {
					t.Fatal("fresh installation falsely reports ready", s)
				}
			}
		})
	}
}

// Optional real-artifact verification uses a previously downloaded, pinned source.
func TestRestorationConversionArtifact(t *testing.T) {
	source := os.Getenv("MANGA_LAMA_TEST_SOURCE")
	if source == "" {
		t.Skip("set MANGA_LAMA_TEST_SOURCE to verify the real conversion")
	}
	bundle := os.DirFS("../assets/bundle")
	c, err := loadCatalog(bundle, "linux-arm64")
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range c.Artifacts {
		if a.ID != "manga-lama" {
			continue
		}
		sum, err := hashFile(source)
		if err != nil || sum != a.SHA256 {
			t.Fatal("source checksum", sum, err)
		}
		root := t.TempDir()
		if err := installArtifact(context.Background(), root, a, source, bundle); err != nil {
			t.Fatal(err)
		}
		for _, f := range a.Files {
			sum, err := hashFile(filepath.Join(root, filepath.FromSlash(f.Path)))
			if err != nil || sum != f.SHA256 {
				t.Fatal("installed checksum", sum, err)
			}
		}
		return
	}
	t.Fatal("missing restoration artifact")
}

func TestOptionalRestorationModelConfig(t *testing.T) {
	c, err := loadCatalog(catalogFS(t, releaseCatalog(t)), "windows-amd64")
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	m := &Manager{catalog: c, platform: "windows-amd64", root: root, settings: Settings{Layout: "koharu-768", OCR: "hayai-onnx-fp32-kv", Model: "gemma-e4b", Threads: 2}}
	model := filepath.Join(root, "models", "manga-lama", "manga-lama-512.onnx")
	for _, present := range []bool{false, true, false} {
		if present {
			if err = os.MkdirAll(filepath.Dir(model), 0755); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(model, []byte("fixture"), 0644); err != nil {
				t.Fatal(err)
			}
		} else {
			os.Remove(model)
		}
		if err = m.writeNativeConfig(); err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(filepath.Join(root, "config", "native_api.json"))
		if err != nil {
			t.Fatal(err)
		}
		var config map[string]any
		if err = json.Unmarshal(raw, &config); err != nil {
			t.Fatal(err)
		}
		_, included := config["inpaint_model"]
		if included != present {
			t.Fatal("optional model presence not respected", config)
		}
		if present && (config["inpaint_model"] != "models/manga-lama/manga-lama-512.onnx" || config["inpaint_execution"] != "cpu") {
			t.Fatal(config)
		}
		if config["layout_model"] == "" || config["ocr_backend"] == "" {
			t.Fatal("ordinary translation changed")
		}
	}
}
