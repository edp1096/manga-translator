package control

import (
	"fmt"
	"os"
	"path/filepath"
)

type ModelState struct {
	DownloadSize int64 `json:"downloadSize"`
	Model
	Size      int64 `json:"size"`
	Installed bool  `json:"installed"`
	Present   bool  `json:"present"`
	Selected  bool  `json:"selected"`
}

func (m *Manager) modelByID(id string) *Model {
	for _, model := range m.catalog.Models {
		if model.ID == id {
			return &model
		}
	}
	return nil
}
func (m *Manager) modelForGroup(id, group string) *Model {
	model := m.modelByID(id)
	if model != nil && model.Group == group {
		return model
	}
	return nil
}
func selection(s Settings, group string) string {
	switch group {
	case "layout":
		return s.Layout
	case "ocr":
		return s.OCR
	case "restoration":
		return "" // Optional restoration is enabled by installation, not selection.
	default:
		return s.Model
	}
}
func (m *Manager) selectedPath(group string) string {
	m.mu.Lock()
	id := selection(m.settings, group)
	m.mu.Unlock()
	if model := m.modelForGroup(id, group); model != nil {
		return model.Path
	}
	return ""
}
func (m *Manager) hasSelection() bool {
	m.mu.Lock()
	s := m.settings
	m.mu.Unlock()
	return m.hasSelectionForSettings(s)
}
func (m *Manager) hasSelectionForSettings(s Settings) bool {
	return len(m.catalog.Models) == 0 || (m.modelForGroup(s.Model, "translation") != nil && m.modelForGroup(s.Layout, "layout") != nil && m.modelForGroup(s.OCR, "ocr") != nil)
}
func (m *Manager) selectedArtifacts() []Artifact {
	m.mu.Lock()
	s := m.settings
	m.mu.Unlock()
	return m.selectedArtifactsForSettings(s)
}
func (m *Manager) selectedArtifactsForSettings(s Settings) []Artifact {
	if len(m.catalog.Models) == 0 {
		return m.catalog.Artifacts
	}
	ids := []string{s.Layout, s.OCR, s.Model}
	if s.RestorationBackend == "libtorch" {
		ids = append(ids, "manga-lama-torch")
	}
	return m.artifactsForSettings(ids, true, s)
}
func (m *Manager) artifactsFor(ids []string, application bool) []Artifact {
	m.mu.Lock()
	s := m.settings
	m.mu.Unlock()
	return m.artifactsForSettings(ids, application, s)
}
func (m *Manager) artifactsForSettings(ids []string, application bool, settings Settings) []Artifact {
	wanted := map[string]bool{}
	for _, id := range ids {
		model := m.modelByID(id)
		if model == nil {
			continue
		}
		for _, a := range model.Artifacts {
			wanted[a] = true
		}
		for _, dependency := range model.Dependencies {
			if r := m.runtimeForSettings(dependency, settings); r != nil {
				for _, artifactID := range r.artifactIDs() {
					wanted[artifactID] = true
				}
			} else {
				wanted[dependency+"-"+m.platform] = true
			}
		}
	}
	result := []Artifact{}
	for _, a := range m.catalog.Artifacts {
		if wanted[a.ID] || (application && a.Group == "application") {
			result = append(result, a)
		}
	}
	return result
}
func (m *Manager) modelStates() []ModelState {
	m.mu.Lock()
	settings := m.settings
	m.mu.Unlock()
	return m.modelStatesForSettings(settings)
}
func (m *Manager) modelStatesForSettings(settings Settings) []ModelState {
	result := []ModelState{}
	for _, model := range m.catalog.Models {
		state := ModelState{Model: model, Installed: true, Selected: selection(settings, model.Group) == model.ID || (model.ID == "manga-lama-torch" && settings.RestorationBackend == "libtorch")}
		for _, a := range m.artifactsForSettings([]string{model.ID}, false, settings) {
			if !m.artifactReady(a) && !isEmbedded(a) {
				state.DownloadSize += a.Size
			}
			if a.Group == "runtime" {
				continue
			}
			state.Size += a.Size
			if !m.artifactReady(a) {
				state.Installed = false
			}
			for _, f := range a.Files {
				p, err := safeDestination(m.root, f.Path)
				if err == nil {
					if _, err = os.Lstat(p); err == nil {
						state.Present = true
					}
				}
			}
			p, err := safeDestination(m.root, "data/downloads/"+a.ID+"-"+a.SHA256[:12]+".download.partial")
			if err == nil {
				if _, err = os.Stat(p); err == nil {
					state.Present = true
				}
			}
		}
		result = append(result, state)
	}
	return result
}

// Startup never downloads or repairs anything. Only explicitly requested setup
// may fetch files; incomplete or interrupted installations await user input.
func (m *Manager) StartInstalled() error {
	if !m.hasSelection() {
		return nil
	}
	m.operation.Lock()
	for _, a := range m.selectedArtifacts() {
		ready, err := m.verifyExisting(m.ctx, a)
		if err != nil {
			m.operation.Unlock()
			return err
		}
		if !ready {
			m.operation.Unlock()
			return nil
		}
	}
	err := m.saveReceipts()
	m.operation.Unlock()
	if err != nil {
		return err
	}
	m.mu.Lock()
	auto := m.settings.AutoStart
	m.phase = "ready"
	m.mu.Unlock()
	if auto {
		return m.Start()
	}
	return nil
}

