#pragma once
#include <cstdint>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <vector>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#endif
class TorchRestoration {
 void* instance=nullptr;
 using Create=void*(*)(const char*,int,char*,size_t);
 using Run=int(*)(void*,const float*,size_t,const float*,size_t,float*,size_t,char*,size_t);
 using Destroy=void(*)(void*);
 Run run_fn=nullptr;Destroy destroy_fn=nullptr;
public:
 TorchRestoration(const std::filesystem::path& library,const std::filesystem::path& model,int device){
#ifdef _WIN32
  // cuDNN loads its graph/engine DLLs lazily during the first forward pass.
  // Register only the verified runtime directory; do not depend on global PATH.
  if(!SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS)||!AddDllDirectory(library.parent_path().c_str()))throw std::runtime_error("Cannot register Manga LaMa CUDA DLL directory");
  auto module=LoadLibraryExW(library.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
  if(!module)throw std::runtime_error("Cannot load Manga LaMa LibTorch CUDA runtime: Windows error "+std::to_string(GetLastError()));
  auto symbol=[&](const char* n){return reinterpret_cast<void*>(GetProcAddress(module,n));};
#else
  auto module=dlopen(library.c_str(),RTLD_NOW|RTLD_LOCAL);
  if(!module)throw std::runtime_error(std::string("Cannot load Manga LaMa LibTorch CUDA runtime: ")+dlerror());
  auto symbol=[&](const char* n){return dlsym(module,n);};
#endif
  // LibTorch owns process-wide operator registries. Keep the module loaded;
  // model instances are released by destroy_fn, not by unloading its code.
  auto abi=reinterpret_cast<uint32_t(*)()>(symbol("manga_lama_abi"));
  auto create=reinterpret_cast<Create>(symbol("manga_lama_create"));
  run_fn=reinterpret_cast<Run>(symbol("manga_lama_run"));destroy_fn=reinterpret_cast<Destroy>(symbol("manga_lama_destroy"));
  if(!abi||abi()!=1||!create||!run_fn||!destroy_fn)throw std::runtime_error("Unsupported Manga LaMa LibTorch ABI");
  char error[4096]{};instance=create(model.u8string().c_str(),device,error,sizeof(error));
  if(!instance)throw std::runtime_error(std::string("Manga LaMa CUDA initialization: ")+error);
 }
 TorchRestoration(const TorchRestoration&)=delete;TorchRestoration& operator=(const TorchRestoration&)=delete;
 ~TorchRestoration(){if(instance)destroy_fn(instance);}
 std::vector<float> run(const std::vector<float>& image,const std::vector<float>& mask){
  std::vector<float> output(3*512*512);char error[4096]{};
  if(run_fn(instance,image.data(),image.size(),mask.data(),mask.size(),output.data(),output.size(),error,sizeof(error)))throw std::runtime_error(std::string("Manga LaMa CUDA inference: ")+error);
  return output;
 }
};
