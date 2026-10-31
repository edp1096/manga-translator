#pragma once
#include "image_ops.hpp"
#include "support_geometry.hpp"

inline json bubble_geometry(const PageImage& image, const std::vector<Region>& regions,float minimum_confidence=.65f) {
 json bubbles=json::array();
 for(const auto& region:regions) {
  if(region.cls!=2||region.score<minimum_confidence)continue;
  const int side=region.mask_side;
  if(side<3||region.mask.size()!=size_t(side)*side)continue;
  std::vector<uint8_t> interior(size_t(side)*side);
  for(int row=1;row<side-1;++row)for(int column=1;column<side-1;++column) {
   const double pixel_x=(column+.5)*image.width/side,pixel_y=(row+.5)*image.height/side;
   if(pixel_x<region.box[0]+3||pixel_x>region.box[2]-3||pixel_y<region.box[1]+3||pixel_y>region.box[3]-3)continue;
   bool inside=true;
   for(int offset_y=-1;offset_y<=1&&inside;++offset_y)for(int offset_x=-1;offset_x<=1;++offset_x)
    if(!region.mask[(row+offset_y)*side+column+offset_x]){inside=false;break;}
   interior[row*side+column]=inside;
  }
  json runs=json::array();
  for(size_t position=0;position<interior.size();) {
   if(!interior[position]){++position;continue;}
   const size_t start=position;
   while(position<interior.size()&&interior[position])++position;
   runs.push_back(start);runs.push_back(position-start);
  }
  if(runs.empty())continue;
  json supports=json::array();
  for(const auto& text:regions){
   if(text.cls>1||text.mask_side!=side||text.mask.size()!=region.mask.size()||!overlap(text.box,region.box))continue;
   size_t count=0,inside=0,safe=0;
   const int left=std::clamp(text.box[0]*side/image.width,0,side-1),top=std::clamp(text.box[1]*side/image.height,0,side-1);
   const int right=std::clamp((text.box[2]*side+image.width-1)/image.width,1,side),bottom=std::clamp((text.box[3]*side+image.height-1)/image.height,1,side);
   for(int row=top;row<bottom;++row)for(int column=left;column<right;++column){
    const size_t position=size_t(row)*side+column;
    if(!text.mask[position])continue;
    ++count;inside+=region.mask[position]>0;safe+=interior[position]>0;
   }
   if(count){json support={{"bbox",text.box},{"type",text.cls==1?"effect":"text"},{"confidence",text.score},{"inside",double(inside)/count},{"interior",double(safe)/count},{"detailVerified",region.detail_verified&&text.detail_verified}};if(text.cls==0){auto mask=support_geometry(text,image.width,image.height);if(!mask.is_null())support["glyphMask"]=std::move(mask);}supports.push_back(std::move(support));}
  }
  bool verified_white=false;
  if(image.rgb.size()==size_t(image.width)*image.height*3){
   const int margin=std::max(5,std::min(region.box[2]-region.box[0],region.box[3]-region.box[1])/8);
   const auto bounds=expand_box(region.box,margin,image.width,image.height);
   const int width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];
   int seed=-1;double nearest=1e30;size_t mask_pixels=0,bright_pixels=0;
   for(int row=1;row<side-1;++row)for(int column=1;column<side-1;++column){
    if(!interior[row*side+column])continue;
    ++mask_pixels;const int pixel_x=std::clamp(int((column+.5)*image.width/side),0,image.width-1),pixel_y=std::clamp(int((row+.5)*image.height/side),0,image.height-1);
    const size_t offset=(size_t(pixel_y)*image.width+pixel_x)*3;
    if(std::min({image.rgb[offset],image.rgb[offset+1],image.rgb[offset+2]})<235)continue;
    ++bright_pixels;const double distance=std::hypot(pixel_x-(region.box[0]+region.box[2])/2.,pixel_y-(region.box[1]+region.box[3])/2.);
    if(distance<nearest){nearest=distance;seed=(pixel_y-bounds[1])*width+pixel_x-bounds[0];}
   }
   const double compactness=double(mask_pixels)*image.width*image.height/(side*side*double(std::max(1,area(region.box))));
   if(seed>=0&&compactness>=.4&&mask_pixels&&double(bright_pixels)/mask_pixels>=.8){
    std::vector<uint8_t> visited(size_t(width)*height);std::vector<int> queue{seed};visited[seed]=1;bool escaped=false;
    for(size_t index=0;index<queue.size()&&!escaped;++index){
     const int position=queue[index],column=position%width,row=position/width;
     if(column==0||row==0||column==width-1||row==height-1){escaped=true;break;}
     for(const int next:{position-1,position+1,position-width,position+width}){
      if(visited[next])continue;visited[next]=1;
      const size_t offset=(size_t(bounds[1]+next/width)*image.width+bounds[0]+next%width)*3;
      if(std::min({image.rgb[offset],image.rgb[offset+1],image.rgb[offset+2]})>=220)queue.push_back(next);
     }
    }
    verified_white=!escaped&&double(queue.size())/std::max(1,area(region.box))>=.4;
   }
  }
  bubbles.push_back({{"bbox",region.box},{"confidence",region.score},{"width",side},{"height",side},{"runs",std::move(runs)},{"supports",std::move(supports)},{"verifiedWhite",verified_white},{"detailVerified",region.detail_verified}});
 }
 return {{"version",3},{"width",image.width},{"height",image.height},{"bubbles",std::move(bubbles)}};
}
