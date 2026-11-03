package control

import (
	"archive/zip"
	"bytes"
	"io"
	"log"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestPackagedFontInstallAndZip(t *testing.T) {
	bundle := fixtureBundle(testArtifact([]byte("test"), "http://localhost/test"))
	bundle["extension/fonts/dialogue.woff"] = &fstest.MapFile{Data: []byte("woff fixture")}
	m, err := NewManager(t.TempDir(), bundle, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	data, err := os.ReadFile(filepath.Join(m.root, "extension/fonts/dialogue.woff"))
	if err != nil || string(data) != "woff fixture" {
		t.Fatalf("installed font: %q %v", data, err)
	}
	w := httptest.NewRecorder()
	m.Handler().ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:8794/extension.zip", nil))
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	z, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range z.File {
		if f.Name == "fonts/dialogue.woff" {
			r, err := f.Open()
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			b, _ := io.ReadAll(r)
			if string(b) != "woff fixture" {
				t.Fatal("font changed")
			}
			return
		}
	}
	t.Fatal("font missing from extension zip")
}
