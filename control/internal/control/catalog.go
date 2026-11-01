package control

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

var Version = "0.4.5"

const ControlPort = 8794
const VisionPort = 8793
const LLMPort = 8792

type OutputFile struct {
	Entry      string `json:"entry,omitempty"`
	RelativeTo string `json:"relativeTo,omitempty"`
	Path       string `json:"path"`
	SHA256     string `json:"sha256"`
	Size       int64  `json:"size"`
	Executable bool   `json:"executable,omitempty"`
}
type Artifact struct {
	CabOffset   int64        `json:"cabOffset,omitempty"`
	CabSize     int64        `json:"cabSize,omitempty"`
	CabEntry    string       `json:"cabEntry,omitempty"`
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Group       string       `json:"group"`
	Platform    string       `json:"platform"`
	URL         string       `json:"url"`
	SHA256      string       `json:"sha256"`
	Size        int64        `json:"size"`
	Format      string       `json:"format"`
	Files       []OutputFile `json:"files"`
	Patch       string       `json:"patch,omitempty"`
	PatchSHA256 string       `json:"patchSha256,omitempty"`
}
type License struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	License string `json:"license"`
}
type Model struct {
	Platforms       []string         `json:"platforms,omitempty"`
	LLM             *LLMModelOptions `json:"llm,omitempty"`
	InputSize       int              `json:"inputSize,omitempty"`
	VisionLimitMiB  int              `json:"visionLimitMiB,omitempty"`
	MinAvailableMiB int              `json:"minAvailableMiB,omitempty"`
	Backend         string           `json:"backend,omitempty"`
	Group           string           `json:"group"`
	Artifacts       []string         `json:"artifacts"`
	Dependencies    []string         `json:"dependencies"`
	Path            string           `json:"path"`
	ID              string           `json:"id"`
	Name            string           `json:"name"`
	MemoryGiB       int              `json:"memoryGiB"`
	Note            string           `json:"note"`
}
type Catalog struct {
	Models    []Model    `json:"models"`
	Runtimes  []Runtime  `json:"runtimes,omitempty"`
	Version   string     `json:"version"`
	Artifacts []Artifact `json:"artifacts"`
	Licenses  []License  `json:"licenses"`
}
type Receipt struct {
	SHA256   string `json:"sha256"`
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"`
}

var identifier = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
var checksum = regexp.MustCompile(`^[a-f0-9]{64}$`)

