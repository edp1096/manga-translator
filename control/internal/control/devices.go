package control

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type RegisteredDevice struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Created     int64  `json:"created"`
	Expires     int64  `json:"expires"`
	SessionHash string `json:"sessionHash,omitempty"`
	APIToken    string `json:"apiToken,omitempty"`
}
type deviceStore struct {
	CodeHash    string             `json:"codeHash,omitempty"`
	CodeExpires int64              `json:"codeExpires,omitempty"`
	Attempts    int                `json:"attempts,omitempty"`
	Devices     []RegisteredDevice `json:"devices"`
}

func hashDeviceSecret(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
func (m *Manager) readDevices() (deviceStore, error) {
	var s deviceStore
	b, e := os.ReadFile(filepath.Join(m.root, "data/native_api/devices.json"))
	if os.IsNotExist(e) {
		return s, nil
	}
	if e != nil {
		return s, e
	}
	e = json.Unmarshal(b, &s)
	return s, e
}
func (m *Manager) saveDevices(s deviceStore) error {
	return writeJSON(filepath.Join(m.root, "data/native_api/devices.json"), s)
}
func (m *Manager) NewConnectionCode() (string, error) {
	m.devicesMu.Lock()
	defer m.devicesMu.Unlock()
	s, e := m.readDevices()
	if e != nil {
		return "", e
	}
	n, e := rand.Int(rand.Reader, big.NewInt(100000000))
	if e != nil {
		return "", e
	}
	code := fmt.Sprintf("%08d", n.Int64())
	s.CodeHash = hashDeviceSecret(code)
	s.CodeExpires = time.Now().Add(10 * time.Minute).Unix()
	s.Attempts = 0
	if e = m.saveDevices(s); e != nil {
		return "", e
	}
	return code[:4] + "-" + code[4:], nil
}
func (m *Manager) registerDevice(code, name string, remember bool) (string, error) {
	m.devicesMu.Lock()
	defer m.devicesMu.Unlock()
	s, e := m.readDevices()
	if e != nil {
		return "", e
	}
	now := time.Now().Unix()
	code = strings.ReplaceAll(strings.TrimSpace(code), "-", "")
	if s.CodeHash == "" || s.CodeExpires <= now || s.Attempts >= 5 {
		return "", fmt.Errorf("연결 코드가 만료됐습니다. 서버에서 새 코드를 발급하세요")
	}
	if hashDeviceSecret(code) != s.CodeHash {
		s.Attempts++
		if e = m.saveDevices(s); e != nil {
			return "", e
		}
		return "", fmt.Errorf("연결 코드가 맞지 않습니다 (%d/5)", s.Attempts)
	}
	// A successful registration consumes the code and writes the session together.
	token, e := randomSecret()
	if e != nil {
		return "", e
	}
	id, e := randomSecret()
	if e != nil {
		return "", e
	}
	api, e := randomSecret()
	if e != nil {
		return "", e
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "등록한 브라우저"
	}
	if len([]rune(name)) > 60 {
		name = string([]rune(name)[:60])
	}
	duration := 12 * time.Hour
	if remember {
		duration = 90 * 24 * time.Hour
	}
	active := []RegisteredDevice{}
	for _, d := range s.Devices {
		if d.Expires > now {
			active = append(active, d)
		}
	}
	if len(active) >= 50 {
		return "", fmt.Errorf("등록 기기가 50개입니다. 사용하지 않는 기기를 먼저 해제하세요")
	}
	s.Devices = append(active, RegisteredDevice{ID: id[:16], Name: name, Created: now, Expires: time.Now().Add(duration).Unix(), SessionHash: hashDeviceSecret(token), APIToken: api})
	s.CodeHash = ""
	s.CodeExpires = 0
	s.Attempts = 0
	if e = m.saveDevices(s); e != nil {
		return "", e
	}
	return token, nil
}
func (m *Manager) deviceForCookie(r *http.Request) (RegisteredDevice, bool) {
	c, e := r.Cookie("manga_device")
	if e != nil || len(c.Value) != 64 {
		return RegisteredDevice{}, false
	}
	hash := hashDeviceSecret(c.Value)
	m.devicesMu.Lock()
	defer m.devicesMu.Unlock()
	s, e := m.readDevices()
	if e != nil {
		return RegisteredDevice{}, false
	}
	for _, d := range s.Devices {
		if d.Expires > time.Now().Unix() && d.SessionHash == hash {
			return d, true
		}
	}
	return RegisteredDevice{}, false
}
func (m *Manager) deviceAPIAccess(token string) bool {
	if len(token) != 64 {
		return false
	}
	m.devicesMu.Lock()
	defer m.devicesMu.Unlock()
	s, e := m.readDevices()
	if e != nil {
		return false
	}
	for _, d := range s.Devices {
		if d.Expires > time.Now().Unix() && d.APIToken == token {
			return true
		}
	}
	return false
}
func (m *Manager) deviceToken(id string) (string, error) {
	m.devicesMu.Lock()
	defer m.devicesMu.Unlock()
	s, e := m.readDevices()
	if e != nil {
		return "", e
	}
	for _, d := range s.Devices {
		if d.ID == id && d.Expires > time.Now().Unix() {
			return d.APIToken, nil
		}
	}
	return "", fmt.Errorf("기기 등록이 해제되었거나 만료됐습니다")
}
func (m *Manager) deviceRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/devices/code", func(w http.ResponseWriter, r *http.Request) {
		code, e := m.NewConnectionCode()
		if e != nil {
			action(w, e)
			return
		}
		respond(w, map[string]any{"code": code, "expiresIn": 600, "address": m.connectionAddress()}, 200)
	})
	mux.HandleFunc("GET /api/devices", func(w http.ResponseWriter, r *http.Request) {
		current, _ := m.deviceForCookie(r)
		m.devicesMu.Lock()
		s, e := m.readDevices()
		m.devicesMu.Unlock()
		if e != nil {
			action(w, e)
			return
		}
		rows := []map[string]any{}
		for _, d := range s.Devices {
			if d.Expires > time.Now().Unix() {
				rows = append(rows, map[string]any{"id": d.ID, "name": d.Name, "created": d.Created, "expires": d.Expires, "current": d.ID == current.ID})
			}
		}
		respond(w, map[string]any{"devices": rows}, 200)
	})
	mux.HandleFunc("POST /api/devices/revoke", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID string `json:"id"`
		}
		if !decode(w, r, &body) {
			return
		}
		m.devicesMu.Lock()
		defer m.devicesMu.Unlock()
		s, e := m.readDevices()
		if e != nil {
			action(w, e)
			return
		}
		kept := []RegisteredDevice{}
		found := false
		for _, d := range s.Devices {
			if d.ID == body.ID {
				found = true
			} else {
				kept = append(kept, d)
			}
		}
		if !found {
			respond(w, map[string]string{"error": "등록 기기를 찾지 못했습니다"}, 404)
			return
		}
		s.Devices = kept
		action(w, m.saveDevices(s))
	})
	mux.HandleFunc("POST /api/logout", func(w http.ResponseWriter, r *http.Request) {
		http.SetCookie(w, &http.Cookie{Name: "manga_device", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
		http.SetCookie(w, &http.Cookie{Name: "manga_control", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
		action(w, nil)
	})
}

func PrintConnectionCode(root string) error {
	client := &http.Client{Timeout: 5 * time.Second}
	base := fmt.Sprintf("http://127.0.0.1:%d", ControlPort)
	response, e := client.Get(base + "/api/state")
	if e != nil {
		return fmt.Errorf("먼저 이 폴더의 관리 서버를 실행하세요: %w", e)
	}
	var state struct {
		Root string `json:"root"`
	}
	e = json.NewDecoder(response.Body).Decode(&state)
	response.Body.Close()
	expected, e2 := filepath.Abs(root)
	if e != nil || e2 != nil || !strings.EqualFold(filepath.Clean(state.Root), filepath.Clean(expected)) {
		return fmt.Errorf("다른 폴더의 관리 서버가 실행 중입니다")
	}
	req, _ := http.NewRequest("POST", base+"/api/devices/code", strings.NewReader("{}"))
	req.Header.Set("Origin", base)
	req.Header.Set("X-Manga-Control", "1")
	req.Header.Set("Content-Type", "application/json")
	response, e = client.Do(req)
	if e != nil {
		return e
	}
	defer response.Body.Close()
	var result struct {
		Code    string `json:"code"`
		Address string `json:"address"`
	}
	if response.StatusCode != 200 {
		return fmt.Errorf("연결 코드를 발급하지 못했습니다")
	}
	if e = json.NewDecoder(response.Body).Decode(&result); e != nil {
		return e
	}
	fmt.Printf("관리 주소: %s\n연결 코드: %s (10분 유효 · 한 번만 사용)\n", result.Address, result.Code)
	return nil
}
func (m *Manager) announceConnection() {
	if m.listenHost() != "0.0.0.0" {
		return
	}
	fmt.Printf("원격 관리: %s\n추가 기기 연결: MangaTranslator --connection-code\n", m.connectionAddress())
	m.devicesMu.Lock()
	s, e := m.readDevices()
	m.devicesMu.Unlock()
	if e != nil {
		return
	}
	for _, d := range s.Devices {
		if d.Expires > time.Now().Unix() {
			return
		}
	}
	if code, e := m.NewConnectionCode(); e == nil {
		fmt.Printf("최초 연결 코드: %s (10분 유효 · 한 번만 사용)\n", code)
	}
}

func (m *Manager) connectionAddress() string {
	host := m.network.PublicHost
	if host == "" {
		addresses, _ := net.InterfaceAddrs()
		best := -1
		for _, a := range addresses {
			ip, _, e := net.ParseCIDR(a.String())
			if e != nil || ip.To4() == nil || ip.IsLoopback() || !ip.IsGlobalUnicast() {
				continue
			}
			score := 0
			s := ip.String()
			if strings.HasPrefix(s, "192.168.") {
				score = 3
			} else if strings.HasPrefix(s, "10.") {
				score = 2
			} else if ip.IsPrivate() {
				score = 1
			}
			if score > best {
				host = s
				best = score
			}
		}
	}
	if host == "" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, fmt.Sprint(ControlPort))
}
