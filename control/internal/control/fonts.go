package control

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

const AddedFontsPath = "extension/fonts/added"
const fontIndex = AddedFontsPath + "/catalog.json"
const maxFontBytes = 24 << 20

var addedFontID = regexp.MustCompile("^added-[a-f0-9]{64}$")

type fontEntry struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Format        string `json:"format,omitempty"`
	Weight        int    `json:"weight,omitempty"`
	Source        string `json:"source,omitempty"`
	PublisherPage string `json:"publisherPage,omitempty"`
}

func fontFormat(data []byte) (string, int, error) {
	invalid := errors.New("유효한 TTF 또는 OTF 파일을 선택하세요")
	if len(data) < 12 {
		return "", 0, invalid
	}
	format := "ttf"
	switch string(data[:4]) {
	case "OTTO":
		format = "otf"
	case "\x00\x01\x00\x00", "true":
	default:
		return "", 0, invalid
	}
	tableCount := int(binary.BigEndian.Uint16(data[4:6]))
	if tableCount == 0 || tableCount > (len(data)-12)/16 {
		return "", 0, invalid
	}
	tables := make(map[string][]byte, tableCount)
	for i := 0; i < tableCount; i++ {
		entry := data[12+i*16:][:16]
		offset, size := uint64(binary.BigEndian.Uint32(entry[8:12])), uint64(binary.BigEndian.Uint32(entry[12:16]))
		if offset+size > uint64(len(data)) {
			return "", 0, invalid
		}
		tables[string(entry[:4])] = data[offset : offset+size]
	}
	if len(tables["cmap"]) < 4 || len(tables["name"]) < 6 || len(tables["head"]) < 54 || len(tables["maxp"]) < 6 ||
		(format == "ttf" && len(tables["glyf"]) == 0) ||
		(format == "otf" && len(tables["CFF "]) == 0 && len(tables["CFF2"]) == 0) {
		return "", 0, invalid
	}
	weight := 400
	if profile := tables["OS/2"]; len(profile) >= 6 {
		if candidate := int(binary.BigEndian.Uint16(profile[4:6])); candidate >= 1 && candidate <= 1000 {
			weight = candidate
		}
	}
	return format, weight, nil
}

func (m *Manager) addedFonts() ([]fontEntry, error) {
	index, err := safeDestination(m.root, fontIndex)
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(index)
	if os.IsNotExist(err) {
		return []fontEntry{}, nil
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("추가 글꼴 목록 경로를 확인하세요")
	}
	data, err := os.ReadFile(index)
	if err != nil {
		return nil, err
	}
	var fonts []fontEntry
	if err := json.Unmarshal(data, &fonts); err != nil {
		return nil, fmt.Errorf("추가 글꼴 목록을 읽을 수 없습니다: %w", err)
	}
	return fonts, nil
}

func (m *Manager) builtInFonts() ([]fontEntry, error) {
	data, err := fs.ReadFile(m.bundle, "extension/fonts/sources.json")
	if err != nil {
		return nil, err
	}
	var sources map[string]fontEntry
	if err := json.Unmarshal(data, &sources); err != nil {
		return nil, err
	}
	fonts := make([]fontEntry, 0, len(sources))
	for id, font := range sources {
		if font.Name != "" {
			font.ID = id
			if font.PublisherPage == "" {
				font.PublisherPage = font.Source
			}
			fonts = append(fonts, font)
		}
	}
	sort.Slice(fonts, func(i, j int) bool { return fonts[i].Name < fonts[j].Name })
	return fonts, nil
}

func (m *Manager) importFont(name string, data []byte) (fontEntry, error) {
	format, weight, err := fontFormat(data)
	if err != nil {
		return fontEntry{}, err
	}
	name = strings.TrimSpace(strings.TrimSuffix(name, filepath.Ext(name)))
	if name == "" || len([]rune(name)) > 120 || strings.ContainsAny(name, `/\`) || strings.ContainsFunc(name, unicode.IsControl) {
		return fontEntry{}, errors.New("글꼴 파일 이름을 확인하세요")
	}
	hash, err := hashReader(bytes.NewReader(data))
	if err != nil {
		return fontEntry{}, err
	}
	font := fontEntry{ID: "added-" + hash, Name: name, Format: format, Weight: weight}

	fonts, err := m.addedFonts()
	if err != nil {
		return fontEntry{}, err
	}
	path, err := safeDestination(m.root, AddedFontsPath+"/"+hash+"."+format)
	if err != nil {
		return fontEntry{}, err
	}
	for _, existing := range fonts {
		if existing.ID == font.ID {
			if err := atomicBytes(path, data, 0644); err != nil {
				return fontEntry{}, err
			}
			return existing, nil
		}
	}
	if err := atomicBytes(path, data, 0644); err != nil {
		return fontEntry{}, err
	}
	index := filepath.Join(m.root, filepath.FromSlash(fontIndex))
	if err := writeJSON(index, append(fonts, font)); err != nil {
		_ = os.Remove(path)
		return fontEntry{}, err
	}
	return font, nil
}

func (m *Manager) deleteFont(id string) error {
	if !addedFontID.MatchString(id) {
		return errors.New("추가한 글꼴을 선택하세요")
	}
	fonts, err := m.addedFonts()
	if err != nil {
		return err
	}
	for i, font := range fonts {
		if font.ID != id || (font.Format != "ttf" && font.Format != "otf") {
			continue
		}
		path, err := safeDestination(m.root, AddedFontsPath+"/"+strings.TrimPrefix(id, "added-")+"."+font.Format)
		if err != nil {
			return err
		}
		index := filepath.Join(m.root, filepath.FromSlash(fontIndex))
		remaining := append(append([]fontEntry{}, fonts[:i]...), fonts[i+1:]...)
		if err := writeJSON(index, remaining); err != nil {
			return err
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return errors.Join(err, writeJSON(index, fonts))
		}
		return nil
	}
	return nil
}

func (m *Manager) fontRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/fonts", func(w http.ResponseWriter, r *http.Request) {
		builtIn, err := m.builtInFonts()
		if err != nil {
			action(w, err)
			return
		}
		added, err := m.addedFonts()
		if err != nil {
			action(w, err)
			return
		}
		respond(w, map[string][]fontEntry{"builtIn": builtIn, "added": added}, http.StatusOK)
	})
	mux.HandleFunc("POST /api/fonts", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Content-Type") != "application/octet-stream" {
			respond(w, map[string]string{"error": "글꼴 파일을 선택하세요"}, http.StatusUnsupportedMediaType)
			return
		}
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxFontBytes))
		if err != nil {
			respond(w, map[string]string{"error": "24 MiB 이하의 글꼴 파일을 선택하세요"}, http.StatusBadRequest)
			return
		}
		m.operation.Lock()
		defer m.operation.Unlock()
		font, err := m.importFont(r.URL.Query().Get("name"), data)
		if err != nil {
			action(w, err)
			return
		}
		respond(w, font, http.StatusCreated)
	})
	mux.HandleFunc("DELETE /api/fonts/{id}", func(w http.ResponseWriter, r *http.Request) {
		m.operation.Lock()
		defer m.operation.Unlock()
		action(w, m.deleteFont(r.PathValue("id")))
	})
	mux.HandleFunc("POST /api/open/fonts", func(w http.ResponseWriter, r *http.Request) {
		action(w, openFolder(filepath.Join(m.root, "extension", "fonts")))
	})
}
