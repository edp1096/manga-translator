package control

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

func Run(dataRoot string, bundle fs.FS, noSetup, noOpen bool) error {
	if !filepath.IsAbs(dataRoot) {
		return fmt.Errorf("application data directory must be absolute")
	}
	root := filepath.Clean(dataRoot)
	var e error
	if e = os.MkdirAll(filepath.Join(root, "data"), 0700); e != nil {
		return e
	}
	root, e = filepath.EvalSymlinks(root)
	if e != nil {
		return e
	}
	listener, e := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", ControlPort))
	if e != nil {
		client := &http.Client{Timeout: time.Second}
		if response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/api/state", ControlPort)); err == nil {
			var existing struct {
				Version string `json:"version"`
				Root    string `json:"root"`
			}
			decodeErr := json.NewDecoder(io.LimitReader(response.Body, 128*1024)).Decode(&existing)
			response.Body.Close()
			if decodeErr == nil && existing.Version == Version && (filepath.Clean(existing.Root) == filepath.Clean(root) || runtime.GOOS == "windows" && strings.EqualFold(filepath.Clean(existing.Root), filepath.Clean(root))) {
				if !noOpen {
					return OpenURL(fmt.Sprintf("http://127.0.0.1:%d", ControlPort))
				}
				return nil
			}
		}
		return fmt.Errorf("관리 화면 포트 %d가 사용 중입니다: %w", ControlPort, e)
	}
	defer listener.Close()
	unlock, e := lockRoot(root)
	if e != nil {
		return e
	}
	defer unlock()
	if e = recoverMigration(root); e != nil {
		return e
	}
	p := filepath.Join(root, "data", "control.log")
	if st, e := os.Stat(p); e == nil && st.Size() > 5*1024*1024 {
		os.Remove(p + ".1")
		os.Rename(p, p+".1")
	}
	f, e := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	defer f.Close()
	logger := log.New(io.MultiWriter(f, os.Stdout), "", log.LstdFlags)
	m, e := NewManager(root, bundle, logger)
	if e != nil {
		return e
	}
	defer m.Close()
	if !noSetup {
		if e = m.StartInstalled(); e != nil {
			m.setError(e)
		}
	}
	server := NewServer(m.Handler())
	errorsCh := make(chan error, 1)
	go func() { errorsCh <- server.Serve(listener) }()
	logger.Printf("Manga Translator %s · http://127.0.0.1:%d", Version, ControlPort)
	if !noOpen {
		if e = OpenURL(fmt.Sprintf("http://127.0.0.1:%d", ControlPort)); e != nil {
			logger.Printf("브라우저를 열지 못했습니다: %v", e)
		}
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	select {
	case <-ctx.Done():
	case <-m.ctx.Done():
	case e = <-errorsCh:
		if !errors.Is(e, http.ErrServerClosed) {
			return e
		}
	}
	shutdown, done := context.WithTimeout(context.Background(), 5*time.Second)
	defer done()
	_ = server.Shutdown(shutdown)
	return nil
}
