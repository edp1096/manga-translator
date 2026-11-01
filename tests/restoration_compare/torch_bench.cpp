#include <torch/script.h>
#include <ATen/Parallel.h>
#include <torch/cuda.h>
#include <cuda_runtime_api.h>
#include <chrono>
#include <fstream>
#include <iostream>
#include <vector>
using Clock=std::chrono::steady_clock;
double ms(Clock::time_point t){return std::chrono::duration<double,std::milli>(Clock::now()-t).count();}
std::vector<float> read(const char* p,size_t n){std::vector<float>x(n);std::ifstream f(p,std::ios::binary);f.read((char*)x.data(),n*4);if(!f)throw std::runtime_error("input read failed");return x;}
int main(int argc,char**argv){try{
 if(argc!=5)throw std::runtime_error("model image mask output");
 torch::NoGradGuard guard;at::globalContext().setAllowTF32CuBLAS(false);at::globalContext().setAllowTF32CuDNN(false);at::set_num_threads(4);
 if(!torch::cuda::is_available())throw std::runtime_error("CUDA unavailable");
 cudaDeviceProp prop;cudaGetDeviceProperties(&prop,0);std::cout<<"GPU "<<prop.name<<" CC "<<prop.major<<"."<<prop.minor<<"\n";
 auto start=Clock::now();auto model=torch::jit::load(argv[1],torch::kCUDA);model.eval();cudaDeviceSynchronize();std::cout<<"load_ms "<<ms(start)<<"\n";
 auto image=read(argv[2],3*512*512),mask=read(argv[3],512*512);
 auto x=torch::from_blob(image.data(),{1,3,512,512},torch::kFloat32).clone().to(torch::kCUDA);
 auto m=torch::from_blob(mask.data(),{1,1,512,512},torch::kFloat32).clone().to(torch::kCUDA);
 torch::Tensor result;
 for(int i=0;i<10;i++){cudaDeviceSynchronize();start=Clock::now();result=model.forward({x,m}).toTensor();cudaDeviceSynchronize();std::cout<<"run_ms "<<i<<" "<<ms(start)<<std::endl;}
 result=result.cpu().contiguous();if(!torch::isfinite(result).all().item<bool>())throw std::runtime_error("nonfinite output");
 std::ofstream out(argv[4],std::ios::binary);out.write((char*)result.data_ptr<float>(),result.numel()*4);
 size_t free,total;cudaMemGetInfo(&free,&total);std::cout<<"device_free_bytes "<<free<<" device_total_bytes "<<total<<"\n";return 0;
 }catch(const std::exception&e){std::cerr<<e.what()<<std::endl;return 1;}}
