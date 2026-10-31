#pragma once
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <numeric>
#include <set>
#include <stdexcept>
#include <string>
#include <vector>
#include "vendor/json.hpp"
#include "vendor/stb_image.h"
using json=nlohmann::json;namespace fs=std::filesystem;using Clock=std::chrono::steady_clock;
inline double ms(Clock::time_point t){return std::chrono::duration<double,std::milli>(Clock::now()-t).count();}
inline void require(bool ok,const std::string& what){if(!ok)throw std::runtime_error(what);}
inline json read_json(const fs::path& p){std::ifstream f(p);require(bool(f),"Cannot open "+p.string());return json::parse(f);}
inline void dump_floats(const fs::path& p,const std::vector<float>& v){std::ofstream f(p,std::ios::binary);f.write(reinterpret_cast<const char*>(v.data()),v.size()*4);require(bool(f),"Cannot write "+p.string());}
struct Coeff{int first;std::vector<double> w;};
inline std::vector<Coeff> weights(int in,int out){
 std::vector<Coeff> result;double scale=double(in)/out,filter=std::max(1.,scale);
 for(int x=0;x<out;++x){double center=(x+0.5)*scale;int lo=std::max(0,int(center-filter+0.5)),hi=std::min(in,int(center+filter+0.5));Coeff c{lo,{}};double sum=0;
  for(int j=lo;j<hi;++j){double w=std::max(0.,1.-std::abs((j-center+0.5)/filter));c.w.push_back(w);sum+=w;}require(sum>0,"Empty resize filter");for(auto& w:c.w)w/=sum;result.push_back(std::move(c));}return result;
}
// Pillow-compatible separable bilinear filtering, including downsampling antialias.
// RGB8 rounds each pass with Pillow's 22-bit coefficient precision.
inline std::vector<uint8_t> resize_rgb(const uint8_t* src,int w,int h,int nw,int nh){
 auto cx=weights(w,nw),cy=weights(h,nh);std::vector<uint8_t> tmp(size_t(nw)*h*3),out(size_t(nw)*nh*3);
 for(int y=0;y<h;++y)for(int x=0;x<nw;++x)for(int c=0;c<3;++c){int64_t s=1<<21;for(size_t k=0;k<cx[x].w.size();++k)s+=int64_t(src[(size_t(y)*w+cx[x].first+k)*3+c])*int64_t(cx[x].w[k]*(1<<22)+0.5);tmp[(size_t(y)*nw+x)*3+c]=uint8_t(std::clamp<int64_t>(s>>22,0,255));}
 for(int y=0;y<nh;++y)for(int x=0;x<nw;++x)for(int c=0;c<3;++c){int64_t s=1<<21;for(size_t k=0;k<cy[y].w.size();++k)s+=int64_t(tmp[((size_t(cy[y].first)+k)*nw+x)*3+c])*int64_t(cy[y].w[k]*(1<<22)+0.5);out[(size_t(y)*nw+x)*3+c]=uint8_t(std::clamp<int64_t>(s>>22,0,255));}
 return out;
}
inline std::vector<float> resize_positions(const std::vector<float>& src,int nw,int nh){
 require(src.size()==16*16*768,"Invalid position table size");auto cx=weights(16,nw),cy=weights(16,nh);std::vector<float> tmp(size_t(nw)*16*768),out(size_t(nw)*nh*768);
 for(int y=0;y<16;++y)for(int x=0;x<nw;++x)for(int c=0;c<768;++c){double s=0;for(size_t k=0;k<cx[x].w.size();++k)s+=double(src[(size_t(y)*16+cx[x].first+k)*768+c])*cx[x].w[k];tmp[(size_t(y)*nw+x)*768+c]=float(s);}
 for(int y=0;y<nh;++y)for(int x=0;x<nw;++x)for(int c=0;c<768;++c){double s=0;for(size_t k=0;k<cy[y].w.size();++k)s+=double(tmp[((size_t(cy[y].first)+k)*nw+x)*768+c])*cy[y].w[k];out[(size_t(y)*nw+x)*768+c]=float(s);}
 return out;
}
inline std::vector<float> read_positions(const fs::path& path){
 std::ifstream f(path,std::ios::binary);char magic[8];f.read(magic,8);require(f&&std::memcmp(magic,"\x93NUMPY",6)==0,"Invalid NPY file");unsigned len=0;
 if(magic[6]==1){unsigned char b[2];f.read(reinterpret_cast<char*>(b),2);len=b[0]+(unsigned(b[1])<<8);}else if(magic[6]==2){unsigned char b[4];f.read(reinterpret_cast<char*>(b),4);len=b[0]+(unsigned(b[1])<<8)+(unsigned(b[2])<<16)+(unsigned(b[3])<<24);}else throw std::runtime_error("Unsupported NPY version");
 require(len<65536,"Invalid NPY header size");std::string header(len,' ');f.read(header.data(),len);require(header.find("'<f4'")!=std::string::npos&&header.find("False")!=std::string::npos,"Need little-endian contiguous float32 positions");std::vector<float> out(256*768);f.read(reinterpret_cast<char*>(out.data()),out.size()*4);require(f&&f.peek()==std::char_traits<char>::eof(),"Unexpected position NPY payload");return out;
}
struct Prepared{int ph,pw,patches;std::vector<float> pixels,pos,cos,sin;std::vector<int64_t> mask;};
inline std::pair<std::vector<float>,std::vector<float>> rope(int ph,int pw,int vision,int text){
 std::vector<float> c(size_t(vision+text)*32,1),s(c.size(),0);
 for(int i=0;i<ph*pw+text;++i){bool istext=i>=ph*pw;int index=istext?vision+i-ph*pw:i;float y=istext?float(i-ph*pw):float(i/pw),x=istext?float(i-ph*pw):float(i%pw);
  for(int j=0;j<16;++j){float freq=1.f/std::pow(10000.f,float(j)/16.f);c[index*32+j]=std::cos(y*freq);s[index*32+j]=std::sin(y*freq);c[index*32+16+j]=std::cos(x*freq);s[index*32+16+j]=std::sin(x*freq);}}
 return {std::move(c),std::move(s)};
}
inline Prepared prepare(const fs::path& path,int budget,bool padded,const std::vector<float>& base,int text_budget=64){
 require(text_budget>0&&text_budget<=4096,"Invalid OCR token budget");
 int w,h,channels;std::ifstream image_file(path,std::ios::binary|std::ios::ate);require(bool(image_file),"Cannot open image "+path.string());auto image_size=image_file.tellg();require(image_size>0&&image_size<=64*1024*1024,"Image exceeds file-size limit or is empty");std::vector<uint8_t> encoded(static_cast<size_t>(image_size));image_file.seekg(0);image_file.read(reinterpret_cast<char*>(encoded.data()),encoded.size());require(bool(image_file),"Image read failed");require(stbi_info_from_memory(encoded.data(),int(encoded.size()),&w,&h,&channels)!=0,"Unsupported or invalid image");require(w>0&&h>0&&int64_t(w)*h<=40000000,"Image exceeds pixel limit");uint8_t* raw=stbi_load_from_memory(encoded.data(),int(encoded.size()),&w,&h,&channels,3);require(raw!=nullptr,"Image decode failed "+path.string());std::unique_ptr<uint8_t,void(*)(void*)> owned(raw,stbi_image_free);
 constexpr double eps=1e-5;double lo=eps/10,hi=100;auto scaled=[](int size,double scale){return std::max(16,int(std::ceil(size*scale/16))*16);};
 while(hi-lo>=eps){double mid=(lo+hi)/2;if(int64_t(scaled(w,mid)/16)*(scaled(h,mid)/16)<=budget)lo=mid;else hi=mid;}
 int nw=scaled(w,lo),nh=scaled(h,lo);Prepared p;p.ph=nh/16;p.pw=nw/16;p.patches=p.ph*p.pw;require(p.patches<=budget,"Bad patch budget");auto rgb=resize_rgb(raw,w,h,nw,nh);int count=padded?budget:p.patches;p.pixels.assign(size_t(count)*768,0);p.mask.assign(count,0);
 for(int py=0;py<p.ph;++py)for(int px=0;px<p.pw;++px){int i=py*p.pw+px;p.mask[i]=1;for(int dy=0;dy<16;++dy)for(int dx=0;dx<16;++dx)for(int c=0;c<3;++c){int q=(dy*16+dx)*3+c;float v=float(rgb[(size_t(py*16+dy)*nw+px*16+dx)*3+c])/255.f;p.pixels[size_t(i)*768+q]=(v-0.5f)/0.5f;}}
 if(padded){p.pos=resize_positions(base,p.pw,p.ph);p.pos.resize(size_t(count)*768);for(int i=p.patches;i<count;++i)std::copy_n(p.pos.begin(),768,p.pos.begin()+size_t(i)*768);auto r=rope(p.ph,p.pw,count,text_budget);p.cos=std::move(r.first);p.sin=std::move(r.second);}return p;
}
inline std::vector<float> block_mask(int vision,int text,int full=0){int len=full?full:vision+text;std::vector<float> mask(size_t(len)*len,-1e9f);for(int row=0;row<len;++row){int visible=row<vision?vision:std::min(row+1,vision+text);std::fill_n(mask.begin()+size_t(row)*len,visible,0.f);}return mask;}
inline std::vector<float> unshuffle(const float* features,int ph,int pw){int oh=(ph+1)/2,ow=(pw+1)/2;std::vector<float> result(size_t(oh)*ow*3072);for(int y=0;y<oh;++y)for(int x=0;x<ow;++x)for(int c=0;c<768;++c)for(int dy=0;dy<2;++dy)for(int dx=0;dx<2;++dx){int sy=std::min(2*y+dy,ph-1),sx=std::min(2*x+dx,pw-1);result[(size_t(y)*ow+x)*3072+c*4+dy*2+dx]=features[(size_t(sy)*pw+sx)*768+c];}return result;}
inline std::vector<uint32_t> codepoints(const std::string& text){std::vector<uint32_t> out;for(size_t i=0;i<text.size();){unsigned char b=text[i++];uint32_t cp=b;int n=0;if(b>=0xf0){cp=b&7;n=3;}else if(b>=0xe0){cp=b&15;n=2;}else if(b>=0xc0){cp=b&31;n=1;}else require(b<128,"Invalid UTF-8 token");for(int k=0;k<n;++k){require(i<text.size()&&(uint8_t(text[i])&0xc0)==0x80,"Invalid UTF-8 token");cp=(cp<<6)|(uint8_t(text[i++])&63);}out.push_back(cp);}return out;}
struct Tokenizer{
 int bos,eos,pad;std::vector<std::string> pieces;std::set<int> special;
 explicit Tokenizer(const fs::path& path){auto d=read_json(path);if(d.is_array()){bos=1;eos=2;pad=0;special={0,1,2,3};pieces.resize(d.size()+4);for(size_t i=0;i<d.size();++i)pieces[i+4]=d[i].get<std::string>();return;}auto vocab=d.at("model").at("vocab");for(const auto& t:d.at("added_tokens"))vocab[t.at("content").get<std::string>()]=t.at("id");require(d.at("decoder").at("type")=="ByteLevel","Expected ByteLevel decoder");bos=vocab.at("<bos>");eos=vocab.at("<eos>");pad=vocab.at("<pad>");for(auto& t:d.at("added_tokens"))if(t.at("special").get<bool>())special.insert(t.at("id").get<int>());
  std::map<uint32_t,uint8_t> reverse;int next=256;for(int b=0;b<256;++b){bool direct=(b>=33&&b<=126)||(b>=161&&b<=172)||(b>=174);reverse[direct?uint32_t(b):uint32_t(next++)]=uint8_t(b);}pieces.resize(vocab.size());
  for(auto it=vocab.begin();it!=vocab.end();++it){int id=it.value();require(id>=0&&id<int(pieces.size()),"Non-dense vocab");if(special.count(id))continue;for(auto cp:codepoints(it.key())){auto b=reverse.find(cp);require(b!=reverse.end(),"Invalid byte-level vocabulary");pieces[id].push_back(char(b->second));}}}
 std::string decode(const std::vector<int64_t>& ids)const{std::string text;for(auto id:ids){require(id>=0&&id<int64_t(pieces.size()),"Token id out of bounds");text+=pieces[id];}return text;}
 bool stop(int64_t id)const{return id==eos||id==pad;}
};
inline int64_t argmax(const float* p,size_t n){require(n>0,"Empty logits");size_t best=0;for(size_t i=0;i<n;++i){require(std::isfinite(p[i]),"Nonfinite logits");if(p[i]>p[best])best=i;}return int64_t(best);}
struct Result{std::vector<int64_t> ids;double prepare_ms=0,encoder_ms=0,prefill_ms=0,decode_ms=0,total_ms=0;int patches=0,ph=0,pw=0;bool stopped=false;};
struct Engine{Tokenizer tokenizer;int budget;fs::path dump;explicit Engine(const fs::path& tok,int b):tokenizer(tok),budget(b){}virtual ~Engine()=default;virtual Result run(const fs::path&,int)=0;virtual std::string name()const=0;};
inline void dump_prepared(const fs::path& dir,const Prepared& p){if(dir.empty())return;fs::create_directories(dir);dump_floats(dir/"pixels.f32",p.pixels);dump_floats(dir/"positions.f32",p.pos);dump_floats(dir/"cos.f32",p.cos);dump_floats(dir/"sin.f32",p.sin);std::ofstream(dir/"shape.json")<<json{{"ph",p.ph},{"pw",p.pw},{"patches",p.patches}}.dump(2);}
