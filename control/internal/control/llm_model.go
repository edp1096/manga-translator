package control

import "fmt"

// Options belong to the selected model. Ordinary models retain their arguments.
type LLMModelOptions struct {
	FlashAttention map[string]string `json:"flashAttention,omitempty"`
	DraftPath      string            `json:"draftPath,omitempty"`
	DraftTokens    int               `json:"draftTokens,omitempty"`
	DraftBackend   string            `json:"draftBackend,omitempty"`
}

func validateLLMModel(model Model, artifacts []Artifact) error {
	o := model.LLM
	if o == nil {
		return nil
	}
	if model.Group != "translation" {
		return fmt.Errorf("LLM options on non-translation model %s", model.ID)
	}
	validBackend := func(s string) bool { return s == "cpu" || s == "vulkan" || s == "cuda" }
	for backend, mode := range o.FlashAttention {
		if !validBackend(backend) || (mode != "on" && mode != "off" && mode != "auto") {
			return fmt.Errorf("invalid flash attention option for %s", model.ID)
		}
	}
	if o.DraftPath == "" && o.DraftTokens == 0 && o.DraftBackend == "" {
		return nil
	}
	if _, err := safeRelative(o.DraftPath); err != nil {
		return err
	}
	if o.DraftPath == model.Path || o.DraftTokens < 1 || o.DraftTokens > 8 || !validBackend(o.DraftBackend) {
		return fmt.Errorf("invalid draft model options for %s", model.ID)
	}
	for _, id := range model.Artifacts {
		for _, a := range artifacts {
			if a.ID != id {
				continue
			}
			for _, f := range a.Files {
				if f.Path == o.DraftPath {
					return nil
				}
			}
		}
	}
	return fmt.Errorf("draft path is not a selected model artifact: %s", model.ID)
}

func (m *Manager) llmModelArgs(args []string, model Model, backend string) ([]string, error) {
	args = append([]string(nil), args...)
	o := model.LLM
	if o == nil {
		return args, nil
	}
	if mode := o.FlashAttention[execution(backend)]; mode != "" {
		for i := 0; i+1 < len(args); i++ {
			if args[i] == "--flash-attn" {
				args[i+1] = mode
			}
		}
	}
	if o.DraftPath == "" || o.DraftBackend != execution(backend) {
		return args, nil
	}
	path, err := safeDestination(m.root, o.DraftPath)
	if err != nil {
		return nil, err
	}
	device, layers := "none", "0"
	if backend == "cuda" {
		device, layers = "CUDA0", "999"
	} else if backend == "vulkan" {
		device, layers = "Vulkan0", "999"
	}
	return append(args, "--model-draft", path, "--spec-type", "draft-mtp", "--spec-draft-n-max", fmt.Sprint(o.DraftTokens), "--device-draft", device, "--gpu-layers-draft", layers), nil
}
