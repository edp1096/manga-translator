package main

import (
	"bytes"
	"debug/pe"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsGUIOutput(t *testing.T) {
	for _, subsystem := range []uint16{pe.IMAGE_SUBSYSTEM_WINDOWS_GUI, pe.IMAGE_SUBSYSTEM_WINDOWS_CUI, pe.IMAGE_SUBSYSTEM_NATIVE} {
		t.Run(string(rune('0'+subsystem)), func(t *testing.T) {
			var data bytes.Buffer
			dos := make([]byte, 128)
			copy(dos, "MZ")
			binary.LittleEndian.PutUint32(dos[0x3c:], 128)
			data.Write(dos)
			data.WriteString("PE\x00\x00")
			header := pe.OptionalHeader64{Magic: 0x20b, Subsystem: subsystem, NumberOfRvaAndSizes: 16}
			if err := binary.Write(&data, binary.LittleEndian, pe.FileHeader{Machine: pe.IMAGE_FILE_MACHINE_AMD64, SizeOfOptionalHeader: uint16(binary.Size(header))}); err != nil {
				t.Fatal(err)
			}
			if err := binary.Write(&data, binary.LittleEndian, header); err != nil {
				t.Fatal(err)
			}
			file := filepath.Join(t.TempDir(), "MangaTranslator.exe")
			if err := os.WriteFile(file, data.Bytes(), 0600); err != nil {
				t.Fatal(err)
			}
			err := verifyWindowsGUI(file)
			if (err == nil) != (subsystem == pe.IMAGE_SUBSYSTEM_WINDOWS_GUI) {
				t.Fatalf("subsystem %d: %v", subsystem, err)
			}
		})
	}
	bad := filepath.Join(t.TempDir(), "broken.exe")
	if err := os.WriteFile(bad, []byte("not an executable"), 0600); err != nil {
		t.Fatal(err)
	}
	if verifyWindowsGUI(bad) == nil {
		t.Fatal("invalid executable accepted")
	}
}
