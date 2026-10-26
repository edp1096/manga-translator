package control

import (
	"bytes"
	"compress/flate"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"os"
)

// Only the pinned MSZIP cabinets used by the official VC package are supported.
// Extraction stays in memory and installs allowlisted, hashed DLLs inside root;
// no installer, MSI, system-directory writes or elevation is involved.
func cabinetFiles(ctx context.Context, data []byte, wanted map[string]bool) (map[string][]byte, error) {
	bad := func() (map[string][]byte, error) { return nil, fmt.Errorf("unsupported or invalid runtime cabinet") }
	if len(data) < 36 || string(data[:4]) != "MSCF" {
		return bad()
	}
	u16 := func(p int) int { return int(binary.LittleEndian.Uint16(data[p : p+2])) }
	u32 := func(p int) int { return int(binary.LittleEndian.Uint32(data[p : p+4])) }
	size := u32(8)
	fileAt := u32(16)
	folders := u16(26)
	files := u16(28)
	flags := u16(30)
	if size > len(data) || size < 36 || folders != 1 || files > 256 || flags&^4 != 0 || fileAt < 36 || fileAt >= size {
		return bad()
	}
	at, reserveFolder, reserveData := 36, 0, 0
	if flags&4 != 0 {
		if at+4 > size {
			return bad()
		}
		n := u16(at)
		reserveFolder = int(data[at+2])
		reserveData = int(data[at+3])
		at += 4 + n
	}
	if at+8+reserveFolder > size {
		return bad()
	}
	blockAt, blocks, compression := u32(at), u16(at+4), u16(at+6)
	if compression != 1 || blocks > 2048 || blockAt >= size {
		return bad()
	}
	type entry struct {
		name          string
		start, length int
	}
	entries := []entry{}
	at = fileAt
	for i := 0; i < files; i++ {
		if at+16 > size {
			return bad()
		}
		length, start, folder := u32(at), u32(at+4), u16(at+8)
		at += 16
		if folder != 0 || length > 64*1024*1024 {
			return bad()
		}
		end := bytes.IndexByte(data[at:size], 0)
		if end < 0 || end > 256 {
			return bad()
		}
		name := string(data[at : at+end])
		at += end + 1
		if wanted[name] {
			entries = append(entries, entry{name, start, length})
		}
	}
	output := make([]byte, 0, 64*1024)
	at = blockAt
	for i := 0; i < blocks; i++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if at+8+reserveData > size {
			return bad()
		}
		packed, plain := u16(at+4), u16(at+6)
		at += 8 + reserveData
		if plain < 1 || plain > 32768 || packed < 2 || at+packed > size || string(data[at:at+2]) != "CK" || len(output)+plain > 64*1024*1024 {
			return bad()
		}
		dict := output
		if len(dict) > 32768 {
			dict = dict[len(dict)-32768:]
		}
		r := flate.NewReaderDict(bytes.NewReader(data[at+2:at+packed]), dict)
		block, err := io.ReadAll(io.LimitReader(r, int64(plain+1)))
		closeErr := r.Close()
		if err != nil {
			return nil, err
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if len(block) != plain {
			return bad()
		}
		output = append(output, block...)
		at += packed
	}
	result := map[string][]byte{}
	for _, e := range entries {
		if e.start > len(output)-e.length || result[e.name] != nil {
			return bad()
		}
		result[e.name] = output[e.start : e.start+e.length]
	}
	for name := range wanted {
		if result[name] == nil {
			return nil, fmt.Errorf("runtime cabinet is missing %s", name)
		}
	}
	return result, nil
}
func installMSVCCabinet(ctx context.Context, root string, a Artifact, source string) error {
	if a.Size > 32*1024*1024 {
		return fmt.Errorf("runtime package exceeds size limit")
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if a.CabOffset < 0 || a.CabSize <= 0 || a.CabOffset > int64(len(data))-a.CabSize {
		return fmt.Errorf("invalid runtime package offsets")
	}
	outer, err := cabinetFiles(ctx, data[a.CabOffset:a.CabOffset+a.CabSize], map[string]bool{a.CabEntry: true})
	if err != nil {
		return err
	}
	wanted := map[string]bool{}
	for _, f := range a.Files {
		wanted[f.Entry] = true
	}
	inner, err := cabinetFiles(ctx, outer[a.CabEntry], wanted)
	if err != nil {
		return err
	}
	for _, f := range a.Files {
		content := inner[f.Entry]
		if err = installOutput(ctx, root, f, func(w io.Writer) error { _, e := io.Copy(w, contextReader{ctx, bytes.NewReader(content)}); return e }); err != nil {
			return err
		}
	}
	return nil
}
