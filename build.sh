#!/bin/sh
# Build both portable releases from any working directory.
set -eu
export CGO_ENABLED=0
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
command -v go >/dev/null 2>&1 || { echo 'Go 1.26.5+ is required.' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo 'Node.js 24 and npm are required.' >&2; exit 1; }
cd "$project_dir/control"
npm ci --prefix web
exec go run ./cmd/package "$@"
