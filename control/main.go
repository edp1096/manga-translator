package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"manga-translator/control/internal/assets"
	"manga-translator/control/internal/control"
	"os"
)

func main() {
	root := flag.String("root", "", "absolute application data directory (default: executable directory)")
	printRoot := flag.Bool("print-root", false, "print the resolved data directory without creating files")
	noSetup := flag.Bool("no-auto-setup", false, "do not start installed APIs automatically (downloads are always explicit)")
	noOpen := flag.Bool("no-open", false, "do not open the browser")
	version := flag.Bool("version", false, "print version")
	hardware := flag.Bool("hardware-info", false, "print hardware information from OS and driver APIs")
	flag.Parse()
	if *hardware {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(control.HardwareReport()); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if *version {
		fmt.Println(control.Version)
		return
	}
	resolvedRoot, e := control.ResolveRoot(*root)
	if e == nil && *printRoot {
		fmt.Println(resolvedRoot)
		return
	}
	var bundle fs.FS
	if e == nil {
		bundle, e = fs.Sub(assets.FS, "bundle")
	}
	if e == nil {
		e = control.Run(resolvedRoot, bundle, *noSetup, *noOpen)
	}
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		control.ShowError(e.Error())
		os.Exit(1)
	}
}
