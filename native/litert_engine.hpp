#pragma once
#include "common.hpp"
#include "litert/c/litert_environment.h"
#include "litert/c/litert_model.h"
#include "litert/c/litert_compiled_model.h"
#include "litert/c/litert_options.h"
#include "litert/c/litert_opaque_options.h"
#include "litert/c/litert_tensor_buffer.h"
#include "litert/c/litert_tensor_buffer_requirements.h"
#include "litert_loader.hpp"
#define LRT_CHECK(call) do{auto s=(call);if(s!=kLiteRtStatusOk)throw std::runtime_error(std::string(#call)+" status="+std::to_string(s));}while(0)
struct LiteGraph{
 LiteRtEnvironment env=nullptr;LiteRtModel model=nullptr;LiteRtOptions options=nullptr;LiteRtCompiledModel compiled=nullptr;
 std::vector<LiteRtTensorBuffer> in,out;std::vector<size_t> inbytes,outbytes;
 LiteGraph(const fs::path& path,int threads){
  try{
   LiteRtEnvOption cpu_option{};cpu_option.tag=kLiteRtEnvOptionTagAutoRegisterAccelerators;cpu_option.value.type=kLiteRtAnyTypeInt;cpu_option.value.int_value=kLiteRtHwAcceleratorCpu;LRT_CHECK(LiteRtCreateEnvironment(1,&cpu_option,&env));LRT_CHECK(LiteRtCreateModelFromFile(env,path.u8string().c_str(),&model));LRT_CHECK(LiteRtCreateOptions(&options));LRT_CHECK(LiteRtSetOptionsHardwareAccelerators(options,kLiteRtHwAcceleratorCpu));
   // Exact serialization used by the SDK's LrtGetOpaqueCpuOptionsData helper.
   std::string toml="kernel_mode = \"delegate\"\nnum_threads = "+std::to_string(threads)+"\n";char* payload=new char[toml.size()+1];std::memcpy(payload,toml.c_str(),toml.size()+1);LiteRtOpaqueOptions opaque=nullptr;auto s=LiteRtCreateOpaqueOptions("xnnpack",payload,[](void* p){delete[] static_cast<char*>(p);},&opaque);if(s!=kLiteRtStatusOk){delete[] payload;throw std::runtime_error("CPU options creation failed");}LRT_CHECK(LiteRtAddOpaqueOptions(options,opaque));
   LRT_CHECK(LiteRtCreateCompiledModel(env,model,options,&compiled));LiteRtSignature sig;LRT_CHECK(LiteRtGetModelSignature(model,0,&sig));
   for(bool output:{false,true}){LiteRtParamIndex count;if(output)LRT_CHECK(LiteRtGetNumSignatureOutputs(sig,&count));else LRT_CHECK(LiteRtGetNumSignatureInputs(sig,&count));
    for(LiteRtParamIndex i=0;i<count;++i){LiteRtTensor tensor;LiteRtRankedTensorType type;LiteRtTensorBufferRequirements req;LiteRtTensorBuffer buffer;
     if(output){LRT_CHECK(LiteRtGetSignatureOutputTensorByIndex(sig,i,&tensor));LRT_CHECK(LiteRtGetCompiledModelOutputBufferRequirements(compiled,0,i,&req));}else{LRT_CHECK(LiteRtGetSignatureInputTensorByIndex(sig,i,&tensor));LRT_CHECK(LiteRtGetCompiledModelInputBufferRequirements(compiled,0,i,&req));}
     LRT_CHECK(LiteRtGetRankedTensorType(tensor,&type));for(unsigned d=0;d<type.layout.rank;++d)require(type.layout.dimensions[d]>=0,"Unexpected dynamic TFLite input");LRT_CHECK(LiteRtCreateManagedTensorBufferFromRequirements(env,&type,req,&buffer));(output?out:in).push_back(buffer);size_t bytes;LRT_CHECK(LiteRtGetTensorBufferPackedSize(buffer,&bytes));(output?outbytes:inbytes).push_back(bytes);
    }
   }
  }catch(...){clear();throw;}
 }
 LiteGraph(const LiteGraph&)=delete;LiteGraph& operator=(const LiteGraph&)=delete;
 void clear(){for(auto b:in)LiteRtDestroyTensorBuffer(b);for(auto b:out)LiteRtDestroyTensorBuffer(b);in.clear();out.clear();if(compiled)LiteRtDestroyCompiledModel(compiled);compiled=nullptr;if(options)LiteRtDestroyOptions(options);options=nullptr;if(model)LiteRtDestroyModel(model);model=nullptr;if(env)LiteRtDestroyEnvironment(env);env=nullptr;}
 ~LiteGraph(){clear();}
 template<class T>void set(size_t index,const T* data,size_t count){require(index<in.size()&&inbytes[index]==count*sizeof(T),"Input byte size mismatch at "+std::to_string(index));void* p;LRT_CHECK(LiteRtLockTensorBuffer(in[index],&p,kLiteRtTensorBufferLockModeWrite));std::memcpy(p,data,count*sizeof(T));LRT_CHECK(LiteRtUnlockTensorBuffer(in[index]));}
 template<class T>void set(size_t i,const std::vector<T>& v){set(i,v.data(),v.size());}
 std::vector<float> get(size_t index){require(index<out.size(),"Output index");std::vector<float> data(outbytes[index]/4);void* p;LRT_CHECK(LiteRtLockTensorBuffer(out[index],&p,kLiteRtTensorBufferLockModeRead));std::memcpy(data.data(),p,outbytes[index]);LRT_CHECK(LiteRtUnlockTensorBuffer(out[index]));return data;}
 int64_t best(){require(outbytes[0]==16004*4,"Unexpected logits size");void* p;LRT_CHECK(LiteRtLockTensorBuffer(out[0],&p,kLiteRtTensorBufferLockModeRead));int64_t id;try{id=argmax(static_cast<float*>(p),16004);}catch(...){LiteRtUnlockTensorBuffer(out[0]);throw;}LRT_CHECK(LiteRtUnlockTensorBuffer(out[0]));return id;}
 void run(){LRT_CHECK(LiteRtRunCompiledModel(compiled,0,in.size(),in.data(),out.size(),out.data()));}
 void receive(size_t input,LiteGraph& src,size_t output,bool exchange){require(inbytes.at(input)==src.outbytes.at(output),"Cache buffer mismatch");if(exchange)std::swap(in.at(input),src.out.at(output));else{auto data=src.get(output);set(input,data);}}
};
inline fs::path matching_file(const fs::path& dir,const std::string& prefix){std::vector<fs::path> found;for(const auto& f:fs::directory_iterator(dir))if(f.path().filename().string().rfind(prefix,0)==0&&f.path().extension()==".tflite")found.push_back(f.path());require(found.size()==1,"Expected exactly one "+prefix+" .tflite file");return found[0];}
struct LiteEngine:Engine{
 std::vector<float> base;LiteGraph enc,pre,dec;bool exchange;
 LiteEngine(const fs::path& dir,int threads,bool use_exchange):Engine(dir/"tokenizer.json",256),base(read_positions(dir/"position_base.npy")),enc(matching_file(dir,"hayai_encoder_"),threads),pre(matching_file(dir,"hayai_decoder_prefill_"),threads),dec(matching_file(dir,"hayai_decoder_decode_"),threads),exchange(use_exchange){require(enc.in.size()==3&&enc.out.size()==1&&pre.in.size()==5&&pre.out.size()==25&&dec.in.size()==29&&dec.out.size()==25,"Unexpected TFLite contract");}
 std::string name()const override{return "litert";}
 Result run(const fs::path& image,int max_tokens)override{
  Result result;auto total=Clock::now(),phase=total;Prepared p=prepare(image,256,true,base);result.prepare_ms=ms(phase);result.ph=p.ph;result.pw=p.pw;result.patches=p.patches;dump_prepared(dump,p);
  phase=Clock::now();enc.set(0,p.pixels);enc.set(1,p.mask);enc.set(2,p.pos);enc.run();result.encoder_ms=ms(phase);if(!dump.empty())dump_floats(dump/"vision.f32",enc.get(0));
  phase=Clock::now();pre.receive(0,enc,0,exchange);int64_t bos=tokenizer.bos;pre.set(1,&bos,1);pre.set(2,p.cos);pre.set(3,p.sin);pre.set(4,block_mask(256,1,320));pre.run();int64_t next=pre.best();result.prefill_ms=ms(phase);if(!dump.empty())dump_floats(dump/"first_logits.f32",pre.get(0));
  phase=Clock::now();if(tokenizer.stop(next))result.stopped=true;else result.ids.push_back(next);
  if(!result.stopped&&max_tokens>1)for(size_t i=0;i<24;++i)dec.receive(5+i,pre,1+i,exchange);
  while(!result.stopped&&int(result.ids.size())<max_tokens){int64_t pos=256+result.ids.size();require(pos<320,"KV cache capacity exceeded");dec.set(0,&next,1);dec.set(1,p.cos.data()+pos*32,32);dec.set(2,p.sin.data()+pos*32,32);std::vector<float> mask(320,-1e9f);std::fill_n(mask.begin(),pos+1,0.f);dec.set(3,mask);dec.set(4,&pos,1);dec.run();next=dec.best();if(tokenizer.stop(next)){result.stopped=true;break;}result.ids.push_back(next);if(int(result.ids.size())<max_tokens)for(size_t i=0;i<24;++i)dec.receive(5+i,dec,1+i,exchange);}
  result.decode_ms=ms(phase);result.total_ms=ms(total);return result;
 }
};