func (m *Manager) SelectModel(id string) error {
	model := m.modelByID(id)
	if model == nil {
		return fmt.Errorf("알 수 없는 모델입니다")
	}
	if model.Group == "restoration" {
		return fmt.Errorf("복원 모델은 다운로드하면 사용할 수 있습니다")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.busy || len(m.processes) > 0 {
		return fmt.Errorf("API를 중지한 뒤 모델을 바꾸세요")
	}
	settings := m.settings
	settings.Profile = "custom"
	switch model.Group {
	case "layout":
		settings.Layout = id
	case "ocr":
		if err := validateOCRExecution(model, execution(settings.OCRExecution)); err != nil {
			return err
		}
		settings.OCR = id
	default:
		settings.Model = id
	}
	if err := writeJSON(filepath.Join(m.root, "config", "control.json"), settings); err != nil {
		return err
	}
	m.settings = settings
	m.lastError = ""
	m.phase = "idle"
	m.progress = Progress{}
	return nil
}

func (m *Manager) DeleteModel(id string) error {
	model := m.modelByID(id)
	if model == nil {
		return fmt.Errorf("알 수 없는 모델입니다")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.busy || len(m.processes) > 0 {
		return fmt.Errorf("API와 다운로드를 중지한 뒤 모델을 삭제하세요")
	}
	if id == selection(m.settings, model.Group) || (id == "manga-lama-torch" && m.settings.RestorationBackend == "libtorch") {
		return fmt.Errorf("모델 선택을 해제하거나 다른 모델을 선택한 뒤 삭제하세요")
	}
	keep := m.sharedModelArtifacts(model)
	for _, a := range m.artifactsForSettings([]string{id}, false, m.settings) {
		if a.Group == "runtime" || keep[a.ID] {
			continue
		}
		for _, f := range a.Files {
			p, err := safeDestination(m.root, f.Path)
			if err != nil {
				return err
			}
			if err = os.Remove(p); err != nil && !os.IsNotExist(err) {
				return err
			}
			delete(m.receipts, f.Path)
		}
		for _, suffix := range []string{".download", ".download.partial"} {
			p, err := safeDestination(m.root, "data/downloads/"+a.ID+"-"+a.SHA256[:12]+suffix)
			if err != nil {
				return err
			}
			if err = os.Remove(p); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	return writeJSON(filepath.Join(m.root, "data", "install-state.json"), m.receipts)
}

func (m *Manager) ClearModel(id string) error {
	model := m.modelByID(id)
	if model == nil {
		return fmt.Errorf("알 수 없는 모델입니다")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.busy || len(m.processes) > 0 {
		return fmt.Errorf("API를 중지한 뒤 선택을 해제하세요")
	}
	if selection(m.settings, model.Group) != id {
		return nil
	}
	settings := m.settings
	settings.Profile = "custom"
	switch model.Group {
	case "layout":
		settings.Layout = ""
	case "ocr":
		settings.OCR = ""
	default:
		settings.Model = ""
	}
	if err := writeJSON(filepath.Join(m.root, "config", "control.json"), settings); err != nil {
		return err
	}
	m.settings = settings
	m.phase = "idle"
	m.lastError = ""
	return nil
}

func (m *Manager) selectedOCRBackend() string {
	m.mu.Lock()
	id := m.settings.OCR
	m.mu.Unlock()
	if model := m.modelForGroup(id, "ocr"); model != nil {
		return model.Backend
	}
	return ""
}

func (m *Manager) visionRequirements() (int64, int64) {
	m.mu.Lock()
	settings := m.settings
	m.mu.Unlock()
	limit, available := int64(1536*1024*1024), int64(3*1024*1024*1024)
	if model := m.modelForGroup(settings.Layout, "layout"); model != nil && model.VisionLimitMiB > 0 && model.MinAvailableMiB > 0 {
		limit, available = int64(model.VisionLimitMiB)*1024*1024, int64(model.MinAvailableMiB)*1024*1024
	}
	// CUDA layout resources can remain resident while Baberu's CPU decoder runs.
	// The actual combined pipeline exceeds the standalone OCR RSS measurement.
	if model := m.modelForGroup(settings.OCR, "ocr"); model != nil && (model.Backend == "baberu-int4" || model.Backend == "baberu-fp16") && (execution(settings.LayoutExecution) != "cpu" || execution(settings.OCRExecution) != "cpu") {
		limit = max(limit, 3*1024*1024*1024)
		available = max(available, 4*1024*1024*1024)
	}
	// The KV OCR pipeline also loads an independent CPU verifier for uncertain
	// glyphs and restoration. Budget both models, even when the primary uses
	// DirectML/CUDA; GPU execution does not eliminate their host allocations.
	if model := m.modelForGroup(settings.OCR, "ocr"); model != nil && model.Backend == "onnx-v2-kv" && m.modelForGroup("baberu-int4", "ocr") != nil {
		limit = max(limit, 3*1024*1024*1024)
		available = max(available, 4*1024*1024*1024)
	}
	if settings.RestorationBackend == "libtorch" {
		limit += 1536 * 1024 * 1024
		available += 2 * 1024 * 1024 * 1024
	}
	return limit, available
}

// Called under m.mu. Keep shared files while another model is selected or has
// its own model-specific weights on disk; deleting the last variant removes them.
func (m *Manager) sharedModelArtifacts(deleting *Model) map[string]bool {
	own := map[string]bool{}
	for _, id := range deleting.Artifacts {
		own[id] = true
	}
	keep := map[string]bool{}
	for _, other := range m.catalog.Models {
		if other.ID == deleting.ID {
			continue
		}
		present := selection(m.settings, other.Group) == other.ID
		for _, a := range m.artifactsForSettings([]string{other.ID}, false, m.settings) {
			if a.Group == "runtime" || own[a.ID] {
				continue
			}
			for _, f := range a.Files {
				if p, err := safeDestination(m.root, f.Path); err == nil {
					if _, err = os.Lstat(p); err == nil {
						present = true
					}
				}
			}
		}
		if present {
			for _, id := range other.Artifacts {
				keep[id] = true
			}
		}
	}
	return keep
}
