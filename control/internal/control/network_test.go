package control

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRemoteControlAccess(t *testing.T) {
	root := t.TempDir()
	m := &Manager{root: root, network: NetworkConfig{Listen: "0.0.0.0", PublicHost: "server.test"}}
	if e := m.ensureCredentials(); e != nil {
		t.Fatal(e)
	}
	admin, _ := os.ReadFile(filepath.Join(root, "data/control-access-token"))
	api, _ := os.ReadFile(filepath.Join(root, "data/native_api/access-token"))
	for _, test := range []struct {
		path, token, peer string
		allowed           bool
	}{
		{"/api/state", "", "192.168.1.8:1234", false},
		{"/api/state", strings.TrimSpace(string(api)), "192.168.1.8:1234", false},
		{"/api/library", strings.TrimSpace(string(api)), "192.168.1.8:1234", true},
		{"/api/state", strings.TrimSpace(string(admin)), "192.168.1.8:1234", true},
		{"/api/state", "", "127.0.0.1:1234", false},
	} {
		r := httptest.NewRequest("GET", "http://server.test:8794"+test.path, nil)
		r.RemoteAddr = test.peer
		if test.token != "" {
			r.Header.Set("Authorization", "Bearer "+test.token)
		}
		w := httptest.NewRecorder()
		if got := m.controlAccess(w, r); got != test.allowed {
			t.Fatal(test, got, w.Code)
		}
	}
	// A remote caller forging the loopback Host is still unauthenticated.
	r := httptest.NewRequest("GET", "http://127.0.0.1:8794/api/state", nil)
	r.RemoteAddr = "192.168.1.8:1234"
	r.Header.Set("X-Forwarded-For", "127.0.0.1")
	if m.controlAccess(httptest.NewRecorder(), r) {
		t.Fatal("forged loopback bypass")
	}
	code, e := m.NewConnectionCode()
	if e != nil {
		t.Fatal(e)
	}
	r = httptest.NewRequest("POST", "http://server.test:8794/login", strings.NewReader(url.Values{"code": {code}}.Encode()))
	r.RemoteAddr = "192.168.1.8:1234"
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.Header.Set("Origin", "http://server.test:8794")
	w := httptest.NewRecorder()
	if m.controlAccess(w, r) || w.Code != 303 {
		t.Fatal(w.Code)
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatal(cookies)
	}
	r = httptest.NewRequest("GET", "http://server.test:8794/api/state", nil)
	r.RemoteAddr = "192.168.1.8:1234"
	r.AddCookie(cookies[0])
	if !m.controlAccess(httptest.NewRecorder(), r) {
		t.Fatal("login failed")
	}
	if !m.allowedControlHost("server.test") || m.allowedControlHost("attacker.test") {
		t.Fatal("host check")
	}
}
func TestNetworkConfiguration(t *testing.T) {
	root := t.TempDir()
	c, e := readNetworkConfig(root)
	if e != nil || c.Listen != "127.0.0.1" {
		t.Fatal(c, e)
	}
	if e := ConfigureListen(root, "0.0.0.0"); e != nil {
		t.Fatal(e)
	}
	c, e = readNetworkConfig(root)
	if e != nil || c.Listen != "0.0.0.0" {
		t.Fatal(c, e)
	}
	if ConfigureListen(root, "attacker.test") == nil {
		t.Fatal("invalid binding")
	}
}

func TestRemoteCredentialsMigration(t *testing.T) {
	source := importFixture(t)
	dest := t.TempDir()
	if e := os.WriteFile(filepath.Join(source, "data/control-access-token"), []byte(strings.Repeat("b", 64)), 0600); e != nil {
		t.Fatal(e)
	}
	if e := ConfigureListen(source, "0.0.0.0"); e != nil {
		t.Fatal(e)
	}
	if _, e := importDataOptions(context.Background(), dest, source, ImportOptions{Jobs: "none"}, nil); e != nil {
		t.Fatal(e)
	}
	if readImport(t, dest, "data/control-access-token") != strings.Repeat("b", 64) {
		t.Fatal("management token lost")
	}
	c, e := readNetworkConfig(dest)
	if e != nil || c.Listen != "0.0.0.0" {
		t.Fatal("server mode lost", c, e)
	}
}
