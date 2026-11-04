package control

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// Persisted separately so updates and normal model settings preserve server mode.
type NetworkConfig struct {
	Listen     string `json:"listen"`
	PublicHost string `json:"publicHost,omitempty"`
}

func readNetworkConfig(root string) (NetworkConfig, error) {
	c := NetworkConfig{Listen: "127.0.0.1"}
	raw, e := os.ReadFile(filepath.Join(root, "config/network.json"))
	if e != nil && !os.IsNotExist(e) {
		return c, e
	}
	if e == nil {
		if e = json.Unmarshal(raw, &c); e != nil {
			return c, e
		}
	}
	if c.Listen != "127.0.0.1" && c.Listen != "0.0.0.0" {
		return c, fmt.Errorf("network.listen must be 127.0.0.1 or 0.0.0.0")
	}
	if strings.ContainsAny(c.PublicHost, "/:\\?#@ \t\r\n") {
		return c, fmt.Errorf("network.publicHost must be a hostname or IPv4 address")
	}
	return c, nil
}
func ConfigureListen(root, host string) error {
	c, e := readNetworkConfig(root)
	if e != nil {
		return e
	}
	if host != "127.0.0.1" && host != "0.0.0.0" {
		return fmt.Errorf("--listen: use 127.0.0.1 or 0.0.0.0")
	}
	c.Listen = host
	return writeJSON(filepath.Join(root, "config/network.json"), c)
}
func (m *Manager) listenHost() string {
	if m.network.Listen == "" {
		return "127.0.0.1"
	}
	return m.network.Listen
}
func (m *Manager) allowedControlHost(host string) bool {
	if host == "127.0.0.1" || host == "localhost" {
		return true
	}
	if m.listenHost() != "0.0.0.0" {
		return false
	}
	if m.network.PublicHost != "" && strings.EqualFold(host, m.network.PublicHost) {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil || ip.IsUnspecified() {
		return false
	}
	addresses, e := net.InterfaceAddrs()
	if e != nil {
		return false
	}
	for _, a := range addresses {
		local, _, e := net.ParseCIDR(a.String())
		if e == nil && local.Equal(ip) {
			return true
		}
	}
	return false
}
func (m *Manager) matchesCredential(relative, value string) bool {
	b, e := os.ReadFile(filepath.Join(m.root, relative))
	if e != nil {
		return false
	}
	secret := strings.TrimSpace(string(b))
	return len(secret) >= 32 && subtle.ConstantTimeCompare([]byte(secret), []byte(value)) == 1
}
func (m *Manager) controlAccess(w http.ResponseWriter, r *http.Request) bool {
	// Local controller/update helpers remain compatible; a remote client cannot
	// bypass login by forging Host, Origin or X-Forwarded-For.
	peer, _, _ := net.SplitHostPort(r.RemoteAddr)
	host, _, _ := net.SplitHostPort(r.Host)
	if m.listenHost() != "0.0.0.0" {
		return true
	}
	if ip := net.ParseIP(peer); ip != nil && ip.IsLoopback() && (host == "127.0.0.1" || host == "localhost") {
		return true
	}
	if r.URL.Path == "/api/extension/pair" {
		return true
	} // one-use code + extension check in handler
	bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		if m.matchesCredential("data/control-access-token", bearer) {
			return true
		}
		// Inference tokens may read saved work and persist presentation, never manage models or delete jobs.
		libraryRead := (r.Method == "GET" || r.Method == "HEAD") && (r.URL.Path == "/api/library" || strings.HasPrefix(r.URL.Path, "/api/library/"))
		presentation := r.Method == "POST" && strings.HasPrefix(r.URL.Path, "/api/library/presentation/")
		if (libraryRead || presentation) && (m.matchesCredential("data/native_api/access-token", bearer) || m.deviceAPIAccess(bearer)) {
			return true
		}
	}
	if _, ok := m.deviceForCookie(r); ok {
		return true
	}
	if c, e := r.Cookie("manga_control"); e == nil && m.matchesCredential("data/control-access-token", c.Value) {
		return true
	}
	if r.URL.Path == "/login" && r.Method == "POST" {
		if r.Header.Get("Origin") != "http://"+r.Host {
			respond(w, map[string]string{"error": "관리 화면에서 로그인하세요"}, 403)
			return false
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		if r.ParseForm() == nil {
			value, e := m.registerDevice(r.Form.Get("code"), r.Form.Get("name"), r.Form.Get("remember") == "on")
			if e == nil {
				age := 0
				if r.Form.Get("remember") == "on" {
					age = 90 * 24 * 3600
				}
				http.SetCookie(w, &http.Cookie{Name: "manga_device", Value: value, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: r.TLS != nil, MaxAge: age})
				http.Redirect(w, r, "/", http.StatusSeeOther)
				return false
			}
		}
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(401)
		fmt.Fprint(w, strings.Replace(controlLogin, "<form method=", `<p role="alert">코드가 틀렸거나 만료됐습니다. 서버에서 새 코드를 발급할 수 있습니다.</p><form method=`, 1))
		return false
	}
	if (r.URL.Path == "/" || r.URL.Path == "/login") && r.Method == "GET" {
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, controlLogin)
		return false
	}
	respond(w, map[string]string{"error": "관리 서버 로그인이 필요합니다"}, 401)
	return false
}

const controlLogin = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Manga Translator · 서버 로그인</title><style>body{font:16px system-ui;background:#f3f5f7;color:#172b35;max-width:440px;margin:12vh auto;padding:24px}form{background:white;padding:24px;border-radius:12px}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px}button{background:#176d76;color:white;border:0;border-radius:6px}small{display:block;line-height:1.6;margin-top:16px;overflow-wrap:anywhere}</style><form method="post" action="/login"><h1>서버 관리 로그인</h1><label>연결 코드<input name="code" placeholder="1234-5678" inputmode="numeric" maxlength="9" required autocomplete="one-time-code" autofocus></label><label>이 기기 이름<input name="name" placeholder="내 Windows PC" maxlength="60"></label><label><input name="remember" type="checkbox" checked style="width:auto"> 이 브라우저 기억하기 · 90일</label><button>연결</button><small>서버 시작 화면이나 관리 페이지에서 발급한 일회용 코드를 입력하세요. 코드는 10분 동안 유효합니다.<br>서버에서 새 코드 받기: MangaTranslator --connection-code</small></form></html>`