func loadCatalog(bundle fs.FS, platform string) (Catalog, error) {
	raw, err := fs.ReadFile(bundle, "catalog.json")
	if err != nil {
		return Catalog{}, err
	}
	var all Catalog
	if err = json.Unmarshal(raw, &all); err != nil {
		return all, err
	}
	result := Catalog{Version: all.Version, Licenses: all.Licenses}
	for _, model := range all.Models {
		include := len(model.Platforms) == 0
		for _, target := range model.Platforms {
			if target == platform {
				include = true
			}
		}
		if include {
			result.Models = append(result.Models, model)
		}
	}
	seen := map[string]bool{}
	outputs := map[string]bool{}
	for _, a := range all.Artifacts {
		if a.Platform != "all" && a.Platform != platform {
			continue
		}
		if !identifier.MatchString(a.ID) || seen[a.ID] || !checksum.MatchString(a.SHA256) || a.Size <= 0 || len(a.Files) == 0 {
			return result, fmt.Errorf("invalid artifact %q", a.ID)
		}
		seen[a.ID] = true
		for i := range a.Files {
			f := &a.Files[i]
			if f.RelativeTo == "" {
				continue
			}
			if _, err := safeRelative(f.Path); err != nil {
				return result, err
			}
			resolved := false
			for _, r := range all.Runtimes {
				if r.ID == f.RelativeTo && r.Platform == platform && r.Executable != "" {
					if _, err := safeRelative(r.Executable); err != nil {
						return result, err
					}
					f.Path = path.Join(path.Dir(r.Executable), f.Path)
					resolved = true
					break
				}
			}
			if !resolved {
				return result, fmt.Errorf("unknown runtime-relative output %q", f.RelativeTo)
			}
		}
		switch a.Format {
		case "raw", "zip", "tgz", "gzip", "patch", "msvc-cab":
		default:
			return result, fmt.Errorf("invalid format %q", a.Format)
		}
		for _, f := range a.Files {
			if _, err = safeRelative(f.Path); err != nil {
				return result, err
			}
			if outputs[f.Path] || f.Size <= 0 || !checksum.MatchString(f.SHA256) {
				return result, fmt.Errorf("invalid output %q", f.Path)
			}
			outputs[f.Path] = true
		}
		if a.Format == "msvc-cab" {
			if a.CabOffset < 0 || a.CabSize <= 0 || a.CabOffset > a.Size-a.CabSize {
				return result, fmt.Errorf("invalid runtime cabinet")
			}
			if _, err := safeRelative(a.CabEntry); err != nil {
				return result, err
			}
		}
		if a.Format == "patch" {
			if !checksum.MatchString(a.PatchSHA256) {
				return result, fmt.Errorf("invalid patch checksum")
			}
			if _, err = safeRelative(a.Patch); err != nil {
				return result, err
			}
		}
		if a.Format == "raw" && (len(a.Files) != 1 || a.Files[0].SHA256 != a.SHA256 || a.Files[0].Size != a.Size) {
			return result, fmt.Errorf("raw output does not match download")
		}
		result.Artifacts = append(result.Artifacts, a)
	}
	if err := loadRuntimes(&result, all.Runtimes, platform); err != nil {
		return result, err
	}
	modelIDs := map[string]bool{}
	modelArtifacts := map[string]bool{}
	for _, model := range result.Models {
		if !identifier.MatchString(model.ID) || modelIDs[model.ID] || len(model.Artifacts) == 0 {
			return result, fmt.Errorf("invalid model %q", model.ID)
		}
		if model.Group == "ocr" && model.Backend != "litert" && model.Backend != "onnx-v2-kv" && model.Backend != "baberu-int4" && model.Backend != "baberu-fp16" {
			return result, fmt.Errorf("unsupported OCR backend %q", model.Backend)
		}
		if model.Group != "layout" && model.Group != "ocr" && model.Group != "translation" && model.Group != "restoration" {
			return result, fmt.Errorf("invalid model group")
		}
		if _, err := safeRelative(model.Path); err != nil {
			return result, err
		}
		modelIDs[model.ID] = true
		localArtifacts := map[string]bool{}
		for _, id := range model.Artifacts {
			found := false
			for _, a := range result.Artifacts {
				if a.ID == id && a.Group == model.Group {
					found = true
				}
			}
			if !found || localArtifacts[id] {
				return result, fmt.Errorf("invalid model artifact %q", id)
			}
			localArtifacts[id] = true
			modelArtifacts[id] = true
		}
		if err := validateLLMModel(model, result.Artifacts); err != nil {
			return result, err
		}
	}
	for _, a := range result.Artifacts {
		if (a.Group == "translation" || a.Group == "ocr" || a.Group == "layout" || a.Group == "restoration") && len(result.Models) > 0 && !modelArtifacts[a.ID] {
			return result, fmt.Errorf("missing model metadata %q", a.ID)
		}
	}
	return result, nil
}
func currentPlatform() string { return runtime.GOOS + "-" + runtime.GOARCH }
func supportedPlatform(p string) bool {
	return p == "linux-arm64" || p == "linux-amd64" || p == "windows-amd64"
}
func safeRelative(s string) (string, error) {
	if s == "" || s == "." || path.Clean(s) != s || strings.ContainsAny(s, "\\:\x00") || strings.HasPrefix(s, "/") || s == ".." || strings.HasPrefix(s, "../") {
		return "", fmt.Errorf("unsafe relative path %q", s)
	}
	return filepath.FromSlash(s), nil
}
func safeDestination(root, rel string) (string, error) {
	s, err := safeRelative(rel)
	if err != nil {
		return "", err
	}
	dest := filepath.Join(root, s)
	parent := filepath.Dir(dest)
	for {
		resolved, e := filepath.EvalSymlinks(parent)
		if e == nil {
			r, e := filepath.Rel(root, resolved)
			if e != nil || r == ".." || strings.HasPrefix(r, ".."+string(filepath.Separator)) {
				return "", fmt.Errorf("destination leaves application folder")
			}
			break
		}
		if !os.IsNotExist(e) {
			return "", e
		}
		next := filepath.Dir(parent)
		if next == parent {
			return "", e
		}
		parent = next
	}
	return dest, nil
}
func hashReader(r io.Reader) (string, error) {
	h := sha256.New()
	_, err := io.Copy(h, r)
	return hex.EncodeToString(h.Sum(nil)), err
}
func hashFile(p string) (string, error) {
	f, e := os.Open(p)
	if e != nil {
		return "", e
	}
	defer f.Close()
	return hashReader(f)
}
func writeJSON(p string, v any) error {
	data, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	return atomicBytes(p, append(data, '\n'), 0600)
}
func atomicBytes(p string, data []byte, mode fs.FileMode) error {
	if e := os.MkdirAll(filepath.Dir(p), 0700); e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(p), ".manga-write-*")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	if e = f.Chmod(mode); e == nil {
		_, e = f.Write(data)
	}
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e != nil {
		return e
	}
	if ce != nil {
		return ce
	}
	return os.Rename(name, p)
}
