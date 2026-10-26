package control

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
)

func releaseCatalog(t *testing.T) Catalog {
	t.Helper()
	raw, err := os.ReadFile("../assets/bundle/catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	var c Catalog
	if err = json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func catalogFS(t *testing.T, c Catalog) fstest.MapFS {
	t.Helper()
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	return fstest.MapFS{"catalog.json": {Data: raw}, "extension/manifest.json": {Data: []byte(`{}`)}}
}

func TestRuntimeUpgradeWithDifferentInstallLayout(t *testing.T) {
	for _, platform := range []string{"linux-arm64", "windows-amd64"} {
		t.Run(platform, func(t *testing.T) {
			c := releaseCatalog(t)
			// Keep archive entries and hashes intact; change every installation
			// directory and the LLM executable name, as a future release may do.
			for i := range c.Runtimes {
				r := &c.Runtimes[i]
				if r.Platform != platform {
					continue
				}
				r.Version = "9.8.7"
				dir := "runtime/" + r.ID + "-9.8.7/nested libraries"
				for ai := range c.Artifacts {
					a := &c.Artifacts[ai]
					if a.ID != r.Artifact {
						continue
					}
					for fi := range a.Files {
						f := &a.Files[fi]
						old := f.Path
						f.Path = path.Join(dir, path.Base(old))
						if old == r.Executable {
							f.Path = path.Join(dir, "new-server"+path.Ext(old))
							r.Executable = f.Path
						}
						if old == r.Library {
							r.Library = f.Path
						}
					}
				}
				r.LibraryDirs = []string{dir}
			}
			// Shared accelerator variants follow the relocated base library.
			for i := range c.Runtimes {
				r := &c.Runtimes[i]
				if r.Platform == platform && r.ID == "litert-webgpu" {
					for _, base := range c.Runtimes {
						if base.Platform == platform && base.ID == "litert" {
							r.Library = base.Library
						}
					}
				}
			}
			loaded, err := loadCatalog(catalogFS(t, c), platform)
			if err != nil {
				t.Fatal(err)
			}
			m := &Manager{root: t.TempDir(), catalog: loaded, platform: platform, settings: Settings{OCR: "hayai-int8", Layout: "koharu-768", Model: "gemma"}}
			exe, err := m.runtimeExecutable("llama")
			if err != nil || !strings.Contains(exe, "llama-9.8.7") || !strings.HasPrefix(filepath.Base(exe), "new-server") {
				t.Fatal(exe, err)
			}
			for _, service := range []string{"llm", "vision"} {
				dirs, err := m.runtimeLibraryDirs(service)
				if err != nil || len(dirs) == 0 {
					t.Fatal(dirs, err)
				}
				for _, dir := range dirs {
					if !strings.Contains(dir, "9.8.7") {
						t.Fatal("stale library path", dir)
					}
				}
				if service == "llm" && len(dirs) != 1 {
					t.Fatal("vision libraries leaked into LLM process")
				}
			}
			if err = m.writeNativeConfig(); err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(filepath.Join(m.root, "config", "native_api.json"))
			if err != nil || !strings.Contains(string(raw), "runtime/litert-9.8.7/nested libraries/") {
				t.Fatal(string(raw), err)
			}
			var cfg map[string]any
			if err = json.Unmarshal(raw, &cfg); err != nil {
				t.Fatal(err)
			}
			ort := m.runtimeForSettings("ort", m.settings)
			if ort == nil || cfg["ort_library"] != ort.Library || !strings.Contains(ort.Library, "ort-9.8.7/nested libraries/") {
				t.Fatalf("selected ORT library did not follow relocated runtime: %v", cfg["ort_library"])
			}
			if platform == "windows-amd64" {
				files := prerequisiteFiles(m.selectedArtifacts())
				if len(files) != 8 {
					t.Fatal("missing app-local VC files")
				}
				for _, f := range files {
					if f.RelativeTo == "llama" && filepath.Dir(filepath.Join(m.root, filepath.FromSlash(f.Path))) != filepath.Dir(exe) {
						t.Fatal("VC runtime did not follow relocated executable", f.Path)
					}
				}
			}
			m.settings.OCR = "hayai-onnx-fp32-kv"
			dirs, err := m.runtimeLibraryDirs("vision")
			if err != nil || len(dirs) != 1 || strings.Contains(dirs[0], "litert") {
				t.Fatal("FP32 unexpectedly needs LiteRT", dirs, err)
			}
		})
	}
}

func TestInvalidRuntimeMetadataIsRejected(t *testing.T) {
	for name, change := range map[string]func(*Catalog){
		"missing executable":        func(c *Catalog) { c.Runtimes[0].Executable = "runtime/nonexistent/server" },
		"unknown library directory": func(c *Catalog) { c.Runtimes[0].LibraryDirs = []string{"runtime/missing"} },
		"unfixed version":           func(c *Catalog) { c.Runtimes[0].Version = "latest" },
		"missing artifact":          func(c *Catalog) { c.Runtimes[0].Artifact = "no-such-artifact" },
		"missing dependency":        func(c *Catalog) { c.Models[0].Dependencies = []string{"unknown-runtime"} },
	} {
		t.Run(name, func(t *testing.T) {
			c := releaseCatalog(t)
			change(&c)
			if _, err := loadCatalog(catalogFS(t, c), "linux-arm64"); err == nil {
				t.Fatal("accepted invalid runtime metadata")
			}
		})
	}
}

func TestLoaderEnvironmentReplacesStaleRuntimePaths(t *testing.T) {
	root := t.TempDir()
	t.Setenv("LD_LIBRARY_PATH", "/old/runtime")
	t.Setenv("LLAMA_CACHE", "/outside/cache")
	dirs := []string{filepath.Join(root, "runtime", "new-runtime")}
	counts := map[string]int{}
	values := map[string]string{}
	for _, entry := range processEnvironment(root, dirs) {
		key, value, _ := strings.Cut(entry, "=")
		key = strings.ToUpper(key)
		counts[key]++
		values[key] = value
	}
	if counts["LLAMA_CACHE"] != 1 || values["LLAMA_CACHE"] != filepath.Join(root, "data", "cache", "llama") {
		t.Fatal("inherited cache overrides portable cache")
	}
	if filepath.Separator == '/' && (counts["LD_LIBRARY_PATH"] != 1 || values["LD_LIBRARY_PATH"] != dirs[0]) {
		t.Fatal("stale loader path survived", values)
	}
}

func TestRuntimeUpgradeRequiresNewFilesWithoutDestroyingOldVersion(t *testing.T) {
	var calls atomic.Int32
	data := []byte("new runtime payload")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.Write(data) }))
	defer srv.Close()
	a := testArtifact(data, srv.URL)
	a.ID = "llama-linux-arm64"
	a.Group = "runtime"
	a.Platform = "all"
	a.Files[0].Path = "runtime/next/server"
	a.Files[0].Executable = true
	c := Catalog{Version: Version, Artifacts: []Artifact{a}, Runtimes: []Runtime{{ID: "llama", Version: "9.8.7", Platform: currentPlatform(), Artifact: a.ID, ReleaseURL: "https://example.com/releases/9.8.7", Executable: a.Files[0].Path, LibraryDirs: []string{"runtime/next"}}}}
	root := t.TempDir()
	old := filepath.Join(root, "runtime", "previous", "server")
	if err := atomicBytes(old, []byte("previous runtime"), 0700); err != nil {
		t.Fatal(err)
	}
	m, err := NewManager(root, catalogFS(t, c), log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	m.platform = "linux-arm64"
	m.downloader = &Downloader{Client: http.DefaultClient, AllowHTTP: true}
	m.prerequisites = func(context.Context, string, []OutputFile) error { return nil }
	if err = m.StartInstalled(); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 || m.allReady() {
		t.Fatal("old runtime incorrectly satisfies new version or upgrade downloaded at startup")
	}
	if err = m.BeginSetup(); err != nil {
		t.Fatal(err)
	}
	waitSetup(t, m)
	if !m.allReady() || calls.Load() != 1 {
		t.Fatal("new runtime was not installed")
	}
	previous, err := os.ReadFile(old)
	if err != nil || string(previous) != "previous runtime" {
		t.Fatal("upgrade destroyed previous version", err)
	}
	exe, err := m.runtimeExecutable("llama")
	if err != nil || exe != filepath.Join(root, "runtime", "next", "server") {
		t.Fatal("still selects old runtime", exe, err)
	}
}

