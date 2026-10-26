package control

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

type RuntimeState struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Version    string `json:"version"`
	Backend    string `json:"backend"`
	Installed  bool   `json:"installed"`
	Present    bool   `json:"present"`
	Required   bool   `json:"required"`
	Removable  bool   `json:"removable"`
	DiskBytes  int64  `json:"diskBytes"`
	LegacyRoot string `json:"legacyRoot,omitempty"`
}

func (m *Manager) requiredRuntimeIDs(settings Settings) map[string]bool {
	result := map[string]bool{}
	for _, id := range []string{settings.Layout, settings.OCR, settings.Model} {
		if model := m.modelByID(id); model != nil {
			for _, family := range model.Dependencies {
				if r := m.runtimeForSettings(family, settings); r != nil {
					result[r.ID] = true
				}
			}
		}
	}
	return result
}

func (m *Manager) runtimeFilePaths(r Runtime) []OutputFile {
	var files []OutputFile
	for _, a := range m.runtimeArtifacts(r) {
		files = append(files, a.Files...)
	}
	return files
}

func (m *Manager) runtimeFilesExist(r Runtime) bool {
	files := m.runtimeFilePaths(r)
	if len(files) == 0 {
		return false
	}
	for _, f := range files {
		p, err := safeDestination(m.root, f.Path)
		if err != nil {
			return false
		}
		if st, err := os.Stat(p); err != nil || st.Size() != f.Size {
			return false
		}
	}
	return true
}

func (m *Manager) protectedRuntimeFiles(id string, settings Settings) map[string]bool {
	protected := map[string]bool{}
	for _, a := range m.artifactsForSettings([]string{settings.Layout, settings.OCR, settings.Model}, true, settings) {
		for _, f := range a.Files {
			protected[f.Path] = true
		}
	}
	for _, r := range m.catalog.Runtimes {
		if r.ID != id && m.runtimeFilesExist(r) {
			for _, f := range m.runtimeFilePaths(r) {
				protected[f.Path] = true
			}
		}
	}
	return protected
}

