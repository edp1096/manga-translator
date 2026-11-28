package control

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"log"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAddedFontImportAndMigration(t *testing.T) {
	data, err := os.ReadFile("../assets/bundle/extension/fonts/heejoy-bold.ttf")
	if err != nil {
		t.Fatal(err)
	}
	source, dest := importFixture(t), t.TempDir()
	manager := &Manager{root: source}
	font, err := manager.importFont("샘플 글꼴.ttf", data)
	if err != nil || !addedFontID.MatchString(font.ID) || font.Weight != 700 {
		t.Fatalf("imported %+v: %v", font, err)
	}
	duplicate, err := manager.importFont("다른 이름.ttf", data)
	if err != nil || duplicate != font {
		t.Fatalf("duplicate: %+v %v", duplicate, err)
	}
	if _, err := manager.importFont("invalid.ttf", []byte("not a font")); err == nil {
		t.Fatal("accepted an invalid font")
	}
	path := filepath.Join(AddedFontsPath, strings.TrimPrefix(font.ID, "added-")+".ttf")
	report, err := importData(context.Background(), dest, source, nil)
	if err != nil || report.Files != 10 {
		t.Fatalf("migration: %+v %v", report, err)
	}
	moved, err := os.ReadFile(filepath.Join(dest, path))
	if err != nil || !bytes.Equal(moved, data) || !absent(filepath.Join(dest, "extension/render.js")) {
		t.Fatalf("migrated files: %v", err)
	}
	manager = &Manager{root: dest}
	fonts, err := manager.addedFonts()
	if err != nil || len(fonts) != 1 || fonts[0] != font {
		t.Fatalf("migrated catalog %+v: %v", fonts, err)
	}
	if err := manager.deleteFont("dialogue"); err == nil {
		t.Fatal("allowed bundled font deletion")
	}
	if err := manager.deleteFont(font.ID); err != nil || !absent(filepath.Join(dest, path)) {
		t.Fatalf("deletion: %v", err)
	}
	fonts, err = manager.addedFonts()
	if err != nil || len(fonts) != 0 {
		t.Fatalf("catalog after deletion: %+v %v", fonts, err)
	}
}

func TestAddedFontsExcludedFromExtensionZIP(t *testing.T) {
	bundle := fixtureBundle(testArtifact([]byte("test"), "http://localhost/test"))
	m, err := NewManager(t.TempDir(), bundle, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	if err := atomicBytes(filepath.Join(m.root, fontIndex), []byte("[]"), 0644); err != nil {
		t.Fatal(err)
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
	for _, entry := range z.File {
		if strings.HasPrefix(entry.Name, "fonts/added/") {
			t.Fatal("user font data included:", entry.Name)
		}
	}
}

func TestBundledFontPublisherPages(t *testing.T) {
	manager := &Manager{bundle: os.DirFS("../assets/bundle")}
	fonts, err := manager.builtInFonts()
	if err != nil {
		t.Fatal(err)
	}
	explicit := map[string]string{
		"euljiro":    "https://www.kogl.or.kr/recommend/recommendDivView.do?division=font&recommendIdx=10435",
		"yeonsung":   "https://www.kogl.or.kr/recommend/recommendDivView.do?division=font&recommendIdx=10434",
		"anjunggeun": "https://gscaltexmediahub.com/esg/independence_font_remind/",
		"heejoy":     "https://heejoykim.com/fonts/heejoy",
	}
	for _, font := range fonts {
		if expected, ok := explicit[font.ID]; ok {
			if font.PublisherPage != expected || font.Source == font.PublisherPage {
				t.Errorf("%s publisher page: %q", font.ID, font.PublisherPage)
			}
			delete(explicit, font.ID)
		} else if font.PublisherPage != font.Source || !strings.HasPrefix(font.PublisherPage, "https://copyright.keris.or.kr/wft/fntDwnldView?") {
			t.Errorf("%s publisher page: %q", font.ID, font.PublisherPage)
		}
	}
	if len(explicit) != 0 {
		t.Fatalf("missing fonts: %v", explicit)
	}
}
