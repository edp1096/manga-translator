#include "../../native/torch_restoration_loader.hpp"
#include <fstream>
#include <iostream>
#include <chrono>
#include <cmath>
using Clock=std::chrono::steady_clock;
std::vector<float> read(const char* p,size_t n){std::vector<float>x(n);std::ifstream f(p,std::ios::binary);f.read(reinterpret_cast<char*>(x.data()),n*4);if(!f)throw std::runtime_error("input read failed");return x;}
int main(int argc,char**argv){try{
 if(argc!=6)throw std::runtime_error("plugin model image mask output");
 auto start=Clock::now();TorchRestoration model(std::filesystem::absolute(argv[1]),std::filesystem::absolute(argv[2]),0);
 std::cout<<"load_warmup_ms "<<std::chrono::duration<double,std::milli>(Clock::now()-start).count()<<std::endl;
 auto image=read(argv[3],3*512*512),mask=read(argv[4],512*512);std::vector<float> result;
 for(int i=0;i<12;i++){start=Clock::now();result=model.run(image,mask);std::cout<<"request_ms "<<i<<" "<<std::chrono::duration<double,std::milli>(Clock::now()-start).count()<<std::endl;}
 auto zero=model.run(image,std::vector<float>(512*512));if(zero.size()!=image.size())throw std::runtime_error("zero mask shape");
 auto full=model.run(image,std::vector<float>(512*512,1));for(float v:full)if(!std::isfinite(v))throw std::runtime_error("full mask nonfinite");
 bool rejected=false;try{model.run(image,std::vector<float>(7));}catch(const std::exception&){rejected=true;}if(!rejected)throw std::runtime_error("invalid shape accepted");
 auto bad=mask;bad[0]=.5f;rejected=false;try{model.run(image,bad);}catch(const std::exception&){rejected=true;}if(!rejected)throw std::runtime_error("invalid mask accepted");
 auto after=model.run(image,mask);double delta=0;for(size_t i=0;i<after.size();i++)delta=std::max(delta,std::abs(double(after[i])-result[i]));
 std::cout<<"repeat_max_difference "<<delta<<std::endl;if(delta>1e-5)throw std::runtime_error("nonrepeatable output");
 std::ofstream out(argv[5],std::ios::binary);out.write(reinterpret_cast<char*>(result.data()),result.size()*4);if(!out)throw std::runtime_error("output write failed");return 0;
 }catch(const std::exception&e){std::cerr<<e.what()<<std::endl;return 1;}}
