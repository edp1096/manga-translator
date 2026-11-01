#!/bin/sh
set -eu
cd /work
TORCH_DIR=/usr/local/lib/python3.12/dist-packages/torch
g++ -O2 -std=c++20 torch_bench.cpp -I"$TORCH_DIR/include" -I"$TORCH_DIR/include/torch/csrc/api/include" -I/usr/local/cuda/include -L"$TORCH_DIR/lib" -L/usr/local/cuda/lib64 -Wl,-rpath,"$TORCH_DIR/lib" -ltorch -ltorch_cpu -ltorch_cuda -lc10 -lc10_cuda -lcudart -o torch_bench
g++ -O2 -std=c++17 ort_bench.cpp -I/work/ort/include -I/usr/local/cuda/include -L/work/ort/onnxruntime/capi -L/usr/local/cuda/lib64 -Wl,-rpath,/work/ort/onnxruntime/capi -l:libonnxruntime.so.1.31.0 -lcudart -o ort_bench
./torch_bench anime_manga_lama.pt image.f32 mask.f32 torch-output.f32 > torch-results.txt 2>&1
./ort_bench manga-lama-512.onnx image.f32 mask.f32 ort-output.f32 > ort-results.txt 2>&1
ldd torch_bench > torch-dependencies.txt
ldd ort_bench > ort-dependencies.txt
