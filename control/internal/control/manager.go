package control

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"time"
)

type Settings struct {
	GPU             string `json:"gpu,omitempty"`
	Profile         string `json:"profile,omitempty"`
	LLMExecution    string `json:"llmExecution,omitempty"`
	LayoutExecution string `json:"layoutExecution,omitempty"`
	OCRExecution    string `json:"ocrExecution,omitempty"`

	Layout      string `json:"layout"`
	OCR         string `json:"ocr"`
	Model       string `json:"model"`
	AutoStart   bool   `json:"autoStart"`
	Threads     int    `json:"threads"`
	ThreadsAuto bool   `json:"threadsAuto"`
}
type Progress struct {
	Stage     string `json:"stage"`
	Current   string `json:"current"`
	Name      string `json:"name"`
	Bytes     int64  `json:"bytes"`
	Total     int64  `json:"total"`
	Completed int    `json:"completed"`
	Count     int    `json:"count"`
	Error     string `json:"error,omitempty"`
}
type Component struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Ready bool   `json:"ready"`
	Size  int64  `json:"size"`
	Files int    `json:"files"`
}
type ServiceState struct {
	Name    string  `json:"name"`
	Ready   bool    `json:"ready"`
	Managed bool    `json:"managed"`
	PID     int     `json:"pid,omitempty"`
	URL     string  `json:"url"`
	Active  int     `json:"active"`
	RSS     float64 `json:"rssMiB,omitempty"`
}
type Snapshot struct {
	Profiles []ExecutionProfile `json:"profiles"`

	Runtimes      []RuntimeState `json:"runtimes"`
	Models        []ModelState   `json:"models"`
	Version       string         `json:"version"`
	Platform      string         `json:"platform"`
	Supported     bool           `json:"supported"`
	Root          string         `json:"root"`
	Ready         bool           `json:"ready"`
	Busy          bool           `json:"busy"`
	Phase         string         `json:"phase"`
	Error         string         `json:"error,omitempty"`
	Progress      Progress       `json:"progress"`
	Components    []Component    `json:"components"`
	Services      []ServiceState `json:"services"`
	Settings      Settings       `json:"settings"`
	ExtensionID   string         `json:"extensionId"`
	ExtensionPath string         `json:"extensionPath"`
	Licenses      []License      `json:"licenses"`
	System        SystemInfo     `json:"system"`
	Hardware      HardwareInfo   `json:"hardware"`
}
type managedProcess struct {
	cmd      *exec.Cmd
	done     chan struct{}
	err      error
	log      *os.File
	resource processResource
}
type Manager struct {
	root          string
	platform      string
	bundle        fs.FS
	catalog       Catalog
	downloader    *Downloader
	extensionID   string
	mu            sync.Mutex
	operation     sync.Mutex
	settings      Settings
	receipts      map[string]Receipt
	progress      Progress
	phase         string
	lastError     string
	busy          bool
	cancel        context.CancelFunc
	generation    uint64
	prerequisites func(context.Context, string, []OutputFile) error
	processes     map[string]*managedProcess
	services      map[string]ServiceState
	pairCodes     map[string]time.Time
	logger        *log.Logger
	ctx           context.Context
	shutdown      context.CancelFunc
}

