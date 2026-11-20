#pragma once
#include "hayai_tensorrt.hpp"
namespace hayai_trt {
struct V21PageOcr : Engine {
 Logger logger;
 std::unique_ptr<IRuntime> runtime;
 Stream stream;
 Session enc,pre,dec;
 std::vector<float> base,probs;
 CudaBuffer features,logits,k[2],v[2];
 V21PageOcr(const fs::path& dir,const fs::path& plans)
  :Engine(dir/"tokenizer.json",256),runtime(createInferRuntime(logger)),
   enc(checked_runtime(),plans/"encoder.plan"),pre(*runtime,plans/"prefill.plan"),dec(*runtime,plans/"decode.plan"),
   base(read_positions(dir/"position_base.npy")),probs(16004){}
 IRuntime& checked_runtime() {
  require(bool(runtime),"Cannot initialize TensorRT runtime");
  return *runtime;
 }
 std::string name() const override{return "tensorrt-v21";}
 Result run(const fs::path& image,int limit) override {
  require(limit>=1&&limit<=256,"v21 OCR token limit");
  const auto start=Clock::now();Result r;auto p=prepare(image,256,true,base,limit);
  r.patches=p.patches;r.ph=p.ph;r.pw=p.pw;
  auto s=stream.value;
  enc.bind_cpu("pixel_values",p.pixels.data(),p.pixels.size(),Dims3{1,256,768},s);
  enc.bind_cpu("pos_embeds",p.pos.data(),p.pos.size(),Dims3{1,256,768},s);
  enc.bind_cpu("attention_mask",p.mask.data(),p.mask.size(),Dims2{1,256},s);
  enc.output("visual_features",features,256*768*sizeof(float));
  require(enc.context->enqueueV3(s),"v21 encoder");
  require(pre.context->setInputShape("visual_features",Dims3{1,256,768}),"feature shape");
  require(pre.context->setInputTensorAddress("visual_features",features.data),"feature binding");
  int64_t token=tokenizer.bos;
  auto mask=block_mask(256,1);
  pre.bind_cpu("text_token_ids",&token,1,Dims2{1,1},s);
  pre.bind_cpu("cos",p.cos.data(),257*32,Dims3{1,257,32},s);
  pre.bind_cpu("sin",p.sin.data(),257*32,Dims3{1,257,32},s);
  pre.bind_cpu("mask",mask.data(),mask.size(),Dims4{1,1,257,257},s);
  auto outputs=[&](Session& session,int index,int length){
   const auto shape=session.context->getTensorShape("present_k");
   require(shape.nbDims==5 && shape.d[0]==12 && shape.d[1]==1 && shape.d[2]==length && shape.d[3]==2 && shape.d[4]==64,
           "unexpected v21 cache dimensions");
   const size_t size=size_t(12)*512*2*64*sizeof(float);
   session.output("present_k",k[index],size);session.output("present_v",v[index],size);
   session.output("logits",logits,probs.size()*sizeof(float));
  };
  outputs(pre,0,257);require(pre.context->enqueueV3(s),"v21 prefill");
  for(int i=0;i<limit;++i){
   check(cudaMemcpyAsync(probs.data(),logits.data,probs.size()*sizeof(float),cudaMemcpyDeviceToHost,s));
   check(cudaStreamSynchronize(s));token=argmax(probs.data(),probs.size());
   if(tokenizer.stop(token)){r.stopped=true;break;}
   r.ids.push_back(token);
   if(i+1==limit)break;
   const int pos=257+i,slot=i%2;const Dims shape{5,{12,1,pos,2,64}};
   dec.bind_cpu("text_token_ids",&token,1,Dims2{1,1},s);
   dec.bind_cpu("cos",p.cos.data()+pos*32,32,Dims3{1,1,32},s);
   dec.bind_cpu("sin",p.sin.data()+pos*32,32,Dims3{1,1,32},s);
   for(auto pair:{std::make_pair("past_k",k[slot].data),std::make_pair("past_v",v[slot].data)}){
    require(dec.context->setInputShape(pair.first,shape),pair.first);
    require(dec.context->setInputTensorAddress(pair.first,pair.second),pair.first);
   }
   outputs(dec,1-slot,pos+1);require(dec.context->enqueueV3(s),"v21 decode");
  }
  r.total_ms=ms(start);return r;
 }
};
}
