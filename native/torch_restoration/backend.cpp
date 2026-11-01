#include "api.h"
#include <torch/script.h>
#include <torch/cuda.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <filesystem>
#include <memory>
#include <mutex>

namespace {
constexpr size_t pixels=512*512;
void error_text(char* out,size_t cap,const char* message) noexcept {
 if(out&&cap){const size_t n=std::min(cap-1,std::strlen(message));std::memcpy(out,message,n);out[n]=0;}
}
struct Model {
 torch::Device device;torch::jit::Module module;std::mutex mutex;
 Model(const char* path,int index):device(torch::kCUDA,index){
  if(!torch::cuda::is_available()||index<0||size_t(index)>=torch::cuda::device_count())throw std::runtime_error("Manga LaMa CUDA device unavailable");
  torch::NoGradGuard guard;
  at::globalContext().setAllowTF32CuBLAS(false);at::globalContext().setAllowTF32CuDNN(false);
  std::ifstream input(std::filesystem::u8path(path),std::ios::binary);
  if(!input)throw std::runtime_error("Cannot open Manga LaMa TorchScript checkpoint");
  module=torch::jit::load(input,device);module.eval();
  // Warm the actual graph before the API announces readiness. Both the JIT
  // profiling run and optimized run are exercised, using a nonempty mask.
  auto image=torch::zeros({1,3,512,512},torch::TensorOptions().dtype(torch::kFloat32).device(device));
  auto mask=torch::zeros({1,1,512,512},image.options());mask.slice(2,200,312).slice(3,200,312).fill_(1);
  for(int i=0;i<3;i++)check(module.forward({image,mask}).toTensor());
  torch::cuda::synchronize(index);
 }
 void check(const torch::Tensor& out){
  if(out.sizes()!=torch::IntArrayRef({1,3,512,512})||out.scalar_type()!=torch::kFloat32||out.device()!=device)throw std::runtime_error("Invalid Manga LaMa CUDA output type/shape/device");
  if(!torch::isfinite(out).all().item<bool>())throw std::runtime_error("Nonfinite Manga LaMa CUDA output");
 }
 void run(const float* image,const float* mask,float* output){
  std::lock_guard<std::mutex> lock(mutex);torch::NoGradGuard guard;
  for(size_t i=0;i<3*pixels;i++)if(!std::isfinite(image[i])||image[i]<0||image[i]>1)throw std::runtime_error("Invalid restoration image values");
  for(size_t i=0;i<pixels;i++)if(mask[i]!=0&&mask[i]!=1)throw std::runtime_error("Invalid binary restoration mask");
  auto x=torch::from_blob(const_cast<float*>(image),{1,3,512,512},torch::kFloat32).to(device);
  auto m=torch::from_blob(const_cast<float*>(mask),{1,1,512,512},torch::kFloat32).to(device);
  auto result=module.forward({x,m}).toTensor();check(result);
  auto cpu=result.to(torch::kCPU).contiguous();std::memcpy(output,cpu.data_ptr<float>(),3*pixels*sizeof(float));
 }
};
}
uint32_t manga_lama_abi(void){return 1;}
void* manga_lama_create(const char* model,int device,char* error,size_t cap){
 try{if(!model||!*model)throw std::runtime_error("Missing Manga LaMa model path");return new Model(model,device);}
 catch(const std::exception& e){error_text(error,cap,e.what());return nullptr;}catch(...){error_text(error,cap,"Unknown LibTorch initialization failure");return nullptr;}
}
int manga_lama_run(void* instance,const float* image,size_t image_count,const float* mask,size_t mask_count,float* output,size_t output_count,char* error,size_t cap){
 try{if(!instance||!image||!mask||!output||image_count!=3*pixels||mask_count!=pixels||output_count!=3*pixels)throw std::runtime_error("Invalid Manga LaMa ABI buffers");static_cast<Model*>(instance)->run(image,mask,output);return 0;}
 catch(const std::exception& e){error_text(error,cap,e.what());return -1;}catch(...){error_text(error,cap,"Unknown LibTorch inference failure");return -1;}
}
void manga_lama_destroy(void* instance){delete static_cast<Model*>(instance);}
