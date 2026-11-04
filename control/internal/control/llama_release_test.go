package control

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLLamaReleaseConsistentAcrossPlatforms(t *testing.T) {
	for _, platform := range []string{"windows-amd64", "linux-amd64", "linux-arm64"} {
		c, err := loadCatalog(catalogFS(t, releaseCatalog(t)), platform)
		if err != nil {
			t.Fatal(err)
		}
		m := &Manager{catalog: c, platform: platform}
		for _, backend := range []string{"cpu", "vulkan", "cuda"} {
			r := m.runtimeForSettings("llama", Settings{LLMExecution: backend})
			if r == nil || r.Version != "0.9.0" || r.BuildTag != "b12110" {
				t.Fatal(platform, backend, r)
			}
			if !strings.Contains(r.Executable, "-0.9.0/") {
				t.Fatal(r.Executable)
			}
			for _, a := range m.runtimeArtifacts(*r) {
				if !strings.Contains(a.URL, "/ggml-org/llama.cpp/releases/download/b12110/") {
					t.Fatal(a.URL)
				}
				for _, f := range a.Files {
					if !strings.Contains(f.Path, "-0.9.0/") {
						t.Fatal(f.Path)
					}
				}
			}
		}
	}
}

// Optional offline integration check: use the actual production installer and
// verified upstream archives, with no network requests or user data changes.
func TestLLamaReleaseArchives(t *testing.T) {
	cache := os.Getenv("MANGA_TEST_LLAMA_ARCHIVES")
	if cache == "" {
		t.Skip("set MANGA_TEST_LLAMA_ARCHIVES to hash-named release archives")
	}
	platforms := os.Getenv("MANGA_TEST_LLAMA_PLATFORMS")
	if platforms == "" {
		platforms = "windows-amd64,linux-amd64,linux-arm64"
	}
	for _, platform := range strings.Split(platforms, ",") {
		c, err := loadCatalog(catalogFS(t, releaseCatalog(t)), platform)
		if err != nil {
			t.Fatal(err)
		}
		m := &Manager{catalog: c, platform: platform}
		for _, r := range c.Runtimes {
			if r.Family != "llama" {
				continue
			}
			t.Run(platform+"/"+r.ID, func(t *testing.T) {
				root := t.TempDir()
				for _, a := range m.runtimeArtifacts(r) {
					source := filepath.Join(cache, a.SHA256)
					if got, err := hashFile(source); err != nil || got != a.SHA256 {
						t.Fatal(a.ID, got, err)
					}
					if err := installArtifact(context.Background(), root, a, source, nil); err != nil {
						t.Fatal(a.ID, err)
					}
					for _, f := range a.Files {
						if got, err := hashFile(filepath.Join(root, filepath.FromSlash(f.Path))); err != nil || got != f.SHA256 {
							t.Fatal(f.Path, got, err)
						}
					}
				}
			})
		}
	}
}
