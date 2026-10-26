package control

import (
	"fmt"
	"os"
	"path/filepath"
)

// The portable application root is the main executable's own directory.
// Never search the working directory, parent folders, or per-user data locations.
func ResolveRoot(explicit string) (string, error) {
	if explicit != "" {
		if !filepath.IsAbs(explicit) {
			return "", fmt.Errorf("--root에는 절대 경로를 지정하세요")
		}
		return filepath.Clean(explicit), nil
	}
	executable, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("실행 파일 경로를 확인하지 못했습니다: %w", err)
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return "", fmt.Errorf("실행 파일의 실제 경로를 확인하지 못했습니다: %w", err)
	}
	if !filepath.IsAbs(executable) {
		return "", fmt.Errorf("실행 파일 경로는 절대 경로여야 합니다")
	}
	return filepath.Dir(executable), nil
}
