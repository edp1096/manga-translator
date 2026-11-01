package control

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func (m *Manager) Handler() http.Handler {
	mux := http.NewServeMux()
	m.libraryRoutes(mux)
	mux.HandleFunc("GET /api/jobs/data", func(w http.ResponseWriter, r *http.Request) {
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		v, e := m.Jobs(r.URL.Query().Get("q"), r.URL.Query().Get("filter"), offset, limit)
		if e != nil {
			action(w, e)
			return
		}
		respond(w, v, 200)
	})
	mux.HandleFunc("POST /api/jobs/keep", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			IDs  []string `json:"ids"`
			Keep bool     `json:"keep"`
		}
		if !decode(w, r, &b) {
			return
		}
		action(w, m.KeepJobs(b.IDs, b.Keep))
	})
	mux.HandleFunc("POST /api/jobs/delete", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			IDs       []string `json:"ids"`
			AllUnkept bool     `json:"allUnkept"`
		}
		if !decode(w, r, &b) {
			return
		}
		ids, e := m.DeleteJobs(b.IDs, b.AllUnkept)
		result := map[string]any{"deleted": ids}
		if e != nil {
			result["error"] = e.Error()
			respond(w, result, 409)
			return
		}
		respond(w, result, 200)
	})
	mux.HandleFunc("POST /api/jobs/policy", func(w http.ResponseWriter, r *http.Request) {
		var b JobPolicy
		if !decode(w, r, &b) {
			return
		}
		action(w, m.SaveJobPolicy(b.RetentionDays))
	})
	mux.HandleFunc("POST /api/jobs/open", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			ID string `json:"id"`
		}
		if !decode(w, r, &b) {
			return
		}
		p, e := jobPath(m.root, b.ID)
		if e == nil {
			_, e = readJobInfo(m.root, b.ID)
		}
		if e == nil {
			e = openFolder(p)
		}
		action(w, e)
	})
	mux.HandleFunc("GET /api/jobs/image/{id}", func(w http.ResponseWriter, r *http.Request) {
		p, e := jobPath(m.root, r.PathValue("id"))
		if e == nil {
			p, e = safeDestination(p, "original.png")
		}
		if e != nil {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, p)
	})
	mux.HandleFunc("POST /api/import/preview", func(w http.ResponseWriter, r *http.Request) {
		var b struct {
			Source string `json:"source"`
			Jobs   string `json:"jobs"`
		}
		if !decode(w, r, &b) {
			return
		}
		v, e := m.PreviewImport(b.Source, ImportOptions{Jobs: b.Jobs})
		if e != nil {
			action(w, e)
			return
		}
		respond(w, v, 200)
	})

	mux.HandleFunc("GET /api/update/state", func(w http.ResponseWriter, r *http.Request) {
		result := map[string]any{"update": m.updateState()}
		if raw, e := os.ReadFile(filepath.Join(m.root, "data", "update-result.json")); e == nil {
			var receipt map[string]string
			if json.Unmarshal(raw, &receipt) == nil {
				result["result"] = receipt
			}
		}
		respond(w, result, 200)
	})
	mux.HandleFunc("POST /api/update/check", func(w http.ResponseWriter, r *http.Request) { action(w, m.CheckUpdate()) })
	mux.HandleFunc("POST /api/update/install", func(w http.ResponseWriter, r *http.Request) { action(w, m.InstallUpdate()) })
	mux.HandleFunc("GET /api/update/health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, map[string]string{"Version": Version, "Root": m.root, "Token": updateProbeToken}, 200)
	})
	mux.HandleFunc("POST /api/update/activate", func(w http.ResponseWriter, r *http.Request) {
		if updateProbeToken == "" || r.Header.Get("X-Manga-Update") != updateProbeToken {
			respond(w, map[string]string{"error": "잘못된 업데이트 토큰"}, 403)
			return
		}
		j, e := readUpdateJournal(m.root)
		if e != nil || j.Phase != "complete" {
			respond(w, map[string]string{"error": "업데이트 검증이 완료되지 않았습니다"}, 409)
			return
		}
		m.mu.Lock()
		m.busy = false
		m.mu.Unlock()
		if e := m.StartInstalled(); e != nil {
			m.mu.Lock()
			m.updatePending = false
			m.mu.Unlock()
			m.setError(e)
			action(w, e)
			return
		}
		m.mu.Lock()
		m.updatePending = false
		m.mu.Unlock()
		_ = m.CheckUpdate()
		action(w, nil)
	})
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) { respond(w, m.Snapshot(), 200) })
	for _, operation := range []string{"select", "delete", "download", "clear"} {
		mux.HandleFunc("POST /api/models/"+operation, func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				ID string `json:"id"`
			}
			if !decode(w, r, &body) {
				return
			}
			if operation == "select" {
				action(w, m.SelectModel(body.ID))
			} else if operation == "clear" {
				action(w, m.ClearModel(body.ID))
			} else if operation == "download" {
				action(w, m.DownloadModel(body.ID))
			} else {
				action(w, m.DeleteModel(body.ID))
			}
		})
	}
	for _, operation := range []string{"delete", "download"} {
		mux.HandleFunc("POST /api/runtimes/"+operation, func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				ID string `json:"id"`
			}
			if !decode(w, r, &body) {
				return
			}
			if operation == "delete" {
				action(w, m.DeleteRuntime(body.ID))
			} else {
				action(w, m.DownloadRuntime(body.ID))
			}
		})
	}
	mux.HandleFunc("POST /api/import", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Source string `json:"source"`
			Jobs   string `json:"jobs"`
		}
		if !decode(w, r, &body) {
			return
		}
		action(w, m.ImportDataOptions(body.Source, ImportOptions{Jobs: body.Jobs}))
	})
	mux.HandleFunc("POST /api/setup", func(w http.ResponseWriter, r *http.Request) { action(w, m.BeginSetup()) })
	mux.HandleFunc("POST /api/pause", func(w http.ResponseWriter, r *http.Request) { m.Pause(); action(w, nil) })
	mux.HandleFunc("POST /api/start", func(w http.ResponseWriter, r *http.Request) { action(w, m.Start()) })
	mux.HandleFunc("POST /api/stop", func(w http.ResponseWriter, r *http.Request) { action(w, m.Stop()) })
	mux.HandleFunc("POST /api/quit", func(w http.ResponseWriter, r *http.Request) {
		action(w, nil)
		go func() { time.Sleep(200 * time.Millisecond); m.shutdown() }()
	})
	mux.HandleFunc("POST /api/settings", func(w http.ResponseWriter, r *http.Request) {
		var settings Settings
		if !decode(w, r, &settings) {
			return
		}
		action(w, m.UpdateSettings(settings))
	})
	mux.HandleFunc("GET /api/logs", func(w http.ResponseWriter, r *http.Request) {
		text, e := m.ReadLog(r.URL.Query().Get("name"))
		if e != nil {
			respond(w, map[string]string{"error": e.Error()}, 400)
			return
		}
		respond(w, map[string]string{"text": text}, 200)
	})
	mux.HandleFunc("POST /api/pair-code", func(w http.ResponseWriter, r *http.Request) {
		code, e := m.PairCode()
		if e != nil {
			action(w, e)
			return
		}
		respond(w, map[string]string{"code": code}, 200)
	})
	mux.HandleFunc("POST /api/open/extension", func(w http.ResponseWriter, r *http.Request) {
		action(w, openFolder(filepath.Join(m.root, "extension")))
	})
	mux.HandleFunc("POST /api/open/root", func(w http.ResponseWriter, r *http.Request) { action(w, openFolder(m.root)) })
	mux.HandleFunc("POST /api/open/chrome", func(w http.ResponseWriter, r *http.Request) { action(w, openChrome(m.root)) })
	pairHandler := func(w http.ResponseWriter, r *http.Request) {
		expected := "chrome-extension://" + m.extensionID
		origin := r.Header.Get("Origin")
		if m.extensionID == "" || (origin != expected && !(origin == "" && r.Header.Get("X-Manga-Extension") == m.extensionID)) {
			respond(w, map[string]string{"error": "허용되지 않은 확장입니다"}, 403)
			return
		}
		if origin == expected {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "POST,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type,X-Manga-Extension")
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		if r.Method != http.MethodPost {
			w.WriteHeader(405)
			return
		}
		var body struct {
			Code string `json:"code"`
		}
		if !decode(w, r, &body) {
			return
		}
		result, e := m.Pair(body.Code)
		if e != nil {
			respond(w, map[string]string{"error": e.Error()}, 400)
			return
		}
		respond(w, result, 200)
	}
	mux.HandleFunc("POST /api/extension/pair", pairHandler)
	mux.HandleFunc("OPTIONS /api/extension/pair", pairHandler)
	mux.HandleFunc("GET /extension.zip", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="manga-translator-extension.zip"`)
		z := zip.NewWriter(w)
		defer z.Close()
		entries, e := fs.ReadDir(m.bundle, "extension")
		if e != nil {
			return
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			data, e := fs.ReadFile(m.bundle, "extension/"+entry.Name())
			if e != nil {
				return
			}
			f, e := z.Create(entry.Name())
			if e != nil {
				return
			}
			f.Write(data)
		}
	})
	web, e := fs.Sub(m.bundle, "web")
	if e != nil {
		panic(e)
	}
	files := http.FileServer(http.FS(web))
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			respond(w, map[string]string{"error": "Not found"}, 404)
			return
		}
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if _, e := fs.Stat(web, p); e != nil {
			if strings.Contains(filepath.Base(p), ".") {
				http.NotFound(w, r)
				return
			}
			p = "index.html"
		}
		if p == "index.html" {
			data, e := fs.ReadFile(web, p)
			if e != nil {
				http.Error(w, "UI build missing", 500)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(data)
			return
		}
		files.ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, port, e := net.SplitHostPort(r.Host)
		if e != nil || (host != "127.0.0.1" && host != "localhost") || port != fmt.Sprint(ControlPort) {
			respond(w, map[string]string{"error": "잘못된 Host"}, 403)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
		if r.URL.Path != "/api/extension/pair" && !strings.HasPrefix(r.URL.Path, "/api/library/presentation/") && r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("Origin") != "http://"+r.Host || r.Header.Get("X-Manga-Control") != "1" {
				respond(w, map[string]string{"error": "관리 화면에서 요청하세요"}, 403)
				return
			}
		}
		m.mu.Lock()
		updating := m.updatePending
		m.mu.Unlock()
		if updating && r.Method != "GET" && r.Method != "HEAD" && r.URL.Path != "/api/quit" && r.URL.Path != "/api/update/activate" {
			respond(w, map[string]string{"error": "업데이트 설치가 진행 중입니다"}, 409)
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func respond(w http.ResponseWriter, v any, status int) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func action(w http.ResponseWriter, e error) {
	if e != nil {
		respond(w, map[string]string{"error": e.Error()}, 409)
	} else {
		respond(w, map[string]bool{"ok": true}, 202)
	}
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		respond(w, map[string]string{"error": "JSON 요청이 필요합니다"}, 415)
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if e := decoder.Decode(v); e != nil {
		respond(w, map[string]string{"error": "잘못된 요청 형식"}, 400)
		return false
	}
	if decoder.Decode(new(any)) != io.EOF {
		respond(w, map[string]string{"error": "잘못된 요청 형식"}, 400)
		return false
	}
	return true
}
func (m *Manager) LogWriter() (*os.File, error) {
	return os.OpenFile(filepath.Join(m.root, "data", "control.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
}
func NewServer(handler http.Handler) *http.Server {
	return &http.Server{Handler: handler, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 20 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024}
}
