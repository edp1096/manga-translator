// Package builds the self-contained Go/Svelte releases. No Python is required.
package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"manga-translator/control/internal/control"
)

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(dir string, env []string, name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
func sum(data []byte) string { h := sha256.Sum256(data); return hex.EncodeToString(h[:]) }
func write(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".package-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(mode); err == nil {
		_, err = f.Write(data)
	}
	ce := f.Close()
	if err != nil {
		return err
	}
	if ce != nil {
		return ce
	}
	return os.Rename(name, path)
}
func copyFile(source, target string) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	return write(target, data, info.Mode().Perm()|0200)
}
func updateEngine(catalog *control.Catalog, bundle, platform, source string) error {
	if source == "" {
		return nil
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	var buffer bytes.Buffer
	z := gzip.NewWriter(&buffer)
	if _, err = z.Write(data); err != nil {
		return err
	}
	if err = z.Close(); err != nil {
		return err
	}
	compressed := buffer.Bytes()
	if err = write(filepath.Join(bundle, "engine", platform+".gz"), compressed, 0644); err != nil {
		return err
	}
	for i := range catalog.Artifacts {
		a := &catalog.Artifacts[i]
		if a.ID == "engine-"+platform {
			a.SHA256 = sum(compressed)
			a.Size = int64(len(compressed))
			a.Files[0].SHA256 = sum(data)
			a.Files[0].Size = int64(len(data))
			return nil
		}
	}
	if platform != "linux-amd64" {
		return fmt.Errorf("missing engine catalog entry for %s", platform)
	}
	catalog.Artifacts = append(catalog.Artifacts, control.Artifact{ID: "engine-" + platform, Name: "Manga 이미지 API", Group: "application", Platform: platform, URL: "embedded:engine/" + platform + ".gz", SHA256: sum(compressed), Size: int64(len(compressed)), Format: "gzip", Files: []control.OutputFile{{Path: "bin/manga-translator-server", SHA256: sum(data), Size: int64(len(data)), Executable: true}}})
	return nil
}
func archive(app, path string, names []string) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".release-*.zip")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer os.Remove(temp)
	z := zip.NewWriter(f)
	for _, name := range names {
		file, err := os.Open(filepath.Join(app, filepath.FromSlash(name)))
		if err != nil {
			return err
		}
		info, err := file.Stat()
		if err != nil {
			file.Close()
			return err
		}
		header, err := zip.FileInfoHeader(info)
		if err != nil {
			file.Close()
			return err
		}
		header.Name = name
		header.Method = zip.Deflate
		target, err := z.CreateHeader(header)
		if err == nil {
			_, err = io.Copy(target, file)
		}
		file.Close()
		if err != nil {
			return err
		}
	}
	if err = z.Close(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(temp, path)
}

