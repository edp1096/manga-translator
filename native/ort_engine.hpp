#pragma once
#include "common.hpp"
#define ORT_API_MANUAL_INIT
#include <onnxruntime_cxx_api.h>
#include <mutex>
#include <cstdlib>
#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif
// Windows must not import onnxruntime.dll at process startup: System32 is
// searched before PATH and can contain an unrelated, older ONNX Runtime.
namespace manga_ort {
inline fs::path library_path,loaded_path;
inline std::string runtime_version;
#ifdef _WIN32
inline HMODULE module_handle=nullptr;
#endif
inline void initialize(){
 static std::once_flag initialized;
 std::call_once(initialized,[]{
  const OrtApiBase* base=nullptr;
#ifdef _WIN32
  require(!library_path.empty()&&library_path.is_absolute(),"Selected ONNX Runtime DLL path was not configured; start through the updated control app");
  require(fs::is_regular_file(library_path),"Selected ONNX Runtime DLL is missing: "+library_path.u8string());
  module_handle=LoadLibraryExW(library_path.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_APPLICATION_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);
  require(module_handle!=nullptr,"Cannot load selected ONNX Runtime DLL: "+library_path.u8string()+" (Windows error "+std::to_string(GetLastError())+")");
  auto get_base=reinterpret_cast<decltype(&::OrtGetApiBase)>(GetProcAddress(module_handle,"OrtGetApiBase"));
  require(get_base!=nullptr,"OrtGetApiBase is missing in selected DLL: "+library_path.u8string());base=get_base();
  std::vector<wchar_t> filename(32768);DWORD length=GetModuleFileNameW(module_handle,filename.data(),static_cast<DWORD>(filename.size()));
  loaded_path=length&&length<filename.size()?fs::path(filename.data(),filename.data()+length):library_path;
#else
  base=OrtGetApiBase();Dl_info info{};if(dladdr(reinterpret_cast<const void*>(&OrtGetApiBase),&info)&&info.dli_fname)loaded_path=fs::path(info.dli_fname);
#endif
  require(base&&base->GetApi&&base->GetVersionString,"Invalid ONNX Runtime API base");runtime_version=base->GetVersionString();
  const auto* api=base->GetApi(24);
  require(api,"ONNX Runtime API 24 is required; loaded "+runtime_version+" from "+loaded_path.u8string());
  Ort::InitApi(api);std::cerr<<"ONNX Runtime "<<runtime_version<<" | API 24 | "<<loaded_path.u8string()<<std::endl;
 });
}
}
inline Ort::Env private_ort_env(const char* name){manga_ort::initialize();Ort::Env env(ORT_LOGGING_LEVEL_WARNING,name);env.DisableTelemetryEvents();return env;}

