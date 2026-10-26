package control

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestPortableRootIgnoresCWDAndUserDataLocations(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		t.Fatal(err)
	}
	expected := filepath.Dir(executable)
	t.Setenv("XDG_DATA_HOME", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	for _, cwd := range []string{t.TempDir(), filepath.Join(t.TempDir(), "unrelated folder")} {
		if err = os.MkdirAll(cwd, 0700); err != nil {
			t.Fatal(err)
		}
		t.Chdir(cwd)
		got, e := ResolveRoot("")
		if e != nil || got != expected {
			t.Fatal(got, e)
		}
		files, e := os.ReadDir(cwd)
		if e != nil || len(files) != 0 {
			t.Fatal("working directory modified")
		}
	}
}
func TestExplicitRootRequiresAbsolutePath(t *testing.T) {
	expected := filepath.Join(t.TempDir(), "custom portable root")
	if got, err := ResolveRoot(expected); err != nil || got != expected {
		t.Fatal(got, err)
	}
	for _, p := range []string{".", "../config", "data"} {
		if _, err := ResolveRoot(p); err == nil {
			t.Fatalf("accepted relative root: %s", p)
		}
	}
}

func TestWorkerCachesAreConfinedToPortableRoot(t *testing.T) {
	root := t.TempDir()
	env := map[string]string{}
	for _, entry := range processEnvironment(root, nil) {
		key, value, ok := strings.Cut(entry, "=")
		if ok {
			env[strings.ToUpper(key)] = value
		}
	}
	if env["ORT_DISABLE_TELEMETRY"] != "1" {
		t.Fatal("ORT may create a user-profile cache before session setup")
	}
	if env["LLAMA_CACHE"] != filepath.Join(root, "data", "cache", "llama") {
		t.Fatal("LLM cache escapes app folder")
	}
	if runtime.GOOS == "linux" && env["XDG_CACHE_HOME"] != filepath.Join(root, "data", "cache") {
		t.Fatal("native cache escapes app folder")
	}
	if runtime.GOOS == "windows" && (env["TEMP"] != filepath.Join(root, "data", "tmp") || env["TMP"] != filepath.Join(root, "data", "tmp")) {
		t.Fatal("native temporary files escape app folder")
	}
}
