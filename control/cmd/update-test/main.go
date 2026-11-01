// Local release fixture for the separately packaged update test kit.
// This executable never changes a real installation or publishes a release.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

func run() error {
	executable, e := os.Executable()
	if e != nil {
		return e
	}
	root := filepath.Dir(executable)
	if _, e = os.Stat(filepath.Join(root, "UPDATE-TEST-KIT.txt")); e != nil {
		return fmt.Errorf("테스트 키트 폴더에서 실행하세요")
	}
	for _, port := range []int{8794, 8793, 8792} {
		c, e := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 300*time.Millisecond)
		if e == nil {
			c.Close()
			return fmt.Errorf("현재 관리 앱과 API를 종료한 뒤 다시 실행하세요 (포트 %d)", port)
		}
	}
	listener, e := net.Listen("tcp", "127.0.0.1:19842")
	if e != nil {
		return fmt.Errorf("기존 테스트 창을 닫은 뒤 다시 실행하세요: %w", e)
	}
	defer listener.Close()
	const version = "0.4.2"
	const archive = "manga-translator-windows-x64-0.4.2.zip"
	const sums = "manga-translator-0.4.2-SHA256SUMS.txt"
	file := filepath.Join(root, archive)
	raw, e := os.ReadFile(file)
	if e != nil {
		return e
	}
	digest := sha256.Sum256(raw)
	sum := hex.EncodeToString(digest[:]) + "  " + archive + "\n"
	app := filepath.Join(root, "test-app")
	if st, err := os.Lstat(app); err == nil {
		if !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("테스트 앱 폴더는 링크일 수 없습니다")
		}
		if b, err := os.ReadFile(filepath.Join(app, ".update-test-app")); err != nil || string(b) != "isolated-update-test" {
			return fmt.Errorf("기존 폴더를 테스트 앱으로 덮어쓰지 않습니다")
		}
	}
	if e = os.MkdirAll(app, 0700); e != nil {
		return e
	}
	if e = os.WriteFile(filepath.Join(app, ".update-test-app"), []byte("isolated-update-test"), 0600); e != nil {
		return e
	}
	for _, name := range []string{"MangaTranslator.exe", "data", ".app-update"} {
		if st, err := os.Lstat(filepath.Join(app, name)); err == nil && st.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("링크된 테스트 경로는 사용하지 않습니다")
		}
	}
	if b, err := os.ReadFile(filepath.Join(app, ".app-update", "journal.json")); err == nil {
		var j struct{ Phase string }
		if json.Unmarshal(b, &j) != nil || (j.Phase != "complete" && j.Phase != "rolled-back") {
			return fmt.Errorf("중단된 테스트 업데이트가 있습니다. test-app의 앱을 직접 실행하여 복구한 뒤 종료하세요")
		}
	}
	// Re-running resets only the test executable/update bookkeeping. Data created
	// by the user inside the test app is preserved, including archived backups.
	baseline, e := os.ReadFile(filepath.Join(root, "baseline.exe"))
	if e != nil {
		return e
	}
	if e = os.RemoveAll(filepath.Join(app, ".app-update")); e != nil {
		return e
	}
	_ = os.Remove(filepath.Join(app, "data", "update-result.json"))
	if e = os.WriteFile(filepath.Join(app, "MangaTranslator.exe"), baseline, 0700); e != nil {
		return e
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/latest", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"tag_name": "v" + version, "draft": false, "prerelease": false, "html_url": "https://github.com/edp1096/manga-translator", "body": "로컬 업데이트 동작 테스트입니다. 0.4.1 표시의 테스트 실행본에서 실제 0.4.2 빌드로 교체합니다. 실제 설치 폴더는 변경하지 않습니다.", "assets": []map[string]any{{"name": archive, "size": len(raw), "browser_download_url": "http://127.0.0.1:19842/download/v" + version + "/" + archive}, {"name": sums, "size": len(sum), "browser_download_url": "http://127.0.0.1:19842/download/v" + version + "/" + sums}}})
	})
	mux.HandleFunc("/download/v"+version+"/"+archive, func(w http.ResponseWriter, r *http.Request) { http.ServeFile(w, r, file) })
	mux.HandleFunc("/download/v"+version+"/"+sums, func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, sum) })
	cmd := exec.Command(filepath.Join(app, "MangaTranslator.exe"), "--no-auto-setup")
	cmd.Dir = app
	if e = cmd.Start(); e != nil {
		return e
	}
	go cmd.Wait()
	fmt.Println("업데이트 테스트 서버 실행 중 · 이 창은 업데이트가 끝날 때까지 열어 두세요.")
	fmt.Println("관리 화면에서 '업데이트 설치·재시작'을 누르면 0.4.2로 바뀝니다.")
	fmt.Println("관리 화면: http://127.0.0.1:8794 · 테스트 데이터:", app)
	fmt.Println("다시 테스트하려면 관리 앱을 종료하고 이 창을 닫은 뒤 다시 실행하세요.")
	return (&http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}).Serve(listener)
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
