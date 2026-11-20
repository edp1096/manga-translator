#pragma once
#include "common.hpp"
#include <NvInfer.h>
#include <cuda_runtime_api.h>

namespace hayai_trt {
using namespace nvinfer1;

struct CudaBuffer {
 void* data = nullptr;
 size_t capacity = 0;
 CudaBuffer() = default;
 CudaBuffer(const CudaBuffer&) = delete;
 CudaBuffer& operator=(const CudaBuffer&) = delete;
 ~CudaBuffer() { if (data) cudaFree(data); }
};

inline void check(cudaError_t error) {
 if (error != cudaSuccess) throw std::runtime_error(cudaGetErrorString(error));
}
inline void ensure(CudaBuffer& buffer,size_t bytes) {
 if (bytes <= buffer.capacity) return;
 if (buffer.data) check(cudaFree(buffer.data));
 buffer.data = nullptr;
 buffer.capacity = 0;
 check(cudaMalloc(&buffer.data, bytes));
 buffer.capacity = bytes;
}

struct Logger : ILogger {
 void log(Severity severity, const char* message) noexcept override {
  if (severity <= Severity::kWARNING) std::cerr << message << '\n';
 }
};

struct Session {
 std::unique_ptr<ICudaEngine> engine;
 std::unique_ptr<IExecutionContext> context;
 std::map<std::string,CudaBuffer> inputs;
 explicit Session(IRuntime& runtime, const fs::path& plan) {
  std::ifstream file(plan,std::ios::binary|std::ios::ate);
  require(file && file.tellg()>0, "missing TensorRT engine");
  std::vector<char> bytes(size_t(file.tellg()));
  file.seekg(0);
  file.read(bytes.data(),bytes.size());
  require(bool(file),"failed to read TensorRT engine");
  engine.reset(runtime.deserializeCudaEngine(bytes.data(),bytes.size()));
  require(bool(engine),"failed to load TensorRT engine");
  context.reset(engine->createExecutionContext());
  require(bool(context),"failed to create TensorRT context");
 }
 template<class T>
 void bind_cpu(const char* name,const T* ptr,size_t count,Dims dims,cudaStream_t stream) {
  require(context->setInputShape(name,dims),name);
  if (engine->getTensorLocation(name)==TensorLocation::kHOST) {
   require(context->setInputTensorAddress(name,ptr),name);
   return;
  }
  auto& buffer=inputs[name];
  ensure(buffer,count*sizeof(T));
  check(cudaMemcpyAsync(buffer.data,ptr,count*sizeof(T),cudaMemcpyHostToDevice,stream));
  require(context->setInputTensorAddress(name,buffer.data),name);
 }
 void bind_cache(const char* name,const CudaBuffer& buf,int64_t length) {
  require(context->setInputShape(name,Dims{5,{12,1,2,length,64}}),name);
  require(context->setInputTensorAddress(name,buf.data),name);
 }
 void output(const char* name,CudaBuffer& buffer,size_t bytes) {
  require(engine->getTensorLocation(name)==TensorLocation::kDEVICE,name);
  ensure(buffer,bytes);
  require(context->setTensorAddress(name,buffer.data),name);
 }
};

struct Stream {
 cudaStream_t value{};
 Stream(){check(cudaStreamCreate(&value));}
 ~Stream(){cudaStreamDestroy(value);}
};

struct TrtHayai {
 Logger logger;
 std::unique_ptr<IRuntime> runtime;
 Stream stream;
 Session pre, decode;
 Tokenizer tokenizer;
 std::vector<float> positions;
 json model_config;
 CudaBuffer key[2],value[2],logits,valid;
 std::vector<float> probabilities;
 static constexpr size_t cache_bytes=12*2*385*64*sizeof(float);
 TrtHayai(const fs::path& prefill,const fs::path& decoder,const fs::path& dir)
 :runtime(createInferRuntime(logger)),pre(checked_runtime(),prefill),decode(*runtime,decoder),
  tokenizer(dir/"tokenizer.json"),positions(read_positions(dir/"pos_embedding.npy")),
  model_config(read_json(dir/"hayai_onnx_config.json")),probabilities(16004) {
  tokenizer.bos=model_config.at("bos_token_id");
  tokenizer.eos=model_config.at("eos_token_id");
  tokenizer.pad=model_config.at("pad_token_id");
  tokenizer.special={tokenizer.bos,tokenizer.eos,tokenizer.pad};
 }
 IRuntime& checked_runtime() {
  require(bool(runtime),"Cannot initialize TensorRT runtime");
  return *runtime;
 }
 Result run(const fs::path& path,int max_tokens) {
  require(max_tokens>0&&max_tokens<=256,"TensorRT sample token limit");
  auto start=Clock::now();
  int w,h,channels;
  std::ifstream file(path,std::ios::binary|std::ios::ate);
  require(file && file.tellg()>0 && file.tellg()<=64*1024*1024,"invalid image file");
  std::vector<unsigned char> blob(size_t(file.tellg()));
  file.seekg(0);
  file.read(reinterpret_cast<char*>(blob.data()),blob.size());
  require(bool(file),"image read failed");
  std::unique_ptr<unsigned char,decltype(&stbi_image_free)> image(
      stbi_load_from_memory(blob.data(),int(blob.size()),&w,&h,&channels,3),stbi_image_free);
  require(bool(image),"image read failed");
  const auto axis=[](int n,double s){return std::max(1,int(std::ceil(n*s/16)));};
  const auto fit=[&](double lo,double hi,int limit){
   while(hi-lo>=1e-5){
    const auto mid=(hi+lo)*.5;
    if(axis(w,mid)*axis(h,mid)<=limit)lo=mid;
    else hi=mid;
   }
   return lo;
  };
  auto scale=fit(1e-5,model_config.at("max_scale"),256);
  const int minimum=model_config.at("min_patches");
  if(axis(w,scale)*axis(h,scale)<minimum)scale=fit(scale,100.,minimum);
  const int ph=axis(h,scale),pw=axis(w,scale),n=ph*pw;
  const int multiple=model_config.at("pad_to_multiple_of");
  const int slots=(n+multiple-1)/multiple*multiple;
  const int visuals=((ph+1)/2)*((pw+1)/2);
  const auto resized=resize_rgb(image.get(),w,h,pw*16,ph*16);
  std::vector<float> pixels(size_t(slots)*768);
  for(int y=0;y<ph*16;++y)for(int x=0;x<pw*16;++x)for(int c=0;c<3;++c){
   const int patch=(y/16)*pw+x/16, component=((y%16)*16+x%16)*3+c;
   pixels[size_t(patch)*768+component]=resized[(size_t(y)*pw*16+x)*3+c]*(2.0f/255.0f)-1.0f;
  }
  auto pos=resize_positions(positions,pw,ph);
  pos.resize(size_t(slots)*768);
  std::vector<int64_t> indices(visuals),attention(visuals+1);
  std::iota(indices.begin(),indices.end(),int64_t(0));
  const int64_t shape[]={ph,pw},bos=tokenizer.bos;
  Result r;
  r.prepare_ms=ms(start);
  auto phase=Clock::now();
  auto s=stream.value;
  const Dims patch_dims{3,{1,slots,768}};
  pre.bind_cpu("pixel_values",pixels.data(),pixels.size(),patch_dims,s);
  pre.bind_cpu("pos_embeds",pos.data(),pos.size(),patch_dims,s);
  pre.bind_cpu("spatial_shapes",shape,2,Dims2{1,2},s);
  pre.bind_cpu("bos_ids",&bos,1,Dims2{1,1},s);
  pre.bind_cpu("l_vis_arange",indices.data(),indices.size(),Dims{1,{visuals}},s);
  pre.output("logits",logits,probabilities.size()*sizeof(float));
  pre.output("k_cache",key[0],cache_bytes);
  pre.output("v_cache",value[0],cache_bytes);
  pre.output("vis_valid",valid,visuals*sizeof(int64_t));
  require(pre.context->enqueueV3(s),"TensorRT prefill");
  check(cudaMemcpyAsync(attention.data(),valid.data,visuals*sizeof(int64_t),cudaMemcpyDeviceToHost,s));
  read_logits(s);
  r.prefill_ms=ms(phase);
  attention.back()=1;
  phase=Clock::now();
  for(int64_t step=1;step<=max_tokens;++step){
   const int64_t next=argmax(probabilities.data(),probabilities.size());
   if(tokenizer.stop(next)){r.stopped=true;break;}
   r.ids.push_back(next);
   if(step==max_tokens)break;
   const int input_index=(step-1)%2,output_index=step%2;
   decode.bind_cpu("input_ids",&next,1,Dims2{1,1},s);
   decode.bind_cpu("past_attention_mask",attention.data(),attention.size(),Dims2{1,int64_t(attention.size())},s);
   decode.bind_cpu("position_id",&step,1,Dims{1,{1}},s);
   decode.bind_cache("k_cache_in",key[input_index],visuals+step);
   decode.bind_cache("v_cache_in",value[input_index],visuals+step);
   decode.output("logits",logits,probabilities.size()*sizeof(float));
   decode.output("k_cache_out",key[output_index],cache_bytes);
   decode.output("v_cache_out",value[output_index],cache_bytes);
   require(decode.context->enqueueV3(s),"TensorRT decode");
   read_logits(s);
   attention.push_back(1);
  }
  r.decode_ms=ms(phase);
  r.total_ms=ms(start);
  return r;
 }
 void read_logits(cudaStream_t s) {
  check(cudaMemcpyAsync(probabilities.data(),logits.data,probabilities.size()*sizeof(float),cudaMemcpyDeviceToHost,s));
  check(cudaStreamSynchronize(s));
 }
};

struct PageOcr : Engine {
 TrtHayai runner;
 PageOcr(const fs::path& model,const fs::path& plan)
  : Engine(model/"tokenizer.json",256),runner(plan/"prefill.plan",plan/"decode.plan",model) {
  tokenizer.bos=runner.tokenizer.bos;
  tokenizer.eos=runner.tokenizer.eos;
  tokenizer.pad=runner.tokenizer.pad;
  tokenizer.special=runner.tokenizer.special;
 }
 Result run(const fs::path& image,int max_tokens) override {
  return runner.run(image,max_tokens);
 }
 std::string name() const override { return "tensorrt-hayai-v27"; }
};
} // namespace hayai_trt
