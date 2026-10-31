package control

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

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
