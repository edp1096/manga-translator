// Developer tool: create and verify the embedded spatial conversion patch.
package main

import (
	"crypto/sha256"
	"fmt"
	"github.com/kr/binarydist"
	"io"
	"os"
)

func main() {
	if len(os.Args) != 4 {
		panic("usage: modelpatch original.onnx selected.onnx output.patch")
	}
	old, e := os.Open(os.Args[1])
	must(e)
	defer old.Close()
	next, e := os.Open(os.Args[2])
	must(e)
	defer next.Close()
	out, e := os.Create(os.Args[3])
	must(e)
	must(binarydist.Diff(old, next, out))
	must(out.Close())
	_, e = old.Seek(0, 0)
	must(e)
	patch, e := os.Open(os.Args[3])
	must(e)
	defer patch.Close()
	hash := sha256.New()
	must(binarydist.Patch(old, hash, patch))
	_, e = next.Seek(0, 0)
	must(e)
	expected := sha256.New()
	_, e = io.Copy(expected, next)
	must(e)
	if fmt.Sprintf("%x", hash.Sum(nil)) != fmt.Sprintf("%x", expected.Sum(nil)) {
		panic("patch verification failed")
	}
	info, e := os.Stat(os.Args[3])
	must(e)
	fmt.Printf("verified patch: %d bytes; output SHA256 %x\n", info.Size(), hash.Sum(nil))
}
func must(e error) {
	if e != nil {
		panic(e)
	}
}
