package control

import (
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func deviceManager(t *testing.T) *Manager {
	t.Helper()
	m := &Manager{root: t.TempDir(), network: NetworkConfig{Listen: "0.0.0.0"}, pairCodes: map[string]time.Time{}, pairDevices: map[string]string{}, logger: log.New(io.Discard, "", 0)}
	if e := m.ensureCredentials(); e != nil {
		t.Fatal(e)
	}
	return m
}
func TestDeviceCodeSingleUseAndRestart(t *testing.T) {
	m := deviceManager(t)
	code, e := m.NewConnectionCode()
	if e != nil {
		t.Fatal(e)
	}
	var count atomic.Int32
	var wg sync.WaitGroup
	var token string
	var tokenMu sync.Mutex
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if v, e := m.registerDevice(code, "Windows Edge", true); e == nil {
				count.Add(1)
				tokenMu.Lock()
				token = v
				tokenMu.Unlock()
			}
		}()
	}
	wg.Wait()
	if count.Load() != 1 {
		t.Fatal("code reused", count.Load())
	}
	fresh := &Manager{root: m.root, network: m.network}
	r := httptest.NewRequest("GET", "http://server:8794/api/state", nil)
	r.RemoteAddr = "192.168.1.2:1000"
	r.AddCookie(&http.Cookie{Name: "manga_device", Value: token})
	device, ok := fresh.deviceForCookie(r)
	if !ok || device.Name != "Windows Edge" || device.Expires < time.Now().Add(89*24*time.Hour).Unix() {
		t.Fatal("remembered registration lost")
	}
	if !fresh.controlAccess(httptest.NewRecorder(), r) {
		t.Fatal("session not accepted")
	}
	if !fresh.deviceAPIAccess(device.APIToken) {
		t.Fatal("API credential missing")
	}
	if fresh.deviceAPIAccess(token) {
		t.Fatal("browser session used as API key")
	}
	apiRequest := httptest.NewRequest("GET", "http://server:8794/api/state", nil)
	apiRequest.RemoteAddr = r.RemoteAddr
	apiRequest.Header.Set("Authorization", "Bearer "+device.APIToken)
	if fresh.controlAccess(httptest.NewRecorder(), apiRequest) {
		t.Fatal("API token elevated to admin")
	}
	apiRequest.URL.Path = "/api/library"
	if !fresh.controlAccess(httptest.NewRecorder(), apiRequest) {
		t.Fatal("library rejected device")
	}
}
func TestDeviceCodeLimitsAndExpiry(t *testing.T) {
	m := deviceManager(t)
	code, _ := m.NewConnectionCode()
	for i := 0; i < 5; i++ {
		if _, e := m.registerDevice("not-a-code", "", true); e == nil {
			t.Fatal("invalid accepted")
		}
	}
	if _, e := m.registerDevice(code, "", true); e == nil {
		t.Fatal("attempt limit ignored")
	}
	code, _ = m.NewConnectionCode()
	s, _ := m.readDevices()
	s.CodeExpires = time.Now().Add(-time.Second).Unix()
	m.saveDevices(s)
	if _, e := m.registerDevice(code, "", true); e == nil {
		t.Fatal("expired accepted")
	}
	code, _ = m.NewConnectionCode()
	token, e := m.registerDevice(code, "", false)
	if e != nil {
		t.Fatal(e)
	}
	s, _ = m.readDevices()
	if s.Devices[0].Expires > time.Now().Add(13*time.Hour).Unix() {
		t.Fatal("session-only duration")
	}
	s.Devices[0].Expires = time.Now().Add(-time.Second).Unix()
	m.saveDevices(s)
	r := httptest.NewRequest("GET", "http://server/", nil)
	r.AddCookie(&http.Cookie{Name: "manga_device", Value: token})
	if _, ok := m.deviceForCookie(r); ok {
		t.Fatal("expired session accepted")
	}
	if m.deviceAPIAccess(s.Devices[0].APIToken) {
		t.Fatal("expired API token accepted")
	}
}
func TestDevicePairAndRevocation(t *testing.T) {
	m := deviceManager(t)
	code, _ := m.NewConnectionCode()
	cookie, _ := m.registerDevice(code, "Edge", true)
	r := httptest.NewRequest("GET", "http://server/", nil)
	r.AddCookie(&http.Cookie{Name: "manga_device", Value: cookie})
	d, _ := m.deviceForCookie(r)
	pairCode, _ := m.PairCode()
	m.pairDevices[pairCode] = d.ID
	pair, e := m.Pair(pairCode)
	if e != nil || pair["token"] != d.APIToken {
		t.Fatal("not scoped to device", e)
	}
	late, _ := m.PairCode()
	m.pairDevices[late] = d.ID
	mux := http.NewServeMux()
	m.deviceRoutes(mux)
	request := httptest.NewRequest("POST", "/api/devices/revoke", strings.NewReader(`{"id":"`+d.ID+`"}`))
	request.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, request)
	if w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	if m.deviceAPIAccess(d.APIToken) {
		t.Fatal("API access survived revoke")
	}
	if _, ok := m.deviceForCookie(r); ok {
		t.Fatal("browser survived revoke")
	}
	if _, e := m.Pair(late); e == nil {
		t.Fatal("pending pair survived revoke")
	}
}

func TestLocalControlBypassesRegistration(t *testing.T) {
	m := deviceManager(t)
	for _, host := range []string{"127.0.0.1", "localhost"} {
		r := httptest.NewRequest("GET", "http://"+host+":8794/api/state", nil)
		r.RemoteAddr = "127.0.0.1:12345"
		if !m.controlAccess(httptest.NewRecorder(), r) {
			t.Fatal("local connection requires registration", host)
		}
		r.RemoteAddr = "192.168.100.50:12345"
		if m.controlAccess(httptest.NewRecorder(), r) {
			t.Fatal("remote peer forged loopback Host", host)
		}
	}
}
