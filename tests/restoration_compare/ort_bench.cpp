#include <onnxruntime_cxx_api.h>
#include <cuda_runtime_api.h>
#include <chrono>
#include <fstream>
#include <iostream>
#include <vector>
#include <cmath>
using Clock=std::chrono::steady_clock;
double ms(Clock::time_point t){return std::chrono::duration<double,std::milli>(Clock::now()-t).count();}
std::vector<float> read(const char* p,size_t n){std::vector<float>x(n);std::ifstream f(p,std::ios::binary);f.read((char*)x.data(),n*4);if(!f)throw std::runtime_error("input read failed");return x;}
int main(int argc,char**argv){try{
 if(argc!=5)throw std::runtime_error("model image mask output");
 Ort::Env env(ORT_LOGGING_LEVEL_WARNING,"lama-cuda");Ort::SessionOptions opts;opts.SetIntraOpNumThreads(4);
 OrtCUDAProviderOptionsV2* cuda;Ort::ThrowOnError(Ort::GetApi().CreateCUDAProviderOptions(&cuda));const char* keys[]={"device_id","cudnn_conv_algo_search","use_tf32"};const char* values[]={"0","HEURISTIC","0"};Ort::ThrowOnError(Ort::GetApi().UpdateCUDAProviderOptions(cuda,keys,values,3));Ort::ThrowOnError(Ort::GetApi().SessionOptionsAppendExecutionProvider_CUDA_V2(opts,cuda));Ort::GetApi().ReleaseCUDAProviderOptions(cuda);
 auto start=Clock::now();Ort::Session session(env,argv[1],opts);cudaDeviceSynchronize();std::cout<<"load_ms "<<ms(start)<<std::endl;
 auto image=read(argv[2],3*512*512),mask=read(argv[3],512*512);float *x,*m;cudaMalloc(reinterpret_cast<void**>(&x),image.size()*4);cudaMalloc(reinterpret_cast<void**>(&m),mask.size()*4);cudaMemcpy(x,image.data(),image.size()*4,cudaMemcpyHostToDevice);cudaMemcpy(m,mask.data(),mask.size()*4,cudaMemcpyHostToDevice);
 Ort::MemoryInfo mem("Cuda",OrtDeviceAllocator,0,OrtMemTypeDefault);std::vector<int64_t> xs={1,3,512,512},msk={1,1,512,512};auto xv=Ort::Value::CreateTensor<float>(mem,x,image.size(),xs.data(),xs.size());auto mv=Ort::Value::CreateTensor<float>(mem,m,mask.size(),msk.data(),msk.size());Ort::IoBinding binding(session);binding.BindInput("image",xv);binding.BindInput("mask",mv);binding.BindOutput("output",mem);
 for(int i=0;i<10;i++){cudaDeviceSynchronize();start=Clock::now();session.Run(Ort::RunOptions{},binding);binding.SynchronizeOutputs();cudaDeviceSynchronize();std::cout<<"run_ms "<<i<<" "<<ms(start)<<std::endl;}
 auto out=binding.GetOutputValues();std::vector<float> result(image.size());cudaMemcpy(result.data(),out[0].GetTensorData<float>(),result.size()*4,cudaMemcpyDeviceToHost);for(float f:result)if(!std::isfinite(f))throw std::runtime_error("nonfinite output");std::ofstream file(argv[4],std::ios::binary);file.write((char*)result.data(),result.size()*4);cudaFree(x);cudaFree(m);return 0;
 }catch(const std::exception&e){std::cerr<<e.what()<<std::endl;return 1;}}
