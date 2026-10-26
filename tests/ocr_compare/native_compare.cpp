// Standalone evaluation harness; not linked into the production application.
#define STB_IMAGE_IMPLEMENTATION
#include "../../native/ort_kv_engine.hpp"
#include "../../native/litert_engine.hpp"
#include <sys/resource.h>

static std::vector<Coeff> cubic_weights(int in,int out){
 std::vector<Coeff> all;double scale=double(in)/out,filter=std::max(1.,scale),support=2*filter;
 for(int i=0;i<out;i++){
  double center=(i+.5)*scale;int first=std::max(0,int(center-support+.5)),last=std::min(in,int(center+support+.5));Coeff c{first,{}};double sum=0;
  for(int j=first;j<last;j++){double x=std::abs((j-center+.5)/filter),v=0;if(x<1)v=((1.5*x-2.5)*x)*x+1;else if(x<2)v=(((x-5)*x+8)*x-4)*-.5;c.w.push_back(v);sum+=v;}
  for(auto& v:c.w)v/=sum;all.push_back(std::move(c));
 }return all;
}
static std::vector<uint8_t> cubic_rgb(const uint8_t* src,int w,int h){
 constexpr int n=224;auto cx=cubic_weights(w,n),cy=cubic_weights(h,n);std::vector<uint8_t> tmp(size_t(n)*h*3),out(n*n*3);
 auto fixed=[](double x){return int64_t(x*(1<<22)+(x<0?-.5:.5));};
 // Pillow 12.x chooses the first pass to avoid an unnecessarily large intermediate.
 if(h-n>0 && h-n>2*(w-n)){
  tmp.resize(size_t(w)*n*3);
  for(int y=0;y<n;y++)for(int x=0;x<w;x++)for(int c=0;c<3;c++){int64_t s=1<<21;for(size_t k=0;k<cy[y].w.size();k++)s+=int64_t(src[((size_t(cy[y].first)+k)*w+x)*3+c])*fixed(cy[y].w[k]);tmp[(size_t(y)*w+x)*3+c]=uint8_t(std::clamp<int64_t>(s>>22,0,255));}
  for(int y=0;y<n;y++)for(int x=0;x<n;x++)for(int c=0;c<3;c++){int64_t s=1<<21;for(size_t k=0;k<cx[x].w.size();k++)s+=int64_t(tmp[(size_t(y)*w+cx[x].first+k)*3+c])*fixed(cx[x].w[k]);out[(size_t(y)*n+x)*3+c]=uint8_t(std::clamp<int64_t>(s>>22,0,255));}return out;
 }
 for(int y=0;y<h;y++)for(int x=0;x<n;x++)for(int c=0;c<3;c++){int64_t s=1<<21;for(size_t k=0;k<cx[x].w.size();k++)s+=int64_t(src[(size_t(y)*w+cx[x].first+k)*3+c])*fixed(cx[x].w[k]);tmp[(size_t(y)*n+x)*3+c]=uint8_t(std::clamp<int64_t>(s>>22,0,255));}
 for(int y=0;y<n;y++)for(int x=0;x<n;x++)for(int c=0;c<3;c++){int64_t s=1<<21;for(size_t k=0;k<cy[y].w.size();k++)s+=int64_t(tmp[((size_t(cy[y].first)+k)*n+x)*3+c])*fixed(cy[y].w[k]);out[(size_t(y)*n+x)*3+c]=uint8_t(std::clamp<int64_t>(s>>22,0,255));}return out;
}
static std::vector<float> baberu_pixels(const fs::path& path,const fs::path& dump){
 int w,h,c;uint8_t* raw=stbi_load(path.c_str(),&w,&h,&c,3);require(raw,"Cannot decode image");std::unique_ptr<uint8_t,void(*)(void*)> owner(raw,stbi_image_free);auto rgb=cubic_rgb(raw,w,h);std::vector<float> pixels(3*224*224);float mean[]={.485f,.456f,.406f},sd[]={.229f,.224f,.225f};
 for(int i=0;i<224*224;i++)for(int ch=0;ch<3;ch++)pixels[ch*224*224+i]=(float(rgb[i*3+ch])/255.f-mean[ch])/sd[ch];
 if(!dump.empty()){fs::create_directories(dump);dump_floats(dump/"pixels.f32",pixels);std::ofstream f(dump/"pixels.rgb",std::ios::binary);f.write(reinterpret_cast<const char*>(rgb.data()),rgb.size());}return pixels;
}
static Ort::SessionOptions evaluation_options(OrtExecution execution,const std::string& stage){
 if(execution.backend=="cuda-vision")execution.backend=stage=="vision"?"cuda":"cpu";
 if(execution.backend=="cuda-decoder")execution.backend=stage=="vision"?"cpu":"cuda";
 auto o=ort_options(4,execution);
 if(std::getenv("MANGA_ORT_PROFILE"))o.EnableProfiling(fs::path("data/cache/ocr-"+stage).c_str());return o;
}
#include "hayai_split.hpp"
struct Baberu{
 Ort::Env env;Ort::SessionOptions options;Ort::Session vision,pre,step;std::vector<std::string> chars;std::set<int> content;
 std::vector<std::string> outputStrings,inputStrings;std::vector<const char*> outputs,inputs;fs::path dump;
 Baberu(const fs::path& dir,const std::string& tier,OrtExecution execution):env(private_ort_env("baberu-evaluation")),options(evaluation_options(execution,"unused")),vision(env,(dir/"onnx"/("vision_"+tier+".onnx")).c_str(),evaluation_options(execution,"vision")),pre(env,(dir/"onnx/decoder_prefill_int8.onnx").c_str(),evaluation_options(execution,"prefill")),step(env,(dir/"onnx/decoder_step_int8.onnx").c_str(),evaluation_options(execution,"step")){
  chars=read_json(dir/"tokenizer/vocab.json").get<std::vector<std::string>>();content=read_json(dir/"content_ids.json").get<std::set<int>>();
  outputStrings={"logits"};inputStrings={"input_ids","position_ids"};for(auto prefix:{"k","v"})for(int i=0;i<6;i++){outputStrings.push_back("present_"+std::string(prefix)+std::to_string(i));inputStrings.push_back("past_"+std::string(prefix)+std::to_string(i));}
  for(auto& s:outputStrings)outputs.push_back(s.c_str());for(auto& s:inputStrings)inputs.push_back(s.c_str());
 }
 std::string decode(const std::vector<int64_t>& ids){std::string s;for(auto id:ids)if(id>=4)s+=chars.at(id-4);return s;}
 Result run(const fs::path& image,int maxTokens){
  Result r;auto begin=Clock::now(),phase=begin;auto pixels=baberu_pixels(image,dump);r.prepare_ms=ms(phase);phase=Clock::now();
  auto pixel=tensor(pixels,{1,3,224,224});const char* vn[]={"pixel_values"};const char* vo[]={"vision_embeds"};auto visual=vision.Run(Ort::RunOptions{nullptr},vn,&pixel,1,vo,1);r.encoder_ms=ms(phase);
  if(!dump.empty()){auto n=visual[0].GetTensorTypeAndShapeInfo().GetElementCount();auto p=visual[0].GetTensorData<float>();dump_floats(dump/"vision.f32",{p,p+n});}
  int64_t token=1,pos=257;phase=Clock::now();std::vector<Ort::Value> pi;pi.push_back(std::move(visual[0]));pi.push_back(tensor(&token,1,{1,1}));const char* pn[]={"vision_embeds","input_ids"};auto out=pre.Run(Ort::RunOptions{nullptr},pn,pi.data(),2,outputs.data(),outputs.size());r.prefill_ms=ms(phase);
  std::set<int64_t> seen{1};phase=Clock::now();
  for(int i=0;i<maxTokens;i++){
   size_t vocab=chars.size()+4,count=out[0].GetTensorTypeAndShapeInfo().GetElementCount();require(count>=vocab,"Bad logits shape");auto p=out[0].GetTensorData<float>()+count-vocab;std::vector<double> logits(p,p+vocab);
   if(!dump.empty()&&i==0)dump_floats(dump/"first_logits.f32",{p,p+vocab});
   for(auto id:seen)logits[id]=logits[id]<0?logits[id]*1.2:logits[id]/1.2;
   int last=r.ids.empty()?0:int(r.ids.back()),cap=content.count(last)?12:last>3?16:0,run=0;
   if(cap){for(auto j=r.ids.rbegin();j!=r.ids.rend()&&*j==last;j++)run++;if(run>=cap)logits[last]=-std::numeric_limits<double>::infinity();}
   token=std::max_element(logits.begin(),logits.end())-logits.begin();if(token==2){r.stopped=true;break;}r.ids.push_back(token);seen.insert(token);if(int(r.ids.size())>=maxTokens)break;
   std::vector<Ort::Value> si;si.push_back(tensor(&token,1,{1,1}));si.push_back(tensor(&pos,1,{1,1}));for(size_t j=1;j<out.size();j++)si.push_back(std::move(out[j]));out=step.Run(Ort::RunOptions{nullptr},inputs.data(),si.data(),si.size(),outputs.data(),outputs.size());pos++;
  }
  r.decode_ms=ms(phase);r.total_ms=ms(begin);return r;
 }
};
int main(int argc,char** argv){try{
 require(argc>=7,"native_compare MODE MODEL EVAL OUTPUT BACKEND PASSES [DUMP]");std::string mode=argv[1],backend=argv[5];fs::path model=argv[2],eval=argv[3],output=argv[4],dump=argc>7?argv[7]:"";int passes=std::stoi(argv[6]);OrtExecution execution{backend,0};
 auto samples=read_json(eval/"samples.json");std::unique_ptr<Baberu> baberu;std::unique_ptr<Engine> hayai;auto load=Clock::now();
 if(mode.rfind("baberu-",0)==0)baberu=std::make_unique<Baberu>(model,mode.substr(7),execution);
 else if(mode=="hayai-fp32")hayai=std::make_unique<HayaiSplitEngine>(model,4,false,false,execution);
 else if(mode=="hayai-int8"){require(backend=="cpu","LiteRT is CPU only");require(std::getenv("LITERT_LIBRARY"),"Missing LITERT_LIBRARY");manga_litert::library_path=std::getenv("LITERT_LIBRARY");hayai=std::make_unique<LiteEngine>(model,4,true);}else throw std::runtime_error("Unknown mode");
 json report={{"mode",mode},{"backend",backend},{"threads",4},{"onnxruntime",OrtGetApiBase()->GetVersionString()},{"max_new_tokens",baberu?256:64},{"load_ms",ms(load)},{"samples",json::array()},{"passes",passes}};
 auto infer=[&](const fs::path& p){return baberu?baberu->run(p,256):hayai->run(p,64);};
 auto warm=infer(eval/samples[0]["file"].get<std::string>());report["warmup_ms"]=warm.total_ms;
 for(int pass=0;pass<passes;pass++)for(size_t k=0;k<samples.size();k++){
  auto sample=samples[pass%2?samples.size()-1-k:k];auto id=sample["id"].get<std::string>();fs::path d=dump.empty()?fs::path{}:dump/id;if(baberu)baberu->dump=d;else hayai->dump=d;
  auto r=infer(eval/sample["file"].get<std::string>());std::string text=baberu?baberu->decode(r.ids):hayai->tokenizer.decode(r.ids);
  report["samples"].push_back({{"id",id},{"language",sample["language"]},{"truth",sample["truth"]},{"prediction",text},{"pass",pass},{"ids",r.ids},{"stopped",r.stopped},{"prepare_ms",r.prepare_ms},{"vision_ms",r.encoder_ms},{"prefill_ms",r.prefill_ms},{"decode_ms",r.decode_ms},{"total_ms",r.total_ms}});std::cout<<mode<<" "<<pass<<" "<<id<<" "<<r.total_ms<<"ms "<<text<<std::endl;
 }
 rusage usage{};getrusage(RUSAGE_SELF,&usage);report["max_rss_kib"]=usage.ru_maxrss;std::ofstream(output)<<report.dump(2)<<"\n";
 }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}}
