#pragma once
// Load LiteRT only when the selected OCR backend needs it.
#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif
namespace manga_litert {
inline fs::path library_path;
struct Api {
#ifdef _WIN32
 HMODULE handle=nullptr;
#else
 void* handle=nullptr;
#endif
 template<class T> T symbol(const char* name) {
#ifdef _WIN32
  auto value=GetProcAddress(handle,name);
#else
  auto value=dlsym(handle,name);
#endif
  if(!value)throw std::runtime_error(std::string("Missing LiteRT symbol: ")+name);
  return reinterpret_cast<T>(value);
 }
 decltype(&::LiteRtAddOpaqueOptions) LiteRtAddOpaqueOptions=nullptr;
 decltype(&::LiteRtCreateCompiledModel) LiteRtCreateCompiledModel=nullptr;
 decltype(&::LiteRtCreateEnvironment) LiteRtCreateEnvironment=nullptr;
 decltype(&::LiteRtCreateManagedTensorBufferFromRequirements) LiteRtCreateManagedTensorBufferFromRequirements=nullptr;
 decltype(&::LiteRtCreateModelFromFile) LiteRtCreateModelFromFile=nullptr;
 decltype(&::LiteRtCreateOpaqueOptions) LiteRtCreateOpaqueOptions=nullptr;
 decltype(&::LiteRtCreateOptions) LiteRtCreateOptions=nullptr;
 decltype(&::LiteRtDestroyCompiledModel) LiteRtDestroyCompiledModel=nullptr;
 decltype(&::LiteRtDestroyEnvironment) LiteRtDestroyEnvironment=nullptr;
 decltype(&::LiteRtDestroyModel) LiteRtDestroyModel=nullptr;
 decltype(&::LiteRtDestroyOptions) LiteRtDestroyOptions=nullptr;
 decltype(&::LiteRtDestroyTensorBuffer) LiteRtDestroyTensorBuffer=nullptr;
 decltype(&::LiteRtGetCompiledModelInputBufferRequirements) LiteRtGetCompiledModelInputBufferRequirements=nullptr;
 decltype(&::LiteRtGetCompiledModelOutputBufferRequirements) LiteRtGetCompiledModelOutputBufferRequirements=nullptr;
 decltype(&::LiteRtGetModelSignature) LiteRtGetModelSignature=nullptr;
 decltype(&::LiteRtGetNumSignatureInputs) LiteRtGetNumSignatureInputs=nullptr;
 decltype(&::LiteRtGetNumSignatureOutputs) LiteRtGetNumSignatureOutputs=nullptr;
 decltype(&::LiteRtGetRankedTensorType) LiteRtGetRankedTensorType=nullptr;
 decltype(&::LiteRtGetSignatureInputTensorByIndex) LiteRtGetSignatureInputTensorByIndex=nullptr;
 decltype(&::LiteRtGetSignatureOutputTensorByIndex) LiteRtGetSignatureOutputTensorByIndex=nullptr;
 decltype(&::LiteRtGetTensorBufferPackedSize) LiteRtGetTensorBufferPackedSize=nullptr;
 decltype(&::LiteRtLockTensorBuffer) LiteRtLockTensorBuffer=nullptr;
 decltype(&::LiteRtRunCompiledModel) LiteRtRunCompiledModel=nullptr;
 decltype(&::LiteRtSetOptionsHardwareAccelerators) LiteRtSetOptionsHardwareAccelerators=nullptr;
 decltype(&::LiteRtUnlockTensorBuffer) LiteRtUnlockTensorBuffer=nullptr;
 Api(){
  require(!library_path.empty(),"LiteRT library path was not configured");
#ifdef _WIN32
  handle=LoadLibraryExW(library_path.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
#else
  handle=dlopen(library_path.c_str(),RTLD_NOW|RTLD_LOCAL);
#endif
  require(handle!=nullptr,"Cannot load selected LiteRT runtime");
  try {
   LiteRtAddOpaqueOptions=symbol<decltype(LiteRtAddOpaqueOptions)>("LiteRtAddOpaqueOptions");
   LiteRtCreateCompiledModel=symbol<decltype(LiteRtCreateCompiledModel)>("LiteRtCreateCompiledModel");
   LiteRtCreateEnvironment=symbol<decltype(LiteRtCreateEnvironment)>("LiteRtCreateEnvironment");
   LiteRtCreateManagedTensorBufferFromRequirements=symbol<decltype(LiteRtCreateManagedTensorBufferFromRequirements)>("LiteRtCreateManagedTensorBufferFromRequirements");
   LiteRtCreateModelFromFile=symbol<decltype(LiteRtCreateModelFromFile)>("LiteRtCreateModelFromFile");
   LiteRtCreateOpaqueOptions=symbol<decltype(LiteRtCreateOpaqueOptions)>("LiteRtCreateOpaqueOptions");
   LiteRtCreateOptions=symbol<decltype(LiteRtCreateOptions)>("LiteRtCreateOptions");
   LiteRtDestroyCompiledModel=symbol<decltype(LiteRtDestroyCompiledModel)>("LiteRtDestroyCompiledModel");
   LiteRtDestroyEnvironment=symbol<decltype(LiteRtDestroyEnvironment)>("LiteRtDestroyEnvironment");
   LiteRtDestroyModel=symbol<decltype(LiteRtDestroyModel)>("LiteRtDestroyModel");
   LiteRtDestroyOptions=symbol<decltype(LiteRtDestroyOptions)>("LiteRtDestroyOptions");
   LiteRtDestroyTensorBuffer=symbol<decltype(LiteRtDestroyTensorBuffer)>("LiteRtDestroyTensorBuffer");
   LiteRtGetCompiledModelInputBufferRequirements=symbol<decltype(LiteRtGetCompiledModelInputBufferRequirements)>("LiteRtGetCompiledModelInputBufferRequirements");
   LiteRtGetCompiledModelOutputBufferRequirements=symbol<decltype(LiteRtGetCompiledModelOutputBufferRequirements)>("LiteRtGetCompiledModelOutputBufferRequirements");
   LiteRtGetModelSignature=symbol<decltype(LiteRtGetModelSignature)>("LiteRtGetModelSignature");
   LiteRtGetNumSignatureInputs=symbol<decltype(LiteRtGetNumSignatureInputs)>("LiteRtGetNumSignatureInputs");
   LiteRtGetNumSignatureOutputs=symbol<decltype(LiteRtGetNumSignatureOutputs)>("LiteRtGetNumSignatureOutputs");
   LiteRtGetRankedTensorType=symbol<decltype(LiteRtGetRankedTensorType)>("LiteRtGetRankedTensorType");
   LiteRtGetSignatureInputTensorByIndex=symbol<decltype(LiteRtGetSignatureInputTensorByIndex)>("LiteRtGetSignatureInputTensorByIndex");
   LiteRtGetSignatureOutputTensorByIndex=symbol<decltype(LiteRtGetSignatureOutputTensorByIndex)>("LiteRtGetSignatureOutputTensorByIndex");
   LiteRtGetTensorBufferPackedSize=symbol<decltype(LiteRtGetTensorBufferPackedSize)>("LiteRtGetTensorBufferPackedSize");
   LiteRtLockTensorBuffer=symbol<decltype(LiteRtLockTensorBuffer)>("LiteRtLockTensorBuffer");
   LiteRtRunCompiledModel=symbol<decltype(LiteRtRunCompiledModel)>("LiteRtRunCompiledModel");
   LiteRtSetOptionsHardwareAccelerators=symbol<decltype(LiteRtSetOptionsHardwareAccelerators)>("LiteRtSetOptionsHardwareAccelerators");
   LiteRtUnlockTensorBuffer=symbol<decltype(LiteRtUnlockTensorBuffer)>("LiteRtUnlockTensorBuffer");
  }catch(...){close();throw;}
 }
 void close(){if(handle){
#ifdef _WIN32
  FreeLibrary(handle);
#else
  dlclose(handle);
#endif
  handle=nullptr;}}
 ~Api(){close();}
};
inline Api& api(){static Api value;return value;}
}
#define LiteRtAddOpaqueOptions manga_litert::api().LiteRtAddOpaqueOptions
#define LiteRtCreateCompiledModel manga_litert::api().LiteRtCreateCompiledModel
#define LiteRtCreateEnvironment manga_litert::api().LiteRtCreateEnvironment
#define LiteRtCreateManagedTensorBufferFromRequirements manga_litert::api().LiteRtCreateManagedTensorBufferFromRequirements
#define LiteRtCreateModelFromFile manga_litert::api().LiteRtCreateModelFromFile
#define LiteRtCreateOpaqueOptions manga_litert::api().LiteRtCreateOpaqueOptions
#define LiteRtCreateOptions manga_litert::api().LiteRtCreateOptions
#define LiteRtDestroyCompiledModel manga_litert::api().LiteRtDestroyCompiledModel
#define LiteRtDestroyEnvironment manga_litert::api().LiteRtDestroyEnvironment
#define LiteRtDestroyModel manga_litert::api().LiteRtDestroyModel
#define LiteRtDestroyOptions manga_litert::api().LiteRtDestroyOptions
#define LiteRtDestroyTensorBuffer manga_litert::api().LiteRtDestroyTensorBuffer
#define LiteRtGetCompiledModelInputBufferRequirements manga_litert::api().LiteRtGetCompiledModelInputBufferRequirements
#define LiteRtGetCompiledModelOutputBufferRequirements manga_litert::api().LiteRtGetCompiledModelOutputBufferRequirements
#define LiteRtGetModelSignature manga_litert::api().LiteRtGetModelSignature
#define LiteRtGetNumSignatureInputs manga_litert::api().LiteRtGetNumSignatureInputs
#define LiteRtGetNumSignatureOutputs manga_litert::api().LiteRtGetNumSignatureOutputs
#define LiteRtGetRankedTensorType manga_litert::api().LiteRtGetRankedTensorType
#define LiteRtGetSignatureInputTensorByIndex manga_litert::api().LiteRtGetSignatureInputTensorByIndex
#define LiteRtGetSignatureOutputTensorByIndex manga_litert::api().LiteRtGetSignatureOutputTensorByIndex
#define LiteRtGetTensorBufferPackedSize manga_litert::api().LiteRtGetTensorBufferPackedSize
#define LiteRtLockTensorBuffer manga_litert::api().LiteRtLockTensorBuffer
#define LiteRtRunCompiledModel manga_litert::api().LiteRtRunCompiledModel
#define LiteRtSetOptionsHardwareAccelerators manga_litert::api().LiteRtSetOptionsHardwareAccelerators
#define LiteRtUnlockTensorBuffer manga_litert::api().LiteRtUnlockTensorBuffer
