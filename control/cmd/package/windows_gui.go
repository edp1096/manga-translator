package main

import (
	"debug/pe"
	"fmt"
)

// Inspect the actual output, not just the build arguments: a console executable
// must never replace the portable Windows GUI application.
func verifyWindowsGUI(path string) error {
	f, err := pe.Open(path)
	if err != nil {
		return fmt.Errorf("read Windows executable: %w", err)
	}
	defer f.Close()
	var subsystem uint16
	switch h := f.OptionalHeader.(type) {
	case *pe.OptionalHeader64:
		subsystem = h.Subsystem
	case *pe.OptionalHeader32:
		subsystem = h.Subsystem
	default:
		return fmt.Errorf("Windows executable has no PE optional header")
	}
	if subsystem != pe.IMAGE_SUBSYSTEM_WINDOWS_GUI {
		return fmt.Errorf("Windows application subsystem is %d; rebuild with -ldflags='-H windowsgui'", subsystem)
	}
	return nil
}