// Receipts identify old runtime folders. Never offer model/data folders or
// folders that still contain any current catalog output as legacy runtimes.
func (m *Manager) legacyRuntimeStates(receipts map[string]Receipt) []RuntimeState {
	current := map[string]bool{}
	for _, a := range m.catalog.Artifacts {
		for _, f := range a.Files {
			parts := strings.Split(f.Path, "/")
			if len(parts) > 2 && parts[0] == "runtime" {
				current[parts[1]] = true
			}
		}
	}
	roots := map[string]bool{}
	for name, receipt := range receipts {
		if _, err := safeRelative(name); err != nil || !checksum.MatchString(receipt.SHA256) || receipt.Size <= 0 {
			continue
		}
		parts := strings.Split(name, "/")
		if len(parts) < 3 || parts[0] != "runtime" || current[parts[1]] {
			continue
		}
		root := path.Join("runtime", parts[1])
		if _, err := safeRelative(root); err == nil {
			roots[root] = true
		}
	}
	var result []RuntimeState
	for root := range roots {
		absolute, err := safeDestination(m.root, root)
		if err != nil {
			continue
		}
		st, err := os.Lstat(absolute)
		if err != nil || !st.IsDir() {
			continue
		}
		var size int64
		_ = filepath.Walk(absolute, func(_ string, info os.FileInfo, err error) error {
			if err == nil && info.Mode().IsRegular() {
				size += info.Size()
			}
			return nil
		})
		sum := sha256.Sum256([]byte(root))
		result = append(result, RuntimeState{ID: fmt.Sprintf("legacy-%x", sum[:8]), Name: path.Base(root), Present: true, Removable: true, DiskBytes: size, LegacyRoot: root})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

func (m *Manager) runtimeStates() []RuntimeState {
	m.mu.Lock()
	settings := m.settings
	receipts := make(map[string]Receipt, len(m.receipts))
	for k, v := range m.receipts {
		receipts[k] = v
	}
	m.mu.Unlock()
	required := m.requiredRuntimeIDs(settings)
	var result []RuntimeState
	for _, r := range m.catalog.Runtimes {
		state := RuntimeState{ID: r.ID, Name: r.ID, Version: r.Version, Backend: r.Backend, Required: required[r.ID], Installed: true}
		artifacts := m.runtimeArtifacts(r)
		if len(artifacts) > 0 {
			state.Name = artifacts[0].Name
		}
		for _, a := range artifacts {
			if !m.artifactReady(a) {
				state.Installed = false
			}
		}
		protected := m.protectedRuntimeFiles(r.ID, settings)
		for _, f := range m.runtimeFilePaths(r) {
			p, err := safeDestination(m.root, f.Path)
			if err != nil {
				continue
			}
			st, err := os.Lstat(p)
			if err != nil {
				continue
			}
			state.Present = true
			state.DiskBytes += st.Size()
			if !protected[f.Path] && !state.Required {
				state.Removable = true
			}
		}
		result = append(result, state)
	}
	return append(result, m.legacyRuntimeStates(receipts)...)
}

func (m *Manager) DownloadRuntime(id string) error {
	if m.runtimeByID(id) == nil {
		return fmt.Errorf("알 수 없는 런타임입니다")
	}
	return m.beginSetup("runtime:" + id)
}

func (m *Manager) DeleteRuntime(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.busy || len(m.processes) > 0 {
		return fmt.Errorf("API와 다운로드를 중지한 뒤 런타임을 제거하세요")
	}
	if m.requiredRuntimeIDs(m.settings)[id] {
		return fmt.Errorf("현재 선택한 구성에 필요한 런타임입니다. 실행 구성을 바꾸거나 모델 선택을 해제하세요")
	}
	r := m.runtimeByID(id)
	if r == nil {
		for _, old := range m.legacyRuntimeStates(m.receipts) {
			if old.ID == id {
				p, err := safeDestination(m.root, old.LegacyRoot)
				if err != nil {
					return err
				}
				if err = os.RemoveAll(p); err != nil {
					return err
				}
				for name := range m.receipts {
					if strings.HasPrefix(name, old.LegacyRoot+"/") {
						delete(m.receipts, name)
					}
				}
				return writeJSON(filepath.Join(m.root, "data", "install-state.json"), m.receipts)
			}
		}
		return fmt.Errorf("알 수 없는 런타임입니다")
	}
	protected := m.protectedRuntimeFiles(id, m.settings)
	removed := false
	for _, a := range m.runtimeArtifacts(*r) {
		for _, f := range a.Files {
			if protected[f.Path] {
				continue
			}
			if !strings.HasPrefix(f.Path, "runtime/") && !strings.HasPrefix(f.Path, "bin/") {
				return fmt.Errorf("runtime output is outside managed runtime folders")
			}
			p, err := safeDestination(m.root, f.Path)
			if err != nil {
				return err
			}
			if err = os.Remove(p); err != nil && !os.IsNotExist(err) {
				return err
			}
			delete(m.receipts, f.Path)
			removed = true
			if strings.HasPrefix(f.Path, "runtime/") {
				for dir := filepath.Dir(p); dir != filepath.Join(m.root, "runtime"); dir = filepath.Dir(dir) {
					if err = os.Remove(dir); err != nil {
						break
					}
				}
			}
		}
		for _, suffix := range []string{".download", ".download.partial", ".embedded"} {
			name := a.ID + "-" + a.SHA256[:12] + suffix
			if suffix == ".embedded" {
				name = a.ID + suffix
			}
			_ = os.Remove(filepath.Join(m.root, "data", "downloads", name))
		}
	}
	if !removed {
		return fmt.Errorf("다른 설치된 런타임이 공유하는 파일입니다")
	}
	return writeJSON(filepath.Join(m.root, "data", "install-state.json"), m.receipts)
}
