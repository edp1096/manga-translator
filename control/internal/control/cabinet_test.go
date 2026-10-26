package control

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestPinnedVCRuntimeStaysInsidePortableRoot(t *testing.T) {
	source := os.Getenv("MANGA_TEST_VC_PACKAGE")
	if source == "" {
		t.Skip("set MANGA_TEST_VC_PACKAGE to the pinned official installer")
	}
	catalog, err := loadCatalog(os.DirFS("../assets/bundle"), "windows-amd64")
	if err != nil {
		t.Fatal(err)
	}
	var artifact Artifact
	for _, a := range catalog.Artifacts {
		if a.ID == "vcredist-windows-amd64" {
			artifact = a
		}
	}
	got, err := hashFile(source)
	if err != nil || got != artifact.SHA256 {
		t.Fatal("unexpected VC source", err)
	}
	root := t.TempDir()
	if err = installMSVCCabinet(context.Background(), root, artifact, source); err != nil {
		t.Fatal(err)
	}
	for _, f := range artifact.Files {
		p := filepath.Join(root, filepath.FromSlash(f.Path))
		st, e := os.Stat(p)
		if e != nil || st.Size() != f.Size {
			t.Fatal(f.Path, e)
		}
		sum, e := hashFile(p)
		if e != nil || sum != f.SHA256 {
			t.Fatal(f.Path, e)
		}
	}
	if len(artifact.Files) != 8 {
		t.Fatal("expected both native and LLM app-local DLLs")
	}
}
func TestCabinetRejectsMalformedInput(t *testing.T) {
	for _, data := range [][]byte{nil, []byte("MSCF"), make([]byte, 36), append([]byte("MSCF"), make([]byte, 100)...)} {
		if _, err := cabinetFiles(context.Background(), data, map[string]bool{"msvcp140.dll_amd64": true}); err == nil {
			t.Fatal("accepted malformed cabinet")
		}
	}
}
