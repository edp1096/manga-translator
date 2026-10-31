#define STB_IMAGE_IMPLEMENTATION
#include "../../../native/common.hpp"
#include <cassert>
int main(){const auto file=fs::temp_directory_path()/"manga-ocr-position-budget-test.ppm";{std::ofstream f(file,std::ios::binary);f<<"P6\n16 48\n255\n";std::vector<char> pixels(16*48*3,char(255));f.write(pixels.data(),pixels.size());}
 std::vector<float> base(256*768);const auto normal=prepare(file,256,true,base);size_t cases=0;
 for(int n:{1,64,100,128,256,512}){const auto p=prepare(file,256,true,base,n);assert(p.cos.size()==size_t(256+n)*32&&p.sin.size()==p.cos.size());for(size_t i=0;i<std::min(p.cos.size(),normal.cos.size());i++){assert(p.cos[i]==normal.cos[i]&&p.sin[i]==normal.sin[i]);}for(auto v:p.cos)assert(std::isfinite(v));for(auto v:p.sin)assert(std::isfinite(v));const auto index=size_t(256+n-1)*32;assert(index+32==p.cos.size());cases++;}
 for(int n:{0,-1,4097}){bool threw=false;try{prepare(file,256,true,base,n);}catch(const std::exception&){threw=true;}assert(threw);cases++;}fs::remove(file);std::cout<<"PASS "<<cases<<" OCR position budget cases\n";}
