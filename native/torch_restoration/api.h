#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef _WIN32
#define MANGA_LAMA_EXPORT __declspec(dllexport)
#else
#define MANGA_LAMA_EXPORT __attribute__((visibility("default")))
#endif
#ifdef __cplusplus
extern "C" {
#endif
// ABI v1: host-owned FP32 NCHW arrays, fixed 512x512, UTF-8 model path.
// No STL objects, exceptions or allocation ownership cross the ABI boundary.
MANGA_LAMA_EXPORT uint32_t manga_lama_abi(void);
MANGA_LAMA_EXPORT void* manga_lama_create(const char* model, int device, char* error, size_t capacity);
MANGA_LAMA_EXPORT int manga_lama_run(void* instance, const float* image, size_t image_count,
 const float* mask, size_t mask_count, float* output, size_t output_count, char* error, size_t capacity);
MANGA_LAMA_EXPORT void manga_lama_destroy(void* instance);
#ifdef __cplusplus
}
#endif
