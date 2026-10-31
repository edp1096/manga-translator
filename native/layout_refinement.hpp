#pragma once
#include "image_ops.hpp"

inline double box_similarity(const Box& first,const Box& second){
 const int shared=overlap(first,second),combined=area(first)+area(second)-shared;
 return combined?double(shared)/combined:0;
}

inline std::vector<Box> detail_candidates(const LayoutRaw& raw,const PageImage& image,const std::vector<Region>& regions){
 std::vector<std::pair<float,Box>> candidates;
 for(size_t query=0;query<raw.logits.size()/5;++query){
  const float* logits=raw.logits.data()+query*5;
  const int category=int(std::max_element(logits,logits+4)-logits);
  const double confidence=1/(1+std::exp(-std::clamp(double(logits[category]),-30.,30.)));
  if(category!=2||confidence<.2||confidence>=.65)continue;
  const float* values=raw.boxes.data()+query*4;
  Box bounds{std::max(0,int((values[0]-values[2]/2)*image.width)),std::max(0,int((values[1]-values[3]/2)*image.height)),std::min(image.width,int((values[0]+values[2]/2)*image.width+1)),std::min(image.height,int((values[1]+values[3]/2)*image.height+1))};
  const int width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];
  if(width<12||height<12||double(area(bounds))/(double(image.width)*image.height)>.025||double(width)/height<.3||double(width)/height>3)continue;
  const bool recognized=std::any_of(regions.begin(),regions.end(),[&](const Region& region){return region.cls<2&&region.score>=.5&&area(region.box)<area(bounds)&&double(overlap(region.box,bounds))/std::max(1,area(region.box))>=.9;});
  if(!recognized)candidates.emplace_back(float(confidence),bounds);
 }
 std::stable_sort(candidates.begin(),candidates.end(),[](const auto& first,const auto& second){return first.first>second.first;});
 std::vector<Box> selected;
 for(const auto& candidate:candidates){
  if(std::any_of(selected.begin(),selected.end(),[&](const Box& previous){return box_similarity(previous,candidate.second)>.5;}))continue;
  selected.push_back(candidate.second);if(selected.size()==4)break;
 }
 return selected;
}

inline Region project_region(const Region& local,const Box& crop,int image_width,int image_height,int mask_side){
 Region projected=local;projected.mask_side=mask_side;projected.mask.assign(size_t(mask_side)*mask_side,0);
 projected.box={local.box[0]+crop[0],local.box[1]+crop[1],local.box[2]+crop[0],local.box[3]+crop[1]};
 for(int row=0;row<mask_side;++row)for(int column=0;column<mask_side;++column){
  const double pixel_x=(column+.5)*image_width/mask_side,pixel_y=(row+.5)*image_height/mask_side;
  if(pixel_x<crop[0]||pixel_y<crop[1]||pixel_x>=crop[2]||pixel_y>=crop[3])continue;
  const int local_x=std::clamp(int((pixel_x-crop[0])*local.mask_side/(crop[2]-crop[0])),0,local.mask_side-1),local_y=std::clamp(int((pixel_y-crop[1])*local.mask_side/(crop[3]-crop[1])),0,local.mask_side-1);
  projected.mask[row*mask_side+column]=local.mask[local_y*local.mask_side+local_x];
 }
 return projected;
}

inline size_t refine_small_bubbles(const PageImage& image,OnnxLayout& detector,const LayoutRaw& raw,std::vector<Region>& regions){
 const auto candidates=detail_candidates(raw,image,regions);size_t passes=0;
 std::vector<Box> examined;
 for(const auto& candidate:candidates){
  const int size=std::max(int(std::ceil(std::max(image.width,image.height)*.5)),4*std::max(candidate[2]-candidate[0],candidate[3]-candidate[1]));
  const int width=std::min(image.width,size),height=std::min(image.height,size),left=std::clamp((candidate[0]+candidate[2]-width)/2,0,image.width-width),top=std::clamp((candidate[1]+candidate[3]-height)/2,0,image.height-height);
  const Box crop{left,top,left+width,top+height};
  if(std::any_of(examined.begin(),examined.end(),[&](const Box& previous){return box_similarity(previous,crop)>.8;}))continue;
  examined.push_back(crop);++passes;
  PageImage detail{width,height,std::vector<uint8_t>(size_t(width)*height*3)};
  for(int row=0;row<height;++row)std::copy_n(image.rgb.data()+(size_t(top+row)*image.width+left)*3,size_t(width)*3,detail.rgb.data()+size_t(row)*width*3);
  auto input=layout_input(detail,false,false,detector.input_side());const auto refined=detector.run(input);
  const auto local_regions=decode_regions(refined,width,height);
  for(const auto& bubble:local_regions){
   if(bubble.cls!=2||bubble.score<.65f||bubble.box[0]<3||bubble.box[1]<3||bubble.box[2]>width-3||bubble.box[3]>height-3)continue;
   auto projected_bubble=project_region(bubble,crop,image.width,image.height,raw.mask_side);
   if(std::none_of(candidates.begin(),candidates.end(),[&](const Box& suspected){return box_similarity(projected_bubble.box,suspected)>=.6;}))continue;
   std::vector<Region> additions;
   for(const auto& text:local_regions){
    if(text.cls>1||text.score<.35f||double(area(text.box))/std::max(1,area(bubble.box))>.5||mask_coverage(bubble,text.box,width,height)<.98)continue;
    auto projected_text=project_region(text,crop,image.width,image.height,raw.mask_side);
    if(std::any_of(regions.begin(),regions.end(),[&](const Region& previous){return previous.cls<2&&box_similarity(previous.box,projected_text.box)>=.5;}))continue;
    projected_text.detail_verified=true;additions.push_back(projected_text);
   }
   if(additions.empty())continue;
   projected_bubble.detail_verified=true;regions.push_back(projected_bubble);regions.insert(regions.end(),additions.begin(),additions.end());
  }
 }
 return passes;
}
