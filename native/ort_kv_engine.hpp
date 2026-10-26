#pragma once
#include "ort_engine.hpp"
struct OrtKvEngine:Engine{
 Ort::Env env;Ort::SessionOptions options;Ort::Session enc,pre,dec;std::vector<float> base;
 OrtKvEngine(const fs::path& dir,int threads,bool quant_encoder,bool quant_decoder,OrtExecution execution={}):Engine(dir/"tokenizer.json",256),env(private_ort_env("hayai-ocr-kv")),options(ort_options(threads,execution)),
 enc(env,(dir/(quant_encoder?"hayai_encoder_dynamic_quant.onnx":"hayai_encoder.onnx")).c_str(),options),
 pre(env,(dir/(quant_decoder?"hayai_decoder_kv_prefill_dynamic_quant.onnx":"hayai_decoder_kv_prefill.onnx")).c_str(),options),
 dec(env,(dir/(quant_decoder?"hayai_decoder_kv_step_dynamic_quant.onnx":"hayai_decoder_kv_step.onnx")).c_str(),options),base(read_positions(dir/"position_base.npy")){env.DisableTelemetryEvents();}
 std::string name()const override{return "onnx-v2-kv";}
 Result run(const fs::path& image,int max_tokens)override{
  Result r;auto total=Clock::now(),phase=total;auto p=prepare(image,256,true,base);r.prepare_ms=ms(phase);r.patches=p.patches;r.ph=p.ph;r.pw=p.pw;dump_prepared(dump,p);
  phase=Clock::now();const char* enc_names[]={"pixel_values","attention_mask","pos_embeds"};std::vector<Ort::Value> ei;ei.push_back(tensor(p.pixels,{1,256,768}));ei.push_back(tensor(p.mask,{1,256}));ei.push_back(tensor(p.pos,{1,256,768}));auto ename=enc.GetOutputNameAllocated(0,Ort::AllocatorWithDefaultOptions());const char* eo_names[]={ename.get()};auto eo=enc.Run(Ort::RunOptions{nullptr},enc_names,ei.data(),ei.size(),eo_names,1);r.encoder_ms=ms(phase);
  if(!dump.empty())dump_floats(dump/"vision.f32",std::vector<float>(eo[0].GetTensorData<float>(),eo[0].GetTensorData<float>()+256*768));
  phase=Clock::now();const char* pre_names[]={"visual_features","text_token_ids","cos","sin","mask"};const char* outputs[]={"logits","present_k","present_v"};int64_t token=tokenizer.bos;auto mask=block_mask(256,1);std::vector<Ort::Value> pi;pi.push_back(std::move(eo[0]));pi.push_back(tensor(&token,1,{1,1}));pi.push_back(tensor(p.cos.data(),257*32,{1,257,32}));pi.push_back(tensor(p.sin.data(),257*32,{1,257,32}));pi.push_back(tensor(mask,{1,1,257,257}));auto po=pre.Run(Ort::RunOptions{nullptr},pre_names,pi.data(),pi.size(),outputs,3);token=argmax(po[0].GetTensorData<float>(),16004);r.prefill_ms=ms(phase);
  if(!dump.empty())dump_floats(dump/"first_logits.f32",std::vector<float>(po[0].GetTensorData<float>(),po[0].GetTensorData<float>()+16004));
  if(tokenizer.stop(token)){r.stopped=true;r.total_ms=ms(total);return r;}r.ids.push_back(token);Ort::Value past_k=std::move(po[1]),past_v=std::move(po[2]);const char* step_names[]={"text_token_ids","cos","sin","past_k","past_v"};phase=Clock::now();
  while(int(r.ids.size())<max_tokens){int pos=256+r.ids.size();std::vector<Ort::Value> si;si.push_back(tensor(&token,1,{1,1}));si.push_back(tensor(p.cos.data()+size_t(pos)*32,32,{1,1,32}));si.push_back(tensor(p.sin.data()+size_t(pos)*32,32,{1,1,32}));si.push_back(std::move(past_k));si.push_back(std::move(past_v));auto so=dec.Run(Ort::RunOptions{nullptr},step_names,si.data(),si.size(),outputs,3);token=argmax(so[0].GetTensorData<float>(),16004);past_k=std::move(so[1]);past_v=std::move(so[2]);if(tokenizer.stop(token)){r.stopped=true;break;}r.ids.push_back(token);}
  r.decode_ms=ms(phase);r.total_ms=ms(total);return r;
 }
};
