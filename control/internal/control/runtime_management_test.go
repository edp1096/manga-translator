package control

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func runtimeFixture(t *testing.T) *Manager {
	t.Helper()
	root := t.TempDir()
	m := &Manager{root: root, platform: "linux-arm64", receipts: map[string]Receipt{}, processes: map[string]*managedProcess{}, settings: Settings{OCR: "ocr", Threads: 1}}
	for _, entry := range []struct{ id, path string }{{"base", "runtime/litert-2.3.1/core.so"}, {"gpu", "runtime/litert-2.3.1/gpu.so"}, {"old", "runtime/unused-1.0.0/core.so"}} {
		a := testArtifact([]byte(entry.id), "https://example.test/"+entry.id)
		a.ID = entry.id
		a.Group = "runtime"
		a.Files[0].Path = entry.path
		m.catalog.Artifacts = append(m.catalog.Artifacts, a)
		p := filepath.Join(root, filepath.FromSlash(entry.path))
		if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(entry.id), 0600); err != nil {
			t.Fatal(err)
		}
	}
	m.catalog.Runtimes = []Runtime{{ID: "litert", Artifact: "base"}, {ID: "litert-webgpu", Artifact: "gpu", AdditionalArtifacts: []string{"base"}}, {ID: "unused", Artifact: "old"}}
	m.catalog.Models = []Model{{ID: "ocr", Group: "ocr", Backend: "litert", Dependencies: []string{"litert"}}}
	for _, rel := range []string{"models/preserve.bin", "data/jobs/keep/result.json"} {
		p := filepath.Join(root, rel)
		os.MkdirAll(filepath.Dir(p), 0700)
		os.WriteFile(p, []byte("preserve"), 0600)
	}
	return m
}

func TestRuntimeDeletionProtectsSelectedAndSharedFiles(t *testing.T) {
	m := runtimeFixture(t)
	if err := m.DeleteRuntime("litert"); err == nil {
		t.Fatal("removed selected CPU runtime")
	}
	if err := m.DeleteRuntime("litert-webgpu"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(m.root, "runtime/litert-2.3.1/gpu.so")); !os.IsNotExist(err) {
		t.Fatal("GPU addon remains", err)
	}
	if err := m.DeleteRuntime("unused"); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"runtime/litert-2.3.1/core.so", "models/preserve.bin", "data/jobs/keep/result.json"} {
		if _, err := os.Stat(filepath.Join(m.root, rel)); err != nil {
			t.Fatal("deleted protected file", rel, err)
		}
	}
}

func TestRuntimeDeletionRejectsBusyAndUnknown(t *testing.T) {
	m := runtimeFixture(t)
	m.busy = true
	if err := m.DeleteRuntime("unused"); err == nil {
		t.Fatal("deleted while busy")
	}
	m.busy = false
	if err := m.DeleteRuntime("../models"); err == nil {
		t.Fatal("accepted unknown runtime")
	}
}

func TestLegacyRuntimeDeletionRequiresSafeReceipt(t *testing.T) {
	m := runtimeFixture(t)
	p := filepath.Join(m.root, "runtime/legacy-0.1.0/lib.so")
	os.MkdirAll(filepath.Dir(p), 0700)
	os.WriteFile(p, []byte("legacy"), 0600)
	valid := Receipt{SHA256: strings.Repeat("a", 64), Size: 6}
	m.receipts["runtime/./lib.so"] = valid
	m.receipts["runtime/../models/preserve.bin"] = valid
	m.receipts["models/preserve.bin"] = valid
	m.receipts["runtime/legacy-0.1.0/lib.so"] = valid
	states := m.legacyRuntimeStates(m.receipts)
	if len(states) != 1 || states[0].LegacyRoot != "runtime/legacy-0.1.0" {
		t.Fatalf("unsafe legacy inventory: %+v", states)
	}
	if err := m.DeleteRuntime(states[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Dir(p)); !os.IsNotExist(err) {
		t.Fatal("legacy directory remains", err)
	}
	if _, err := os.Stat(filepath.Join(m.root, "runtime/litert-2.3.1/core.so")); err != nil {
		t.Fatal("removed current runtime", err)
	}
}