struct OrtExecution {std::string backend="cpu";int device=0;};
inline OrtExecution ort_execution(const json& config,const char* stage){return {config.value(std::string(stage)+"_execution",std::string("cpu")),config.value("gpu_index",0)};}
inline Ort::SessionOptions ort_options(int threads,OrtExecution execution={}){
 Ort::SessionOptions o;o.SetIntraOpNumThreads(threads);o.SetInterOpNumThreads(1);o.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);o.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
 if(execution.backend=="cuda"){
  OrtCUDAProviderOptionsV2* options=nullptr;Ort::ThrowOnError(Ort::GetApi().CreateCUDAProviderOptions(&options));
  try{std::string device=std::to_string(execution.device);const char* keys[]={"device_id","cudnn_conv_algo_search"};const char* values[]={device.c_str(),"HEURISTIC"};Ort::ThrowOnError(Ort::GetApi().UpdateCUDAProviderOptions(options,keys,values,2));Ort::ThrowOnError(Ort::GetApi().SessionOptionsAppendExecutionProvider_CUDA_V2(o,options));}catch(...){Ort::GetApi().ReleaseCUDAProviderOptions(options);throw;}Ort::GetApi().ReleaseCUDAProviderOptions(options);
 }else if(execution.backend=="directml"){
#ifdef _WIN32
  using AppendDML=OrtStatus*(ORT_API_CALL*)(OrtSessionOptions*,int);auto append=reinterpret_cast<AppendDML>(GetProcAddress(manga_ort::module_handle,"OrtSessionOptionsAppendExecutionProvider_DML"));require(append,"DirectML provider is unavailable");o.DisableMemPattern();Ort::ThrowOnError(append(o,execution.device));
#else
  throw std::runtime_error("DirectML requires Windows");
#endif
 }else require(execution.backend=="cpu","Unknown ONNX execution backend: "+execution.backend);
 if(std::getenv("MANGA_ORT_PROFILE")){fs::create_directories("data/cache");o.EnableProfiling(fs::path("data/cache/ort-profile").c_str());}
 return o;
}
inline Ort::MemoryInfo& cpu_memory(){static Ort::MemoryInfo m=Ort::MemoryInfo::CreateCpu(OrtArenaAllocator,OrtMemTypeDefault);return m;}
template<class T> inline Ort::Value tensor(T* data,size_t n,std::initializer_list<int64_t> shape){static T empty{};return Ort::Value::CreateTensor<T>(cpu_memory(),n?data:&empty,n,shape.begin(),shape.size());}
template<class T> inline Ort::Value tensor(std::vector<T>& v,std::initializer_list<int64_t> shape){return tensor(v.data(),v.size(),shape);}
struct OrtEngine:Engine{
 bool nova;Ort::Env env;Ort::SessionOptions options;Ort::Session enc,dec;std::vector<float> base;
 OrtEngine(const fs::path& dir,bool is_nova,int threads,int patches):Engine(is_nova?dir/"hayai-ocr-tokenizer.json":dir/"tokenizer.json",is_nova?patches:256),nova(is_nova),env(private_ort_env("hayai-ocr")),options(ort_options(threads)),enc(env,(is_nova?dir/"hayai-ocr-vision.onnx":dir/"hayai_encoder.onnx").c_str(),options),dec(env,(is_nova?dir/"hayai-ocr-decoder.onnx":dir/"hayai_decoder.onnx").c_str(),options){env.DisableTelemetryEvents();if(!nova)base=read_positions(dir/"position_base.npy");}
 // The alternate v2 filenames are passed explicitly to avoid renaming model files.
 OrtEngine(const fs::path& dir,int threads,bool quant):Engine(dir/"tokenizer.json",256),nova(false),env(private_ort_env("hayai-ocr")),options(ort_options(threads)),enc(env,(dir/(quant?"hayai_encoder_dynamic_quant.onnx":"hayai_encoder.onnx")).c_str(),options),dec(env,(dir/(quant?"hayai_decoder_dynamic_quant.onnx":"hayai_decoder.onnx")).c_str(),options),base(read_positions(dir/"position_base.npy")){env.DisableTelemetryEvents();}
 std::string name()const override{return nova?"onnx-nova":"onnx-v2";}
 Result run(const fs::path& image,int max_tokens)override{
  Result result;auto total=Clock::now(),phase=total;Prepared p=prepare(image,budget,!nova,base);result.prepare_ms=ms(phase);result.patches=p.patches;result.ph=p.ph;result.pw=p.pw;dump_prepared(dump,p);
  phase=Clock::now();std::vector<Ort::Value> inputs;std::vector<const char*> names;std::vector<int64_t> grid{p.ph,p.pw};
  if(nova){names={"p_grid","pixel_values"};inputs.push_back(tensor(grid,{2}));inputs.push_back(tensor(p.pixels,{1,p.patches,768}));}else{names={"pixel_values","attention_mask","pos_embeds"};inputs.push_back(tensor(p.pixels,{1,256,768}));inputs.push_back(tensor(p.mask,{1,256}));inputs.push_back(tensor(p.pos,{1,256,768}));}
  auto output_name=enc.GetOutputNameAllocated(0,Ort::AllocatorWithDefaultOptions());const char* output_names[]={output_name.get()};auto vision_output=enc.Run(Ort::RunOptions{nullptr},names.data(),inputs.data(),inputs.size(),output_names,1);result.encoder_ms=ms(phase);
  if(!dump.empty()){const auto* values=vision_output[0].GetTensorData<float>();dump_floats(dump/"vision.f32",std::vector<float>(values,values+size_t(nova?p.patches:256)*768));}
  if(nova)run_nova(p,vision_output[0],max_tokens,result);else run_v2(p,vision_output[0],max_tokens,result);
  result.total_ms=ms(total);return result;
 }
 void run_v2(Prepared& p,Ort::Value& vision,int max_tokens,Result& r){
  const char* in_names[]={"visual_features","text_token_ids","cos","sin","mask"};const char* out_names[]={"logits"};std::vector<int64_t> tokens{tokenizer.bos};
  for(int step=0;step<max_tokens;++step){auto t=Clock::now();int len=256+tokens.size();auto mask=block_mask(256,tokens.size());std::vector<Ort::Value> in;
   in.push_back(tensor(vision.GetTensorMutableData<float>(),256*768,{1,256,768}));in.push_back(tensor(tokens,{1,int64_t(tokens.size())}));in.push_back(tensor(p.cos.data(),size_t(len)*32,{1,len,32}));in.push_back(tensor(p.sin.data(),size_t(len)*32,{1,len,32}));in.push_back(tensor(mask,{1,1,len,len}));
   auto out=dec.Run(Ort::RunOptions{nullptr},in_names,in.data(),in.size(),out_names,1);auto count=out[0].GetTensorTypeAndShapeInfo().GetElementCount();require(count>=16004,"Bad ONNX v2 logits");const float* last=out[0].GetTensorData<float>()+count-16004;int64_t next=argmax(last,16004);double elapsed=ms(t);if(step==0){r.prefill_ms=elapsed;if(!dump.empty())dump_floats(dump/"first_logits.f32",std::vector<float>(last,last+16004));}else r.decode_ms+=elapsed;
   if(tokenizer.stop(next)){r.stopped=true;break;}r.ids.push_back(next);tokens.push_back(next);
  }
 }
 void run_nova(Prepared& p,Ort::Value& features,int max_tokens,Result& r){
  auto phase=Clock::now();int ph=(p.ph+1)/2,pw=(p.pw+1)/2,M=ph*pw,S=M+1;
  auto visual=unshuffle(features.GetTensorData<float>(),p.ph,p.pw);auto rotations=rope(ph,pw,M,max_tokens);auto mask=block_mask(M,1);std::vector<float> empty;std::vector<int64_t> tokens{tokenizer.bos};
  const char* in_names[]={"vision","tokens","cos","sin","mask","past"};const char* out_names[]={"logits","present"};std::vector<Ort::Value> in;
  in.push_back(tensor(visual,{1,M,3072}));in.push_back(tensor(tokens,{1,1}));in.push_back(tensor(rotations.first.data(),size_t(S)*32,{1,S,32}));in.push_back(tensor(rotations.second.data(),size_t(S)*32,{1,S,32}));in.push_back(tensor(mask,{1,1,S,S}));in.push_back(tensor(empty,{24,1,2,0,64}));
  auto out=dec.Run(Ort::RunOptions{nullptr},in_names,in.data(),in.size(),out_names,2);int64_t next=argmax(out[0].GetTensorData<float>(),16004);r.prefill_ms=ms(phase);if(!dump.empty())dump_floats(dump/"first_logits.f32",std::vector<float>(out[0].GetTensorData<float>(),out[0].GetTensorData<float>()+16004));
  Ort::Value past=std::move(out[1]);if(tokenizer.stop(next)){r.stopped=true;return;}r.ids.push_back(next);phase=Clock::now();
  while(int(r.ids.size())<max_tokens){int step=r.ids.size();int L=M+step;tokens[0]=next;std::vector<float> stepmask(L+1,0.f);std::vector<Ort::Value> step_inputs;
   step_inputs.push_back(tensor(empty,{1,0,3072}));step_inputs.push_back(tensor(tokens,{1,1}));step_inputs.push_back(tensor(rotations.first.data()+size_t(M+step)*32,32,{1,1,32}));step_inputs.push_back(tensor(rotations.second.data()+size_t(M+step)*32,32,{1,1,32}));step_inputs.push_back(tensor(stepmask,{1,1,1,L+1}));step_inputs.push_back(std::move(past));
   auto stepout=dec.Run(Ort::RunOptions{nullptr},in_names,step_inputs.data(),step_inputs.size(),out_names,2);next=argmax(stepout[0].GetTensorData<float>(),16004);past=std::move(stepout[1]);if(tokenizer.stop(next)){r.stopped=true;break;}r.ids.push_back(next);
  }
  r.decode_ms=ms(phase);
 }
};