func NewManager(root string, bundle fs.FS, logger *log.Logger) (*Manager, error) {
	absolute, e := filepath.Abs(root)
	if e != nil {
		return nil, e
	}
	if e = os.MkdirAll(absolute, 0700); e != nil {
		return nil, e
	}
	absolute, e = filepath.EvalSymlinks(absolute)
	if e != nil {
		return nil, e
	}
	c, e := loadCatalog(bundle, currentPlatform())
	if e != nil {
		return nil, e
	}
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{root: absolute, platform: currentPlatform(), bundle: bundle, catalog: c, downloader: NewDownloader(), prerequisites: ensurePrerequisites, receipts: map[string]Receipt{}, processes: map[string]*managedProcess{}, services: map[string]ServiceState{}, pairCodes: map[string]time.Time{}, settings: Settings{AutoStart: false, Threads: detectedCPU().RecommendedThreads, ThreadsAuto: true}, phase: "idle", logger: logger, ctx: ctx, shutdown: cancel}
	legacySettings := false
	if raw, e := os.ReadFile(filepath.Join(absolute, "config", "control.json")); e == nil {
		var fields map[string]json.RawMessage
		_ = json.Unmarshal(raw, &fields)
		_, hasModel := fields["model"]
		if _, hasAuto := fields["threadsAuto"]; !hasAuto {
			m.settings.ThreadsAuto = false
		}
		legacySettings = !hasModel
		if e = json.Unmarshal(raw, &m.settings); e != nil {
			cancel()
			return nil, fmt.Errorf("control settings: %w", e)
		}
	}
	// Version 0.3.0 did not save control.json until the user changed settings.
	if _, err := os.Stat(filepath.Join(absolute, "config", "control.json")); os.IsNotExist(err) {
		if raw, err := os.ReadFile(filepath.Join(absolute, "config", "native_api.json")); err == nil {
			var old struct {
				Model   string `json:"llm_model"`
				Threads int    `json:"threads"`
			}
			if json.Unmarshal(raw, &old) == nil && old.Model == "gemma4-e2b-local" {
				legacySettings = true
				m.settings.AutoStart = true
				if old.Threads > 0 {
					m.settings.Threads = old.Threads
					m.settings.ThreadsAuto = false
				}
			}
		}
	}
	// Older installed copies used E2B. Fresh folders remain unselected.
	if legacySettings {
		for _, a := range c.Artifacts {
			if a.ID == "gemma" {
				if st, err := os.Stat(filepath.Join(absolute, filepath.FromSlash(a.Files[0].Path))); err == nil && st.Size() == a.Files[0].Size {
					m.settings.Model = "gemma"
					m.settings.Layout = "koharu-768"
					m.settings.OCR = "hayai-int8"
				}
			}
		}
	}
	if legacySettings {
		if err := writeJSON(filepath.Join(absolute, "config", "control.json"), m.settings); err != nil {
			cancel()
			return nil, err
		}
	}
	if m.settings.ThreadsAuto || m.settings.Threads < 1 || m.settings.Threads > detectedCPU().Logical {
		m.settings.Threads = detectedCPU().RecommendedThreads
		m.settings.ThreadsAuto = true
	}
	if raw, e := os.ReadFile(filepath.Join(absolute, "data", "install-state.json")); e == nil {
		if json.Unmarshal(raw, &m.receipts) != nil {
			m.receipts = map[string]Receipt{}
		}
	}
	if raw, e := fs.ReadFile(bundle, "extension-id.txt"); e == nil {
		m.extensionID = strings.TrimSpace(string(raw))
	}
	if e = m.ensureCredentials(); e != nil {
		cancel()
		return nil, e
	}
	if e = m.installExtension(); e != nil {
		cancel()
		return nil, e
	}
	go m.monitor()
	return m, nil
}
func (m *Manager) Root() string { return m.root }
func (m *Manager) logf(format string, args ...any) {
	if m.logger != nil {
		m.logger.Printf(format, args...)
	}
}
func randomSecret() (string, error) {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", e
	}
	return hex.EncodeToString(b), nil
}
func (m *Manager) ensureCredentials() error {
	for _, rel := range []string{"data/api-key", "data/native_api/access-token"} {
		p := filepath.Join(m.root, filepath.FromSlash(rel))
		if data, e := os.ReadFile(p); e == nil {
			if len(strings.TrimSpace(string(data))) < 32 {
				return fmt.Errorf("기존 접근 키 파일이 올바르지 않습니다: %s", rel)
			}
			continue
		} else if !os.IsNotExist(e) {
			return e
		}
		token, e := randomSecret()
		if e != nil {
			return e
		}
		if e = atomicBytes(p, []byte(token+"\n"), 0600); e != nil {
			return e
		}
	}
	return nil
}
func (m *Manager) installExtension() error {
	for _, dir := range []string{"extension", "licenses"} {
		entries, e := fs.ReadDir(m.bundle, dir)
		if e != nil {
			if dir == "licenses" && os.IsNotExist(e) {
				continue
			}
			return e
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			data, e := fs.ReadFile(m.bundle, dir+"/"+entry.Name())
			if e != nil {
				return e
			}
			p := filepath.Join(m.root, dir, entry.Name())
			old, _ := os.ReadFile(p)
			if bytes.Equal(data, old) {
				continue
			}
			if e = atomicBytes(p, data, 0644); e != nil {
				return e
			}
		}
	}
	return nil
}
func (m *Manager) fileReady(f OutputFile) bool {
	p, e := safeDestination(m.root, f.Path)
	if e != nil {
		return false
	}
	st, e := os.Stat(p)
	if e != nil || !st.Mode().IsRegular() || st.Size() != f.Size {
		return false
	}
	m.mu.Lock()
	r, ok := m.receipts[f.Path]
	m.mu.Unlock()
	return ok && r.Size == f.Size && r.Modified == st.ModTime().UnixNano() && r.SHA256 == f.SHA256
}
func (m *Manager) artifactReady(a Artifact) bool {
	for _, f := range a.Files {
		if !m.fileReady(f) {
			return false
		}
	}
	return true
}
func (m *Manager) allReady() bool {
	if !supportedPlatform(m.platform) || !m.hasSelection() {
		return false
	}
	for _, a := range m.selectedArtifacts() {
		if !m.artifactReady(a) {
			return false
		}
	}
	return true
}
func (m *Manager) verifyExisting(ctx context.Context, a Artifact) (bool, error) {
	all := true
	for _, f := range a.Files {
		if e := ctx.Err(); e != nil {
			return false, e
		}
		p, e := safeDestination(m.root, f.Path)
		if e != nil {
			return false, e
		}
		st, e := os.Stat(p)
		if e != nil || st.Size() != f.Size {
			all = false
			continue
		}
		file, e := os.Open(p)
		if e != nil {
			all = false
			continue
		}
		hash, e := hashReader(contextReader{ctx, file})
		file.Close()
		if e != nil {
			return false, e
		}
		if hash != f.SHA256 {
			all = false
			continue
		}
		m.mu.Lock()
		m.receipts[f.Path] = Receipt{f.SHA256, st.Size(), st.ModTime().UnixNano()}
		m.mu.Unlock()
	}
	return all, nil
}
func (m *Manager) saveReceipts() error {
	m.mu.Lock()
	copy := make(map[string]Receipt, len(m.receipts))
	for k, v := range m.receipts {
		copy[k] = v
	}
	m.mu.Unlock()
	return writeJSON(filepath.Join(m.root, "data", "install-state.json"), copy)
}
func (m *Manager) record(a Artifact) error {
	for _, f := range a.Files {
		p, e := safeDestination(m.root, f.Path)
		if e != nil {
			return e
		}
		st, e := os.Stat(p)
		if e != nil {
			return e
		}
		m.mu.Lock()
		m.receipts[f.Path] = Receipt{f.SHA256, st.Size(), st.ModTime().UnixNano()}
		m.mu.Unlock()
	}
	return m.saveReceipts()
}
func (m *Manager) BeginSetup() error {
	if !m.hasSelection() {
		return fmt.Errorf("탐지·OCR·번역 모델을 각각 선택하세요")
	}
	return m.beginSetup("")
}
func (m *Manager) DownloadModel(id string) error {
	if m.modelByID(id) == nil {
		return fmt.Errorf("알 수 없는 모델입니다")
	}
	return m.beginSetup(id)
}
func (m *Manager) beginSetup(modelID string) error {

	if err := m.ctx.Err(); err != nil {
		return err
	}
	if !supportedPlatform(m.platform) {
		return fmt.Errorf("이 운영체제는 아직 지원하지 않습니다")
	}
	m.mu.Lock()
	if m.busy || len(m.processes) > 0 {
		m.mu.Unlock()
		return fmt.Errorf("진행 중인 작업 또는 API를 먼저 중지하세요")
	}
	m.busy = true
	m.phase = "preparing"
	m.lastError = ""
	ctx, cancel := context.WithCancel(m.ctx)
	m.cancel = cancel
	m.generation++
	generation := m.generation
	m.progress = Progress{Stage: "verifying", Count: 0}
	m.mu.Unlock()
	go func() {
		defer cancel()
		m.operation.Lock()
		e := m.setup(ctx, modelID)
		debug.FreeOSMemory()
		m.operation.Unlock()
		m.mu.Lock()
		if m.generation != generation {
			m.mu.Unlock()
			return
		}
		m.busy = false
		m.cancel = nil
		if e != nil {
			if errors.Is(e, context.Canceled) {
				m.phase = "paused"
				m.progress.Stage = "paused"
			} else {
				m.phase = "error"
				m.lastError = e.Error()
				m.progress.Error = e.Error()
				m.progress.Stage = "error"
			}
		} else {
			m.phase = "ready"
			m.progress.Stage = "done"
		}
		auto := m.settings.AutoStart && modelID == ""
		m.mu.Unlock()
		if e != nil {
			m.logf("준비 중단: %v", e)
		} else {
			m.logf("필요한 파일 준비 완료")
			if auto {
				if e = m.Start(); e != nil {
					m.setError(e)
				}
			}
		}
	}()
	return nil
}
func (m *Manager) setup(ctx context.Context, modelID string) error {
	artifacts := m.selectedArtifacts()
	if modelID != "" {
		if strings.HasPrefix(modelID, "runtime:") {
			r := m.runtimeByID(strings.TrimPrefix(modelID, "runtime:"))
			if r == nil {
				return fmt.Errorf("unknown runtime")
			}
			artifacts = m.runtimeArtifacts(*r)
			if m.platform == "windows-amd64" && r.ID != "vcredist" {
				for _, a := range m.catalog.Artifacts {
					if a.ID == "vcredist-windows-amd64" {
						artifacts = append(artifacts, a)
					}
				}
			}
		} else {
			artifacts = m.artifactsFor([]string{modelID}, false)
		}
	}
	for i, a := range artifacts {
		if e := ctx.Err(); e != nil {
			return e
		}
		m.mu.Lock()
		m.progress = Progress{Stage: "verifying", Current: a.ID, Name: a.Name, Completed: i, Count: len(artifacts), Total: a.Size}
		m.mu.Unlock()
		ready, e := m.verifyExisting(ctx, a)
		if e != nil {
			return e
		}
		if ready {
			if e = m.saveReceipts(); e != nil {
				return e
			}
			continue
		}
		if sys := systemInfo(m.root); sys.DiskFree > 0 && sys.DiskFree < a.Size+512*1024*1024 {
			return fmt.Errorf("저장 공간이 부족합니다. %s 이상 확보한 뒤 다시 시작하세요", formatBytes(a.Size+512*1024*1024))
		}
		m.mu.Lock()
		m.progress.Stage = "downloading"
		m.mu.Unlock()
		m.logf("준비: %s", a.Name)
		var source string
		if isEmbedded(a) {
			name := strings.TrimPrefix(a.URL, "embedded:")
			if _, e = safeRelative(name); e != nil {
				return e
			}
			data, e := fs.ReadFile(m.bundle, name)
			if e != nil {
				return e
			}
			h, _ := hashReader(bytes.NewReader(data))
			if h != a.SHA256 || int64(len(data)) != a.Size {
				return fmt.Errorf("내장 실행 파일 체크섬 불일치")
			}
			source = filepath.Join(m.root, "data", "downloads", a.ID+".embedded")
			if e = atomicBytes(source, data, 0600); e != nil {
				return e
			}
		} else {
			source, e = m.downloader.Fetch(ctx, a, filepath.Join(m.root, "data", "downloads"), func(n int64) { m.mu.Lock(); m.progress.Bytes = n; m.mu.Unlock() })
			if e != nil {
				return e
			}
		}
		m.mu.Lock()
		m.progress.Stage = "installing"
		m.mu.Unlock()
		if e = installArtifact(ctx, m.root, a, source, m.bundle); e != nil {
			return fmt.Errorf("%s: %w", a.Name, e)
		}
		os.Remove(source)
		if e = m.record(a); e != nil {
			return e
		}
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	m.mu.Lock()
	m.progress.Stage = "prerequisites"
	m.progress.Name = "실행 환경 확인"
	m.mu.Unlock()
	if e := m.prerequisites(ctx, m.root, prerequisiteFiles(artifacts)); e != nil {
		return e
	}
	if modelID == "" {
		if e := m.writeNativeConfig(); e != nil {
			return e
		}
	}
	m.mu.Lock()
	m.progress.Completed = len(artifacts)
	m.mu.Unlock()
	return nil
}
func (m *Manager) Pause() {
	m.mu.Lock()
	cancel := m.cancel
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}
func (m *Manager) setError(e error) {
	m.mu.Lock()
	m.lastError = e.Error()
	m.phase = "error"
	m.mu.Unlock()
	m.logf("오류: %v", e)
}
func (m *Manager) writeNativeConfig() error {
	m.mu.Lock()
	settings := m.settings
	threads := settings.Threads
	modelID := settings.Model
	m.mu.Unlock()
	if err := m.validateExecution(settings); err != nil {
		return err
	}
	cfg := map[string]any{"host": "127.0.0.1", "port": VisionPort, "data_dir": "data/native_api", "layout_model": m.selectedPath("layout"), "ocr_dir": m.selectedPath("ocr"), "ocr_backend": m.selectedOCRBackend(), "threads": threads, "llm_host": "127.0.0.1", "llm_port": LLMPort, "llm_model": modelID, "llm_key_file": "data/api-key"}
	cfg["llm_execution"] = execution(settings.LLMExecution)
	cfg["layout_execution"] = execution(settings.LayoutExecution)
	cfg["ocr_execution"] = execution(settings.OCRExecution)
	// Restoration is an optional local model. Its absence must not block normal
	// translation or cause an implicit model download at startup.
	const restorationModel = "models/manga-lama/manga-lama-512.onnx"
	if info, err := os.Stat(filepath.Join(m.root, filepath.FromSlash(restorationModel))); err == nil && info.Mode().IsRegular() {
		cfg["inpaint_model"] = restorationModel
		cfg["inpaint_execution"] = execution(settings.LayoutExecution)
	}
	if ort := m.runtimeForSettings("ort", settings); ort != nil && ort.Library != "" {
		cfg["ort_library"] = ort.Library
	}
	// The verifier runs only for a single unstable Han glyph; the selected
	// primary OCR and its execution backend stay unchanged.
	if m.selectedOCRBackend() == "onnx-v2-kv" {
		if verifier := m.modelForGroup("baberu-int4", "ocr"); verifier != nil {
			cfg["ocr_verifier_dir"] = verifier.Path
			cfg["ocr_verifier_execution"] = "cpu"
		}
	}
	cfg["ocr_encoder_execution"] = execution(settings.OCRExecution)
	cfg["ocr_decoder_execution"] = execution(settings.OCRExecution)
	if backend := m.selectedOCRBackend(); backend == "baberu-int4" || backend == "baberu-fp16" {
		cfg["ocr_decoder_execution"] = "cpu"
	}
	var gpu GPUInfo
	var err error
	if usesGPU(settings) {
		gpu, err = selectedGPU(settings, executionGPUs(probeGPUs()))
	}
	if err != nil {
		return err
	}
	cfg["gpu_index"] = onnxGPUIndex(settings, gpu)
	cfg["gpu_name"] = gpu.Name
	if r := m.runtimeForSettings("litert", settings); m.selectedOCRBackend() == "litert" && r != nil {
		cfg["litert_library"] = r.Library
	}
	return writeJSON(filepath.Join(m.root, "config", "native_api.json"), cfg)
}
func (m *Manager) UpdateSettings(settings Settings) error {
	if err := m.validateExecution(settings); err != nil {
		return err
	}
	if usesGPU(settings) {
		if _, err := selectedGPU(settings, executionGPUs(probeGPUs())); err != nil {
			return err
		}
	}
	if settings.Model != "" && m.modelForGroup(settings.Model, "translation") == nil {
		return fmt.Errorf("알 수 없는 모델")
	}
	if (settings.Layout != "" && m.modelForGroup(settings.Layout, "layout") == nil) || (settings.OCR != "" && m.modelForGroup(settings.OCR, "ocr") == nil) {
		return fmt.Errorf("알 수 없는 탐지/OCR 모델")
	}
	if settings.ThreadsAuto {
		settings.Threads = detectedCPU().RecommendedThreads
	}
	if settings.Threads < 1 || settings.Threads > detectedCPU().Logical {
		return fmt.Errorf("스레드 수는 1~%d 범위여야 합니다", detectedCPU().Logical)
	}
	m.mu.Lock()
	if m.busy || len(m.processes) > 0 {
		m.mu.Unlock()
		return fmt.Errorf("API를 중지한 뒤 설정을 바꾸세요")
	}
	defer m.mu.Unlock()
	if err := writeJSON(filepath.Join(m.root, "config", "control.json"), settings); err != nil {
		return err
	}
	m.settings = settings
	m.lastError = ""
	m.phase = "idle"
	return nil
}
func (m *Manager) Start() error {
	if err := m.ctx.Err(); err != nil {
		return err
	}
	if !m.allReady() {
		return fmt.Errorf("먼저 필요한 파일을 준비하세요")
	}
	m.mu.Lock()
	if m.busy || len(m.processes) > 0 {
		m.mu.Unlock()
		return fmt.Errorf("API가 이미 실행 중이거나 준비 중입니다")
	}
	m.busy = true
	m.phase = "starting"
	m.lastError = ""
	ctx, cancel := context.WithCancel(m.ctx)
	m.cancel = cancel
	m.generation++
	generation := m.generation
	m.mu.Unlock()
	go func() {
		defer cancel()
		m.operation.Lock()
		e := m.start(ctx)
		if e != nil {
			m.stopProcesses()
		}
		m.operation.Unlock()
		m.mu.Lock()
		if m.generation != generation {
			m.mu.Unlock()
			return
		}
		m.busy = false
		m.cancel = nil
		if e != nil {
			m.phase = "error"
			m.lastError = e.Error()
		} else {
			m.phase = "running"
		}
		m.mu.Unlock()
		if e != nil {
			m.logf("API 시작 실패: %v", e)
		} else {
			m.logf("번역 API 준비 완료")
		}
	}()
	return nil
}
func (m *Manager) start(ctx context.Context) error {
	if e := ctx.Err(); e != nil {
		return e
	}
	if e := m.prerequisites(ctx, m.root, prerequisiteFiles(m.selectedArtifacts())); e != nil {
		return e
	}
	if e := m.writeNativeConfig(); e != nil {
		return e
	}
	for _, port := range []int{LLMPort, VisionPort} {
		connection, e := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 500*time.Millisecond)
		if e == nil {
			connection.Close()
			return fmt.Errorf("%d 포트를 다른 프로그램이 사용 중입니다. 기존 API를 종료한 뒤 다시 시작하세요", port)
		}
		if timeout, ok := e.(net.Error); ok && timeout.Timeout() {
			return fmt.Errorf("%d 포트가 응답하지 않습니다. 기존 API를 확인하세요", port)
		}
	}
	m.mu.Lock()
	threads := m.settings.Threads
	m.mu.Unlock()
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	m.mu.Lock()
	settings := m.settings
	modelID := settings.Model
	m.mu.Unlock()
	model := m.modelForGroup(modelID, "translation")
	if model == nil {
		return fmt.Errorf("번역 모델을 선택하세요")
	}
	args := []string{"-m", filepath.Join(m.root, filepath.FromSlash(model.Path)), "--device", "none", "--gpu-layers", "0", "--no-op-offload", "--threads", fmt.Sprint(threads), "--threads-batch", fmt.Sprint(threads), "--ctx-size", "4096", "--parallel", "1", "--batch-size", "512", "--ubatch-size", "512", "--flash-attn", "off", "--cache-ram", "0", "--host", "127.0.0.1", "--port", fmt.Sprint(LLMPort), "--alias", modelID, "--api-key-file", filepath.Join(m.root, "data", "api-key"), "--jinja", "--reasoning", "off", "--reasoning-budget", "0", "--n-predict", "2048"}
	args = llmExecutionArgs(args, settings.LLMExecution)
	args, modelArgsError := m.llmModelArgs(args, *model, settings.LLMExecution)
	if modelArgsError != nil {
		return modelArgsError
	}
	r := m.runtimeForSettings("llama", settings)
	if r == nil {
		return fmt.Errorf("번역 런타임을 찾을 수 없습니다")
	}
	binary, err := safeDestination(m.root, r.Executable)
	if err != nil {
		return err
	}
	if e := m.launch("llm", binary, args); e != nil {
		return e
	}
	if e := m.waitHealthy(ctx, "llm", LLMPort, 3*time.Minute); e != nil {
		return e
	}
	_, required := m.visionRequirements()
	if sys := systemInfo(m.root); sys.MemoryAvailable > 0 && sys.MemoryAvailable < required {
		return fmt.Errorf("선택한 탐지 모델을 시작하려면 여유 메모리 %s 이상이 필요합니다", formatBytes(required))
	}
	if e := m.launch("vision", filepath.Join(m.root, "bin", "manga-translator-server"+ext), []string{"--root", m.root}); e != nil {
		return e
	}
	return m.waitHealthy(ctx, "vision", VisionPort, 45*time.Second)
}
func (m *Manager) launch(name, binary string, args []string) error {
	for _, dir := range []string{"data/cache/llama", "data/cache/litert", "data/cache/cuda", "data/cache/shaders", "data/tmp"} {
		if err := os.MkdirAll(filepath.Join(m.root, filepath.FromSlash(dir)), 0700); err != nil {
			return err
		}
	}
	logPath := filepath.Join(m.root, "data", name+".log")
	if st, e := os.Stat(logPath); e == nil && st.Size() > 5*1024*1024 {
		os.Remove(logPath + ".1")
		os.Rename(logPath, logPath+".1")
	}
	f, e := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	cmd := exec.Command(binary, args...)
	cmd.Dir = m.root
	libraryDirs, e := m.runtimeLibraryDirs(name)
	if e != nil {
		f.Close()
		return e
	}
	cmd.Env = processEnvironment(m.root, libraryDirs)
	m.mu.Lock()
	settings := m.settings
	m.mu.Unlock()
	if name == "llm" && execution(settings.LLMExecution) != "cpu" {
		gpu, err := selectedGPU(settings, executionGPUs(probeGPUs()))
		if err != nil {
			f.Close()
			return err
		}
		cmd.Env = replaceEnvironment(cmd.Env, llmGPUEnvironment(settings.LLMExecution, gpu))
	}
	cmd.Stdout = f
	cmd.Stderr = f
	configureProcess(cmd)
	if e = cmd.Start(); e != nil {
		f.Close()
		return fmt.Errorf("%s 실행 실패: %w", name, e)
	}
	resource, e := attachProcess(cmd)
	if e != nil {
		cmd.Process.Kill()
		cmd.Wait()
		f.Close()
		return e
	}
	p := &managedProcess{cmd: cmd, done: make(chan struct{}), log: f, resource: resource}
	m.mu.Lock()
	m.processes[name] = p
	m.mu.Unlock()
	go func() {
		e := cmd.Wait()
		f.Close()
		releaseProcess(resource)
		m.mu.Lock()
		p.err = e
		m.mu.Unlock()
		close(p.done)
	}()
	m.logf("%s API 시작 (PID %d)", name, cmd.Process.Pid)
	return nil
}
func (m *Manager) waitHealthy(ctx context.Context, name string, port int, timeout time.Duration) error {
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	for {
		m.mu.Lock()
		p := m.processes[name]
		m.mu.Unlock()
		if p == nil {
			return fmt.Errorf("%s 프로세스가 없습니다", name)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-p.done:
			m.mu.Lock()
			e := p.err
			m.mu.Unlock()
			return fmt.Errorf("%s API가 종료됐습니다 (%v). 실행 기록을 확인하세요", name, e)
		case <-deadline.C:
			return fmt.Errorf("%s API 준비 시간이 초과되었습니다", name)
		case <-tick.C:
			if health(port).Ready {
				return nil
			}
		}
	}
}
func (m *Manager) Stop() error {
	m.mu.Lock()
	if m.phase == "stopping" {
		m.mu.Unlock()
		return nil
	}
	cancel := m.cancel
	m.generation++
	generation := m.generation
	m.phase = "stopping"
	m.busy = true
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	go func() {
		m.operation.Lock()
		m.stopProcesses()
		m.operation.Unlock()
		m.mu.Lock()
		if m.generation != generation {
			m.mu.Unlock()
			return
		}
		m.busy = false
		m.cancel = nil
		m.phase = "ready"
		m.mu.Unlock()
		m.logf("API 중지 완료")
	}()
	return nil
}
func (m *Manager) stopProcesses() {
	for _, name := range []string{"vision", "llm"} {
		m.mu.Lock()
		p := m.processes[name]
		m.mu.Unlock()
		if p == nil {
			continue
		}
		if name == "vision" {
			token, _ := os.ReadFile(filepath.Join(m.root, "data", "native_api", "access-token"))
			request, _ := http.NewRequest(http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/api/shutdown", VisionPort), nil)
			request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
			client := &http.Client{Timeout: time.Second}
			if response, e := client.Do(request); e == nil {
				response.Body.Close()
			}
		}
		stopProcess(p.cmd, p.resource, p.done)
		m.mu.Lock()
		delete(m.processes, name)
		m.mu.Unlock()
	}
}
func health(port int) ServiceState {
	s := ServiceState{URL: fmt.Sprintf("http://127.0.0.1:%d", port)}
	client := &http.Client{Timeout: 800 * time.Millisecond}
	r, e := client.Get(s.URL + "/health")
	if e != nil {
		return s
	}
	defer r.Body.Close()
	if r.StatusCode != 200 {
		return s
	}
	var body struct {
		Active int     `json:"active"`
		MaxRSS float64 `json:"maxRssMiB"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&body) != nil {
		return s
	}
	s.Ready = true
	s.Active = body.Active
	s.RSS = body.MaxRSS
	return s
}
func (m *Manager) monitor() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
		}
		for name, port := range map[string]int{"llm": LLMPort, "vision": VisionPort} {
			s := health(port)
			s.Name = name
			m.mu.Lock()
			p := m.processes[name]
			if p != nil {
				s.Managed = true
				s.PID = p.cmd.Process.Pid
			}
			m.services[name] = s
			phase := m.phase
			m.mu.Unlock()
			if p != nil && phase == "running" {
				select {
				case <-p.done:
					m.setError(fmt.Errorf("%s API가 종료됐습니다. 실행 기록을 확인하세요", name))
					_ = m.Stop()
				default:
				}
				if name == "vision" {
					rss := processRSS(p.cmd.Process.Pid)
					sys := systemInfo(m.root)
					limit, _ := m.visionRequirements()
					if rss > limit || (sys.MemoryAvailable > 0 && sys.MemoryAvailable < 3*1024*1024*1024) {
						m.logf("메모리 보호: 비전 RSS %s, 여유 %s", formatBytes(rss), formatBytes(sys.MemoryAvailable))
						m.setError(fmt.Errorf("메모리 보호를 위해 API를 중지했습니다"))
						_ = m.Stop()
					}
				}
			}
		}
	}
}
func (m *Manager) Snapshot() Snapshot {
	groups := map[string]*Component{}
	order := []string{"application", "runtime", "layout", "ocr", "translation"}
	names := map[string]string{"application": "이미지 API", "runtime": "실행 환경", "layout": "말풍선·글자 탐지", "ocr": "글자 인식", "translation": "대사 번역"}
	ready := supportedPlatform(m.platform) && m.hasSelection()
	for _, a := range m.selectedArtifacts() {
		g := groups[a.Group]
		if g == nil {
			g = &Component{ID: a.Group, Name: names[a.Group], Ready: true}
			groups[a.Group] = g
		}
		g.Size += a.Size
		g.Files += len(a.Files)
		if !m.artifactReady(a) {
			g.Ready = false
			ready = false
		}
	}
	components := []Component{}
	for _, id := range order {
		if g := groups[id]; g != nil {
			components = append(components, *g)
		}
	}
	models := m.modelStates()
	runtimes := m.runtimeStates()
	m.mu.Lock()
	defer m.mu.Unlock()
	services := []ServiceState{}
	for _, name := range []string{"llm", "vision"} {
		s, ok := m.services[name]
		if !ok {
			s = ServiceState{Name: name}
		}
		services = append(services, s)
	}
	return Snapshot{Profiles: m.executionProfiles(), Runtimes: runtimes, Models: models, Version: Version, Platform: m.platform, Supported: supportedPlatform(m.platform), Root: m.root, Ready: ready, Busy: m.busy, Phase: m.phase, Error: m.lastError, Progress: m.progress, Components: components, Services: services, Settings: m.settings, ExtensionID: m.extensionID, ExtensionPath: filepath.Join(m.root, "extension"), Licenses: m.catalog.Licenses, System: systemInfo(m.root), Hardware: hardwareSnapshot()}
}
func (m *Manager) ReadLog(name string) (string, error) {
	if name != "control" && name != "llm" && name != "vision" {
		return "", fmt.Errorf("unknown log")
	}
	f, e := os.Open(filepath.Join(m.root, "data", name+".log"))
	if os.IsNotExist(e) {
		return "아직 실행 기록이 없습니다.", nil
	}
	if e != nil {
		return "", e
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil {
		return "", e
	}
	start := max(0, st.Size()-96*1024)
	if _, e = f.Seek(start, io.SeekStart); e != nil {
		return "", e
	}
	data, e := io.ReadAll(io.LimitReader(f, 96*1024))
	if e != nil {
		return "", e
	}
	lines := strings.Split(string(data), "\n")
	if start > 0 && len(lines) > 1 {
		lines = lines[1:]
	}
	if len(lines) > 300 {
		lines = lines[len(lines)-300:]
	}
	return strings.Join(lines, "\n"), nil
}
func (m *Manager) PairCode() (string, error) {
	code, e := randomSecret()
	if e != nil {
		return "", e
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, t := range m.pairCodes {
		if time.Now().After(t) {
			delete(m.pairCodes, k)
		}
	}
	m.pairCodes[code] = time.Now().Add(2 * time.Minute)
	return code, nil
}
func (m *Manager) Pair(code string) (map[string]string, error) {
	m.mu.Lock()
	expiry, ok := m.pairCodes[code]
	delete(m.pairCodes, code)
	m.mu.Unlock()
	if !ok || time.Now().After(expiry) {
		return nil, fmt.Errorf("연결 코드가 만료됐습니다. 관리 화면에서 다시 연결하세요")
	}
	token, e := os.ReadFile(filepath.Join(m.root, "data", "native_api", "access-token"))
	if e != nil {
		return nil, e
	}
	m.logf("크롬 확장 연결 완료")
	return map[string]string{"server": fmt.Sprintf("http://127.0.0.1:%d", VisionPort), "token": strings.TrimSpace(string(token))}, nil
}
func (m *Manager) Close() {
	m.shutdown()
	m.mu.Lock()
	m.generation++
	m.mu.Unlock()
	m.mu.Lock()
	cancel := m.cancel
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	m.operation.Lock()
	m.stopProcesses()
	m.operation.Unlock()
}
func (m *Manager) InstalledPaths() []string {
	var paths []string
	for _, a := range m.catalog.Artifacts {
		for _, f := range a.Files {
			paths = append(paths, f.Path)
		}
	}
	sort.Strings(paths)
	return paths
}
