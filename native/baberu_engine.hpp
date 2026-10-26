#pragma once
#include "ort_engine.hpp"
inline std::vector<Coeff> baberu_cubic_weights(int in,int out){
 std::vector<Coeff> all;double scale=double(in)/out,filter=std::max(1.,scale),support=2*filter;
 for(int i=0;i<out;i++){
  double center=(i+.5)*scale;int first=std::max(0,int(center-support+.5)),last=std::min(in,int(center+support+.5));Coeff c{first,{}};double sum=0;
  for(int j=first;j<last;j++){double x=std::abs((j-center+.5)/filter),v=0;if(x<1)v=((1.5*x-2.5)*x)*x+1;else if(x<2)v=(((x-5)*x+8)*x-4)*-.5;c.w.push_back(v);sum+=v;}
  for(auto& v:c.w)v/=sum;all.push_back(std::move(c));
 }return all;
}
inline std::vector<uint8_t> baberu_cubic_rgb(const uint8_t* src,int w,int h){
 constexpr int n=224;auto cx=baberu_cubic_weights(w,n),cy=baberu_cubic_weights(h,n);std::vector<uint8_t> tmp(size_t(n)*h*3),out(n*n*3);
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
inline std::vector<float> baberu_pixels(const fs::path& path,const fs::path& dump){
 int w,h,c;std::ifstream file(path,std::ios::binary|std::ios::ate);require(bool(file),"Cannot open OCR crop");auto length=file.tellg();require(length>0&&length<=64*1024*1024,"Invalid OCR crop size");std::vector<uint8_t> encoded(static_cast<size_t>(length));file.seekg(0);file.read(reinterpret_cast<char*>(encoded.data()),encoded.size());require(bool(file),"Cannot read OCR crop");require(stbi_info_from_memory(encoded.data(),int(encoded.size()),&w,&h,&c)!=0&&w>0&&h>0&&int64_t(w)*h<=40000000,"Invalid OCR crop dimensions");uint8_t* raw=stbi_load_from_memory(encoded.data(),int(encoded.size()),&w,&h,&c,3);require(raw,"Cannot decode OCR crop");std::unique_ptr<uint8_t,void(*)(void*)> owner(raw,stbi_image_free);auto rgb=baberu_cubic_rgb(raw,w,h);std::vector<float> pixels(3*224*224);float mean[]={.485f,.456f,.406f},sd[]={.229f,.224f,.225f};
 for(int i=0;i<224*224;i++)for(int ch=0;ch<3;ch++)pixels[ch*224*224+i]=(float(rgb[i*3+ch])/255.f-mean[ch])/sd[ch];
 if(!dump.empty()){fs::create_directories(dump);dump_floats(dump/"pixels.f32",pixels);std::ofstream f(dump/"pixels.rgb",std::ios::binary);f.write(reinterpret_cast<const char*>(rgb.data()),rgb.size());}return pixels;
}
// Unicode L/N token IDs from the pinned Baberu vocabulary; excludes ー, ｰ, 〜 and ~.
inline const std::pair<int,int> baberu_content_ranges[]={{21,30},{38,63},{70,95},{108,108},{115,116},{118,118},{121,122},{124,124},{126,148},{150,180},{182,377},{389,546},{549,578},{634,664},{672,708},{720,729},{735,767},{769,769},{775,784},{788,835},{851,858},{860,869},{871,873},{876,891},{893,1109},{1130,1132},{1143,1143},{1146,1151},{1214,1221},{1267,1271},{1276,1278},{1299,1381},{1384,1471},{1474,1497},{1501,14100},{14102,14111},{14113,14145},{14166,14175},{14183,14207},{14211,14235},{14246,14247},{14249,14249},{14251,14251},{14254,14255},{14257,14257},{14260,14260},{14264,14264},{14266,14268},{14270,14276},{14278,14278},{14285,14285},{14288,14294},{14296,14298},{14300,14301},{14303,14303},{14305,14307},{14309,14310},{14312,14313},{14316,14316},{14318,14321},{14323,14327},{14329,14329},{14331,14331},{14333,14334},{14336,14337},{14339,14340},{14342,14342},{14344,14344},{14348,14349},{14351,14355},{14357,14357},{14359,14359},{14361,14362},{14365,14365},{14369,14370},{14372,14375},{14378,14380},{14384,14384},{14386,14388},{14390,14391},{14393,14394},{14396,14397},{14399,14401},{14403,14406},{14409,14410},{14412,14415},{14417,14417},{14420,14431},{14434,14436},{14438,14445},{14447,14454},{14456,14460},{14464,14467},{14470,14478},{14480,14484},{14487,14487},{14489,14491},{14493,14496},{14498,14504},{14506,14510},{14512,14513},{14516,14521},{14523,14523},{14526,14527},{14529,14534},{14536,14536},{14539,14541},{14543,14543},{14545,14548},{14550,14550},{14552,14559},{14561,14564},{14566,14566},{14568,14568},{14570,14579},{14582,14585},{14587,14594},{14596,14597},{14600,14600},{14602,14604},{14608,14629}};
inline Ort::SessionOptions baberu_options(int threads,OrtExecution execution,const char* stage){auto options=ort_options(threads,execution);if(std::getenv("MANGA_ORT_PROFILE"))options.EnableProfiling(fs::path(std::string("data/cache/baberu-")+stage).c_str());return options;}
struct BaberuEngine:Engine{
 Ort::Env env;Ort::Session vision,pre,step;std::set<int> content;
 std::vector<std::string> outputStrings,inputStrings;std::vector<const char*> outputs,inputs;
 BaberuEngine(const fs::path& dir,const std::string& tier,int threads,OrtExecution execution={}):Engine(dir/"tokenizer/vocab.json",256),env(private_ort_env("baberu-ocr")),vision(env,(dir/"onnx"/("vision_"+tier+".onnx")).c_str(),vision_options(threads,execution)),pre(env,(dir/"onnx/decoder_prefill_int8.onnx").c_str(),baberu_options(threads,{},"prefill")),step(env,(dir/"onnx/decoder_step_int8.onnx").c_str(),baberu_options(threads,{},"step")){
  require(tokenizer.pieces.size()==14630,"Unexpected Baberu vocabulary");
  for(auto range:baberu_content_ranges)for(int id=range.first;id<=range.second;id++)content.insert(id);
  outputStrings={"logits"};inputStrings={"input_ids","position_ids"};for(auto prefix:{"k","v"})for(int i=0;i<6;i++){outputStrings.push_back("present_"+std::string(prefix)+std::to_string(i));inputStrings.push_back("past_"+std::string(prefix)+std::to_string(i));}
  for(auto& s:outputStrings)outputs.push_back(s.c_str());for(auto& s:inputStrings)inputs.push_back(s.c_str());
 }
 static Ort::SessionOptions vision_options(int threads,OrtExecution execution){require(execution.backend=="cpu"||execution.backend=="cuda","Baberu supports CPU or CUDA vision, with a CPU decoder");return baberu_options(threads,execution,"vision");}
 std::string name()const override{return "baberu";}
 Result run(const fs::path& image,int maxTokens)override{
  Result r;auto begin=Clock::now(),phase=begin;auto pixels=baberu_pixels(image,dump);r.prepare_ms=ms(phase);phase=Clock::now();
  auto pixel=tensor(pixels,{1,3,224,224});const char* vn[]={"pixel_values"};const char* vo[]={"vision_embeds"};auto visual=vision.Run(Ort::RunOptions{nullptr},vn,&pixel,1,vo,1);r.encoder_ms=ms(phase);
  if(!dump.empty()){auto n=visual[0].GetTensorTypeAndShapeInfo().GetElementCount();auto p=visual[0].GetTensorData<float>();dump_floats(dump/"vision.f32",{p,p+n});}
  int64_t token=1,pos=257;phase=Clock::now();std::vector<Ort::Value> pi;pi.push_back(std::move(visual[0]));pi.push_back(tensor(&token,1,{1,1}));const char* pn[]={"vision_embeds","input_ids"};auto out=pre.Run(Ort::RunOptions{nullptr},pn,pi.data(),2,outputs.data(),outputs.size());r.prefill_ms=ms(phase);
  std::set<int64_t> seen{1};phase=Clock::now();
  for(int i=0;i<maxTokens;i++){
   size_t vocab=tokenizer.pieces.size(),count=out[0].GetTensorTypeAndShapeInfo().GetElementCount();require(count>=vocab,"Bad logits shape");auto p=out[0].GetTensorData<float>()+count-vocab;std::vector<double> logits(p,p+vocab);
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
