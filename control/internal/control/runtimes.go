package control

import (
	"fmt"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

// Runtime describes the installed files independently of the upstream archive
// layout. Versions, executables and library directories live only in the catalog.
type Runtime struct {
	ID                  string   `json:"id"`
	Version             string   `json:"version"`
	Platform            string   `json:"platform"`
	Artifact            string   `json:"artifact"`
	ReleaseURL          string   `json:"releaseUrl"`
	BuildTag            string   `json:"buildTag,omitempty"`
	Executable          string   `json:"executable,omitempty"`
	Library             string   `json:"library,omitempty"`
	LibraryDirs         []string `json:"libraryDirs"`
	Family              string   `json:"family,omitempty"`
	Backend             string   `json:"backend,omitempty"`
	AdditionalArtifacts []string `json:"additionalArtifacts,omitempty"`
}

func (r Runtime) artifactIDs() []string {
	return append([]string{r.Artifact}, r.AdditionalArtifacts...)
}
func (m *Manager) runtimeForSettings(family string, settings Settings) *Runtime {
	id := family
	switch family {
	case "llama":
		if backend := execution(settings.LLMExecution); backend != "cpu" {
			id = "llama-" + backend
		}
	case "ort":
		backend := execution(settings.LayoutExecution)
		if model := m.modelByID(settings.OCR); model != nil && model.Backend != "litert" && execution(settings.OCRExecution) != "cpu" {
			backend = settings.OCRExecution
		}
		if backend != "cpu" {
			id = "ort-" + backend
		}
	}
	return m.runtimeByID(id)
}
func (m *Manager) runtimeArtifacts(r Runtime) []Artifact {
	wanted := map[string]bool{}
	for _, id := range r.artifactIDs() {
		wanted[id] = true
	}
	var result []Artifact
	for _, a := range m.catalog.Artifacts {
		if wanted[a.ID] {
			result = append(result, a)
		}
	}
	return result
}

var runtimeVersion = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+$`)

func loadRuntimes(c *Catalog, all []Runtime, platform string) error {
	seen := map[string]bool{}
	for _, r := range all {
		if r.Platform != platform {
			continue
		}
		if !identifier.MatchString(r.ID) || seen[r.ID] || !runtimeVersion.MatchString(r.Version) || !strings.HasPrefix(r.ReleaseURL, "https://") || len(r.LibraryDirs) == 0 {
			return fmt.Errorf("invalid runtime %q", r.ID)
		}
		seen[r.ID] = true
		var artifact *Artifact
		for i := range c.Artifacts {
			if c.Artifacts[i].ID == r.Artifact && c.Artifacts[i].Group == "runtime" {
				artifact = &c.Artifacts[i]
			}
		}
		if artifact == nil {
			return fmt.Errorf("runtime %s references missing artifact %s", r.ID, r.Artifact)
		}
		files := append([]OutputFile{}, artifact.Files...)
		additional := map[string]bool{r.Artifact: true}
		for _, id := range r.AdditionalArtifacts {
			if additional[id] {
				return fmt.Errorf("duplicate runtime artifact %s", id)
			}
			additional[id] = true
			found := false
			for _, a := range c.Artifacts {
				if a.ID == id && a.Group == "runtime" {
					files = append(files, a.Files...)
					found = true
				}
			}
			if !found {
				return fmt.Errorf("runtime %s references missing artifact %s", r.ID, id)
			}
		}
		for _, target := range []string{r.Executable, r.Library} {
			if target == "" {
				continue
			}
			found := false
			for _, f := range files {
				if f.Path == target && (target != r.Executable || f.Executable) {
					found = true
				}
			}
			if !found {
				return fmt.Errorf("runtime %s references missing output %s", r.ID, target)
			}
		}
		for _, dir := range r.LibraryDirs {
			if _, err := safeRelative(dir); err != nil {
				return err
			}
			found := false
			for _, f := range files {
				if path.Dir(f.Path) == dir {
					found = true
				}
			}
			if !found {
				return fmt.Errorf("runtime %s has no installed files in %s", r.ID, dir)
			}
		}
		if r.ID == "llama" && r.Executable == "" || r.ID == "litert" && r.Library == "" {
			return fmt.Errorf("runtime %s has no entry point", r.ID)
		}
		c.Runtimes = append(c.Runtimes, r)
	}
	if supportedPlatform(platform) {
		for _, model := range c.Models {
			for _, dependency := range model.Dependencies {
				if dependency == "vcredist" {
					if platform == "windows-amd64" {
						found := false
						for _, a := range c.Artifacts {
							found = found || a.ID == dependency+"-"+platform
						}
						if !found {
							return fmt.Errorf("missing Visual C++ runtime")
						}
					}
					continue
				}
				if !seen[dependency] {
					return fmt.Errorf("model %s references missing runtime %s", model.ID, dependency)
				}
			}
		}
	}
	return nil
}

func (m *Manager) runtimeByID(id string) *Runtime {
	for i := range m.catalog.Runtimes {
		if m.catalog.Runtimes[i].ID == id {
			return &m.catalog.Runtimes[i]
		}
	}
	return nil
}

func (m *Manager) runtimeExecutable(id string) (string, error) {
	r := m.runtimeByID(id)
	if r == nil || r.Executable == "" {
		return "", fmt.Errorf("missing executable metadata for runtime %s", id)
	}
	return safeDestination(m.root, r.Executable)
}

func (m *Manager) runtimeLibraryDirs(service string) ([]string, error) {
	ids := []string{"llama"}
	if service == "vision" {
		ids = []string{"ort"}
		if m.selectedOCRBackend() == "litert" {
			ids = append(ids, "litert")
		}
	} else if service != "llm" {
		return nil, fmt.Errorf("unknown service %s", service)
	}
	m.mu.Lock()
	settings := m.settings
	m.mu.Unlock()
	if service == "vision" && settings.RestorationBackend == "libtorch" {
		ids = append(ids, "torch-cuda")
	}
	dirs := []string{}
	seen := map[string]bool{}
	for _, id := range ids {
		r := m.runtimeForSettings(id, settings)
		if r == nil {
			return nil, fmt.Errorf("missing runtime metadata for %s", id)
		}
		for _, dir := range r.LibraryDirs {
			absolute, err := safeDestination(m.root, dir)
			if err != nil {
				return nil, err
			}
			if !seen[absolute] {
				seen[absolute] = true
				dirs = append(dirs, absolute)
			}
		}
	}
	if m.platform == "windows-amd64" && execution(settings.LLMExecution) != "cpu" {
		dirs = append(dirs, filepath.Join(m.root, "bin"))
	}
	return dirs, nil
}

func prerequisiteFiles(artifacts []Artifact) []OutputFile {
	var files []OutputFile
	for _, a := range artifacts {
		if a.Format == "msvc-cab" {
			files = append(files, a.Files...)
		}
	}
	return files
}

// Replace inherited loader settings rather than mixing old/system runtimes into
// the selected runtime. Preserve ordinary OS variables (including Windows PATH).
func replaceEnvironment(env []string, values map[string]string) []string {
	result := make([]string, 0, len(env)+len(values))
	for _, entry := range env {
		key, _, _ := strings.Cut(entry, "=")
		replaced := false
		for name := range values {
			if strings.EqualFold(key, name) {
				replaced = true
				break
			}
		}
		if !replaced {
			result = append(result, entry)
		}
	}
	for key, value := range values {
		result = append(result, key+"="+value)
	}
	return result
}

func portableEnvironment(root string) map[string]string {
	return map[string]string{
		"ORT_DISABLE_TELEMETRY":       "1",
		"CUDA_CACHE_PATH":             filepath.Join(root, "data", "cache", "cuda"),
		"__GL_SHADER_DISK_CACHE_PATH": filepath.Join(root, "data", "cache", "shaders"),
		"LLAMA_CACHE":                 filepath.Join(root, "data", "cache", "llama"),
	}
}