// Optional integration check against the real upstream release archives. Cache
// files are named by SHA-256 so release names and version folders are irrelevant.
func TestPinnedRuntimeArchives(t *testing.T) {
	cache := os.Getenv("MANGA_TEST_RUNTIME_ARCHIVES")
	if cache == "" {
		t.Skip("set MANGA_TEST_RUNTIME_ARCHIVES to verified release archives")
	}
	for _, platform := range []string{"linux-arm64", "windows-amd64"} {
		c, err := loadCatalog(os.DirFS("../assets/bundle"), platform)
		if err != nil {
			t.Fatal(err)
		}
		root := t.TempDir()
		for _, a := range c.Artifacts {
			if a.Group != "runtime" {
				continue
			}
			t.Run(a.ID, func(t *testing.T) {
				source := filepath.Join(cache, a.SHA256)
				actual, err := hashFile(source)
				if err != nil || actual != a.SHA256 {
					t.Fatal("unexpected upstream archive", a.ID, err)
				}
				if err = installArtifact(context.Background(), root, a, source, nil); err != nil {
					t.Fatal(err)
				}
				for _, file := range a.Files {
					got, err := hashFile(filepath.Join(root, filepath.FromSlash(file.Path)))
					if err != nil || got != file.SHA256 {
						t.Fatal("incorrect extracted file", file.Path, err)
					}
				}
			})
		}
	}
}

// The selected Windows runtime must name an exact DLL, including when only one
// ONNX stage uses DirectML. PATH alone can resolve an older system DLL.
func TestWindowsORTLibrarySelection(t *testing.T) {
	c, err := loadCatalog(os.DirFS("../assets/bundle"), "windows-amd64")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, layout, ocr, want string
	}{
		{"CPU", "cpu", "cpu", "ort"},
		{"DirectML", "directml", "directml", "ort-directml"},
		{"layout only", "directml", "cpu", "ort-directml"},
		{"OCR only", "cpu", "directml", "ort-directml"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := &Manager{catalog: c, platform: "windows-amd64"}
			s := Settings{OCR: "hayai-onnx-fp32-kv", LayoutExecution: tc.layout, OCRExecution: tc.ocr}
			r := m.runtimeForSettings("ort", s)
			if r == nil || r.ID != tc.want || path.Base(r.Library) != "onnxruntime.dll" {
				t.Fatalf("wrong selected ORT library: %#v", r)
			}
			found := false
			for _, a := range m.runtimeArtifacts(*r) {
				for _, f := range a.Files {
					if f.Path == r.Library {
						found = true
					}
				}
			}
			if !found {
				t.Fatalf("selected DLL is not a verified runtime artifact: %s", r.Library)
			}
		})
	}
}
