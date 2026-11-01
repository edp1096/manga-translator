#pragma once
#include "restoration_mask.hpp"
#include "torch_restoration_loader.hpp"

struct MangaRestorer {
 std::unique_ptr<Ort::Env> env;Ort::SessionOptions options{nullptr};std::unique_ptr<Ort::Session> session;
 std::unique_ptr<TorchRestoration> torch;
 static Ort::SessionOptions make_options(int threads,OrtExecution execution){
  if(execution.backend!="cuda")return ort_options(threads,execution);
  auto o=ort_options(threads);OrtCUDAProviderOptionsV2* cuda=nullptr;Ort::ThrowOnError(Ort::GetApi().CreateCUDAProviderOptions(&cuda));
  try{const auto device=std::to_string(execution.device);const char* keys[]={"device_id","cudnn_conv_algo_search","use_tf32"};const char* values[]={device.c_str(),"HEURISTIC","0"};Ort::ThrowOnError(Ort::GetApi().UpdateCUDAProviderOptions(cuda,keys,values,3));Ort::ThrowOnError(Ort::GetApi().SessionOptionsAppendExecutionProvider_CUDA_V2(o,cuda));}catch(...){Ort::GetApi().ReleaseCUDAProviderOptions(cuda);throw;}
  Ort::GetApi().ReleaseCUDAProviderOptions(cuda);return o;
 }
 MangaRestorer(const fs::path& model,int threads,OrtExecution execution,const fs::path& library={}){
  if(!library.empty()){
   require(execution.backend=="cuda","LibTorch restoration requires CUDA");
   torch=std::make_unique<TorchRestoration>(library,model,execution.device);return;
  }
  env=std::make_unique<Ort::Env>(private_ort_env("manga-lama"));options=make_options(threads,execution);
  session=std::make_unique<Ort::Session>(*env,model.c_str(),options);
  require(session->GetInputCount()==2&&session->GetOutputCount()==1,"Invalid restoration model inputs");
  const auto image_type=session->GetInputTypeInfo(0),mask_type=session->GetInputTypeInfo(1);
  require(image_type.GetTensorTypeAndShapeInfo().GetShape()==std::vector<int64_t>({1,3,512,512})&&mask_type.GetTensorTypeAndShapeInfo().GetShape()==std::vector<int64_t>({1,1,512,512}),"Restoration requires the verified 512-pixel Manga LaMa model");
 }
 void apply(const PageImage& source,const RestorationMask& mask,std::vector<uint8_t>& rgba){
  constexpr int side=512;constexpr size_t n=side*side;
  const int mw=mask.bounds[2]-mask.bounds[0],mh=mask.bounds[3]-mask.bounds[1];
  const double page_scale=std::min(source.width,source.height)/720.;
  const int crop_side=std::max(side,int(std::ceil(std::max(512*page_scale,std::max(mw,mh)+128*page_scale))));
  const int ox=std::max(0,std::min(source.width-crop_side,(mask.bounds[0]+mask.bounds[2]-crop_side)/2)),oy=std::max(0,std::min(source.height-crop_side,(mask.bounds[1]+mask.bounds[3]-crop_side)/2));
  const double factor=crop_side/double(side);std::vector<float> input(3*n),m(n);
  for(int y=0;y<side;y++)for(int x=0;x<side;x++){
   const double px=std::clamp(ox+(x+.5)*factor-.5,0.,double(source.width-1)),py=std::clamp(oy+(y+.5)*factor-.5,0.,double(source.height-1));
   const int x0=int(px),y0=int(py),x1=std::min(source.width-1,x0+1),y1=std::min(source.height-1,y0+1);const double dx=px-x0,dy=py-y0;
   for(int c=0;c<3;c++)input[c*n+y*side+x]=float(((1-dy)*((1-dx)*source.rgb[(size_t(y0)*source.width+x0)*3+c]+dx*source.rgb[(size_t(y0)*source.width+x1)*3+c])+dy*((1-dx)*source.rgb[(size_t(y1)*source.width+x0)*3+c]+dx*source.rgb[(size_t(y1)*source.width+x1)*3+c]))/255.);
   const int left=std::max(mask.bounds[0],int(std::floor(ox+x*factor))),right=std::min(mask.bounds[2],int(std::ceil(ox+(x+1)*factor))),top=std::max(mask.bounds[1],int(std::floor(oy+y*factor))),bottom=std::min(mask.bounds[3],int(std::ceil(oy+(y+1)*factor)));
   for(int sy=top;sy<bottom&&!m[y*side+x];sy++)for(int sx=left;sx<right;sx++)if(mask.pixels[size_t(sy-mask.bounds[1])*mw+sx-mask.bounds[0]]){m[y*side+x]=1;break;}
  }
  std::vector<float> restored;
  if(torch)restored=torch->run(input,m);
  else{
   std::vector<Ort::Value> inputs;inputs.push_back(tensor(input,{1,3,side,side}));inputs.push_back(tensor(m,{1,1,side,side}));const char* names[]={"image","mask"};const char* outputs[]={"output"};
   auto values=session->Run(Ort::RunOptions{nullptr},names,inputs.data(),2,outputs,1);require(values[0].GetTensorTypeAndShapeInfo().GetShape()==std::vector<int64_t>({1,3,side,side}),"Invalid restoration output dimensions");const auto* result=values[0].GetTensorData<float>();restored.assign(result,result+3*n);
  }
  const auto* result=restored.data();
  for(int y=0;y<mh;y++)for(int x=0;x<mw;x++)if(mask.pixels[size_t(y)*mw+x]){
   const int gx=x+mask.bounds[0],gy=y+mask.bounds[1];const double px=std::clamp((gx+.5-ox)/factor-.5,0.,511.),py=std::clamp((gy+.5-oy)/factor-.5,0.,511.);const int x0=int(px),y0=int(py),x1=std::min(side-1,x0+1),y1=std::min(side-1,y0+1);const double dx=px-x0,dy=py-y0;
   for(int c=0;c<3;c++){const double v=(1-dy)*((1-dx)*result[c*n+y0*side+x0]+dx*result[c*n+y0*side+x1])+dy*((1-dx)*result[c*n+y1*side+x0]+dx*result[c*n+y1*side+x1]);require(std::isfinite(v),"Nonfinite restoration output");rgba[(size_t(gy)*source.width+gx)*4+c]=uint8_t(std::clamp(std::lround(v*255),0l,255l));}
   rgba[(size_t(gy)*source.width+gx)*4+3]=255;
  }
 }
};
