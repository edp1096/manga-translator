#pragma once
#include "layout_refinement.hpp"
#include <functional>

inline bool panel_text_bounds_allowed(const Box& box,const Box& frame,const std::vector<Region>& known){
 if(area(box)<=0||box[0]<frame[0]+2||box[1]<frame[1]+2||box[2]>frame[2]-2||box[3]>frame[3]-2||area(box)>area(frame)*.2)return false;
 return std::none_of(known.begin(),known.end(),[&](const Region& old){return old.cls<2&&double(overlap(old.box,box))/std::max(1,std::min(area(old.box),area(box)))>.25;});
}
// Extra detections remain provisional until independent OCR/classification.
// Existing detections keep their IDs, erasure decisions and source geometry.
inline size_t refine_panel_text(const PageImage& image,OnnxLayout& detector,std::vector<Region>& regions,int mask_side,const std::function<void()>& check={}){
 std::vector<Region> frames;
 for(const auto& r:regions)if(r.cls==3&&r.score>=.65f&&area(r.box)>=int64_t(image.width)*image.height*.03&&area(r.box)<=int64_t(image.width)*image.height*.6)frames.push_back(r);
 std::stable_sort(frames.begin(),frames.end(),[](const Region&a,const Region&b){return area(a.box)<area(b.box);});if(frames.size()>6)frames.resize(6);
 size_t passes=0;
 for(const auto& frame:frames){
  if(check)check();const auto bounds=expand_box(frame.box,int((frame.box[2]-frame.box[0])*.14),image.width,image.height);
  const int width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];PageImage crop{width,height,std::vector<uint8_t>(size_t(width)*height*3)};
  for(int y=0;y<height;y++)std::copy_n(image.rgb.data()+(size_t(bounds[1]+y)*image.width+bounds[0])*3,size_t(width)*3,crop.rgb.data()+size_t(y)*width*3);
  auto input=layout_input(crop,false,false,detector.input_side());auto found=decode_regions(detector.run(input),width,height);passes++;
  for(const auto& local:found){
   if(local.cls!=0||local.box[0]<3||local.box[1]<3||local.box[2]>width-3||local.box[3]>height-3)continue;
   auto candidate=project_region(local,bounds,image.width,image.height,mask_side);
   if(!panel_text_bounds_allowed(candidate.box,frame.box,regions))continue;
   candidate.panel_candidate=true;regions.push_back(std::move(candidate));
  }
 }
 return passes;
}
