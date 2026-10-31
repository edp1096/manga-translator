package control

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestQATModelOptionsAndArtifacts(t *testing.T) {
	for _, platform := range []string{"windows-amd64", "linux-amd64", "linux-arm64"} {
		c, err := loadCatalog(catalogFS(t, releaseCatalog(t)), platform)
		if err != nil {
			t.Fatal(err)
		}
		m := &Manager{catalog: c, platform: platform, root: t.TempDir()}
		model := m.modelByID("gemma-12b-qat")
		if model == nil || model.LLM == nil {
			t.Fatal("missing selectable QAT model", platform)
		}
		for _, backend := range []string{"cpu", "vulkan", "cuda"} {
			s := Settings{Model: model.ID, LLMExecution: backend}
			ids := map[string]bool{}
			for _, a := range m.artifactsForSettings([]string{model.ID}, false, s) {
				ids[a.ID] = true
			}
			if !ids["gemma-12b-qat"] || !ids["gemma-12b-mtp"] || ids["gemma"] || ids["gemma-e4b"] {
				t.Fatal(ids)
			}
			base := []string{"-m", model.Path, "--flash-attn", "off"}
			args, err := m.llmModelArgs(base, *model, backend)
			if err != nil || !reflect.DeepEqual(base, []string{"-m", model.Path, "--flash-attn", "off"}) {
				t.Fatal(args, err, base)
			}
			text := strings.Join(args, " ")
			mode := map[string]string{"cpu": "off", "vulkan": "auto", "cuda": "on"}[backend]
			if !strings.Contains(text, "--flash-attn "+mode) {
				t.Fatal(text)
			}
			if backend == "cuda" {
				for _, required := range []string{"--model-draft " + filepath.Join(m.root, filepath.FromSlash(model.LLM.DraftPath)), "--spec-type draft-mtp", "--spec-draft-n-max 4", "--device-draft CUDA0", "--gpu-layers-draft 999"} {
					if !strings.Contains(text, required) {
						t.Fatal(text, required)
					}
				}
			} else if strings.Contains(text, "draft") || strings.Contains(text, "CUDA") {
				t.Fatal("CUDA draft options leaked to another backend", text)
			}
		}
		for _, id := range []string{"gemma", "gemma-e4b"} {
			base := []string{"--flash-attn", "off"}
			args, err := m.llmModelArgs(base, *m.modelByID(id), "cuda")
			if err != nil || !reflect.DeepEqual(args, base) {
				t.Fatal("existing model changed", id, args, err)
			}
		}
	}
}

func TestRejectInvalidDraftModelCatalog(t *testing.T) {
	for _, edit := range []func(*Model){
		func(m *Model) { m.LLM.DraftPath = "../outside.gguf" },
		func(m *Model) { m.LLM.DraftPath = "/outside.gguf" },
		func(m *Model) { m.LLM.DraftPath = m.Path },
		func(m *Model) { m.LLM.DraftPath = "models/not-downloaded.gguf" },
		func(m *Model) { m.LLM.DraftTokens = 0 },
		func(m *Model) { m.LLM.DraftTokens = 999 },
		func(m *Model) { m.LLM.DraftBackend = "unknown" },
		func(m *Model) { m.LLM.FlashAttention["cuda"] = "unknown" },
		func(m *Model) { m.LLM.FlashAttention["unknown"] = "on" },
	} {
		c := releaseCatalog(t)
		for i := range c.Models {
			if c.Models[i].ID == "gemma-12b-qat" {
				edit(&c.Models[i])
			}
		}
		if _, err := loadCatalog(catalogFS(t, c), "windows-amd64"); err == nil {
			raw, _ := json.Marshal(c.Models)
			t.Fatal("invalid draft options accepted", string(raw))
		}
	}
}
