package control

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Optional release verification against already-downloaded, pinned upstream
// archives. Does not download files or touch the installed application.
func TestPinnedGPUArchiveInstallation(t *testing.T) {
	cache := os.Getenv("MANGA_RUNTIME_ARCHIVES")
	if cache == "" {
		t.Skip("set MANGA_RUNTIME_ARCHIVES to the verified developer archive cache")
	}
	sources := map[string]string{}
	for _, manifest := range []string{"gpu-038/downloads.json", "gpu-038/dependencies.json", "gpu-038/dependencies-arm64.json"} {
		raw, err := os.ReadFile(filepath.Join(cache, manifest))
		if err != nil {
			t.Fatal(err)
		}
		var items []struct{ Name, URL string }
		if err = json.Unmarshal(raw, &items); err != nil {
			t.Fatal(err)
		}
		for _, item := range items {
			sources[item.URL] = filepath.Join(cache, "gpu-038", item.Name)
		}
	}
	raw, err := os.ReadFile(filepath.Join(cache, "gpu-038/ort-arm64.json"))
	if err != nil {
		t.Fatal(err)
	}
	var ort struct{ Name, URL string }
	if err = json.Unmarshal(raw, &ort); err != nil {
		t.Fatal(err)
	}
	sources[ort.URL] = filepath.Join(cache, "gpu-038", ort.Name)
	for _, platform := range []string{"linux-arm64", "linux-amd64", "windows-amd64"} {
		c, err := loadCatalog(catalogFS(t, releaseCatalog(t)), platform)
		if err != nil {
			t.Fatal(err)
		}
		for _, a := range c.Artifacts {
			if a.Group != "runtime" || !(strings.Contains(a.ID, "cuda") || strings.HasPrefix(a.ID, "nvidia-") || strings.Contains(a.ID, "vulkan") || strings.Contains(a.ID, "webgpu") || strings.Contains(a.ID, "directml") || strings.HasPrefix(a.ID, "dxc-") || platform == "linux-amd64") {
				continue
			}
			t.Run(a.ID, func(t *testing.T) {
				source := sources[a.URL]
				if source == "" {
					source = filepath.Join(cache, filepath.Base(a.URL))
				}
				file, err := os.Open(source)
				if err != nil {
					t.Fatal(err)
				}
				hash := sha256.New()
				_, err = io.Copy(hash, file)
				file.Close()
				if err != nil {
					t.Fatal(err)
				}
				if hex.EncodeToString(hash.Sum(nil)) != a.SHA256 {
					t.Fatal("archive checksum differs from catalog")
				}
				dest := t.TempDir()
				if a.Format == "raw" {
					input, err := os.Open(source)
					if err != nil {
						t.Fatal(err)
					}
					copyPath := filepath.Join(dest, "fixture.download")
					out, err := os.Create(copyPath)
					if err != nil {
						input.Close()
						t.Fatal(err)
					}
					_, err = io.Copy(out, input)
					out.Close()
					input.Close()
					if err != nil {
						t.Fatal(err)
					}
					source = copyPath
				}
				if err = installArtifact(context.Background(), dest, a, source, nil); err != nil {
					t.Fatal(err)
				}
				for _, f := range a.Files {
					st, err := os.Stat(filepath.Join(dest, filepath.FromSlash(f.Path)))
					if err != nil || st.Size() != f.Size {
						t.Fatal("missing or truncated output", f.Path, err)
					}
				}
			})
		}
	}
}
