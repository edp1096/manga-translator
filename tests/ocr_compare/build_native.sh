#!/bin/sh
set -eu
cache=${MANGA_BUILD_CACHE:-$HOME/.cache/manga-translator-build}
project=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
sdk="$cache/onnxruntime-linux-aarch64-1.31.0/onnxruntime-linux-aarch64-1.31.0"
mkdir -p "$cache/baberu-eval"
c++ -O3 -DNDEBUG -std=c++17 -ffp-contract=off \
 -I"$sdk/include" -I"$cache/litert_cc_sdk" \
 "$project/tests/ocr_compare/native_compare.cpp" \
 -L"$sdk/lib" -Wl,-rpath,"$sdk/lib" -lonnxruntime -ldl \
 -o "$cache/baberu-eval/native_compare"
