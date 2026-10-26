#!/bin/sh
# Developer build only; end users download the required native runtimes.
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
build_dir=${MANGA_NATIVE_BUILD_DIR:-"$source_dir/.build"}
cmake -S "$source_dir" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release "$@"
cmake --build "$build_dir" --target manga-translator-server -j "${MANGA_BUILD_JOBS:-4}"