func archiveSource(project, path string) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".source-*.tar.gz")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer os.Remove(temp)
	defer f.Close()
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	// Explicit source allowlist: never package models, config, jobs or backups.
	for _, name := range []string{"AGENTS.md", "README.md", "THIRD_PARTY_NOTICES.md", ".gitignore", "Makefile", "build.sh", "build.ps1", "control", "native", "extension", "tests", "docs/model-provenance", "docs/control-0.3.9", "docs/control-0.3.10", "docs/control-0.3.11", "docs/baberu-evaluation/RESULTS.txt", "docs/baberu-evaluation/summary.json", "docs/baberu-evaluation/provider-summary.json", "docs/baberu-evaluation/parity.json", "docs/baberu-evaluation/model-manifest.json", "docs/baberu-evaluation/weights.json", "docs/baberu-evaluation/fixtures/samples.json", "docs/baberu-evaluation/fixtures/validation.json", "deployment/orangepi/services"} {
		if name == "THIRD_PARTY_NOTICES.md" {
			if _, err := os.Stat(filepath.Join(project, name)); os.IsNotExist(err) {
				continue // Individual dependency notices are included under control/.
			}
		}
		err = filepath.Walk(filepath.Join(project, filepath.FromSlash(name)), func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() {
				switch info.Name() {
				case "node_modules", ".git", ".build", "__pycache__":
					return filepath.SkipDir
				}
				return nil
			}
			if !info.Mode().IsRegular() {
				return fmt.Errorf("unexpected non-regular source: %s", path)
			}
			rel, err := filepath.Rel(project, path)
			if err != nil {
				return err
			}
			header, err := tar.FileInfoHeader(info, "")
			if err != nil {
				return err
			}
			header.Name = "manga_translator/" + filepath.ToSlash(rel)
			if err = tw.WriteHeader(header); err != nil {
				return err
			}
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			_, err = io.Copy(tw, file)
			ce := file.Close()
			if err != nil {
				return err
			}
			return ce
		})
		if err != nil {
			return err
		}
	}
	if err = tw.Close(); err != nil {
		return err
	}
	if err = gz.Close(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(temp, path)
}
func main() {
	linux := flag.String("linux-native", "", "optional rebuilt Linux ARM64 native server")
	linuxX64 := flag.String("linux-x64-native", "", "optional rebuilt Linux AMD64 native server")
	windows := flag.String("windows-native", "", "optional rebuilt Windows AMD64 native server")
	output := flag.String("output", "", "release output folder (default: project/dist)")
	flag.Parse()
	module, err := exec.Command("go", "env", "GOMOD").Output()
	must(err)
	root := filepath.Dir(strings.TrimSpace(string(module)))
	if root == "." {
		must(fmt.Errorf("run this command inside the control Go module"))
	}
	project := filepath.Dir(root)
	bundle := filepath.Join(root, "internal", "assets", "bundle")
	dist := *output
	if dist == "" {
		dist = filepath.Join(project, "dist")
	}
	dist, err = filepath.Abs(dist)
	must(err)
	must(os.MkdirAll(dist, 0755))
	data, err := os.ReadFile(filepath.Join(bundle, "catalog.json"))
	must(err)
	var catalog control.Catalog
	must(json.Unmarshal(data, &catalog))
	catalog.Version = control.Version
	must(updateEngine(&catalog, bundle, "linux-arm64", *linux))
	must(updateEngine(&catalog, bundle, "linux-amd64", *linuxX64))
	must(updateEngine(&catalog, bundle, "windows-amd64", *windows))
	data, err = json.MarshalIndent(catalog, "", "  ")
	must(err)
	must(write(filepath.Join(bundle, "catalog.json"), append(data, '\n'), 0644))
	extensions, err := os.ReadDir(filepath.Join(project, "extension"))
	must(err)
	for _, entry := range extensions {
		if !entry.IsDir() {
			must(copyFile(filepath.Join(project, "extension", entry.Name()), filepath.Join(bundle, "extension", entry.Name())))
		}
	}
	npm := "npm"
	if runtime.GOOS == "windows" {
		npm = "npm.cmd"
	}
	must(run(filepath.Join(root, "web"), os.Environ(), npm, "run", "build"))
	must(run(root, os.Environ(), "go", "test", "./..."))
	must(run(root, os.Environ(), "go", "vet", "./..."))
	licenses, err := os.ReadDir(filepath.Join(bundle, "licenses"))
	must(err)
	sort.Slice(licenses, func(i, j int) bool { return licenses[i].Name() < licenses[j].Name() })
	sums := []string{}
	for _, target := range []struct{ platform, goos, arch, filename string }{{"linux-arm64", "linux", "arm64", "manga-control"}, {"windows-x64", "windows", "amd64", "MangaTranslator.exe"}, {"linux-x64", "linux", "amd64", "manga-control"}} {
		app := filepath.Join(dist, "manga-translator-"+target.platform+"-"+control.Version)
		must(os.MkdirAll(app, 0755))
		// Remove the obsolete application declaration from previous builds.
		must(removeIfPresent(filepath.Join(app, "licenses", "application.txt")))
		flags := "-s -w"
		if target.goos == "windows" {
			flags += " -H windowsgui"
		}
		env := append(os.Environ(), "GOOS="+target.goos, "GOARCH="+target.arch, "CGO_ENABLED=0")
		must(run(root, env, "go", "build", "-trimpath", "-ldflags="+flags, "-o", filepath.Join(app, target.filename), "."))
		must(copyFile(filepath.Join(root, "README.txt"), filepath.Join(app, "README.txt")))
		must(copyFile(filepath.Join(bundle, "catalog.json"), filepath.Join(app, "DOWNLOADS.json")))
		names := []string{target.filename, "README.txt", "DOWNLOADS.json"}
		for _, entry := range licenses {
			if !entry.IsDir() {
				name := "licenses/" + entry.Name()
				must(copyFile(filepath.Join(bundle, name), filepath.Join(app, filepath.FromSlash(name))))
				names = append(names, name)
			}
		}
		path := app + ".zip"
		must(archive(app, path, names))
		raw, err := os.ReadFile(path)
		must(err)
		sums = append(sums, sum(raw)+"  "+filepath.Base(path))
		fmt.Println(path)
	}
	source := filepath.Join(dist, "manga-translator-control-source-"+control.Version+".tar.gz")
	must(archiveSource(project, source))
	raw, err := os.ReadFile(source)
	must(err)
	sums = append(sums, sum(raw)+"  "+filepath.Base(source))
	fmt.Println(source)
	must(write(filepath.Join(dist, "manga-translator-"+control.Version+"-SHA256SUMS.txt"), []byte(strings.Join(sums, "\n")+"\n"), 0644))
}

func removeIfPresent(path string) error {
	err := os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}
