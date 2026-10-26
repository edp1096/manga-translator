package assets

import "embed"

// FS contains the UI, extension, native application binaries and a model conversion
// patch. Third-party runtimes and model weights download only on explicit user action.
//
//go:embed all:bundle
var FS embed.FS
