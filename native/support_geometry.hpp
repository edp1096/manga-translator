#pragma once
#include "image_ops.hpp"

// Segmentation evidence for matching raw detector supports to recognized text.
// This is separate from tooltip hit geometry and does not authorize restoration.
inline json support_geometry(const Region& region,int width,int height){
 const int side=region.mask_side;const auto& box=region.box;
 if(width<=0||height<=0||side<3||side>512||region.mask.size()!=size_t(side)*side||box[0]<0||box[1]<0||box[2]>width||box[3]>height||box[2]<=box[0]||box[3]<=box[1])return nullptr;
 json runs=json::array();size_t count=0;
 for(int y=0;y<side;y++){
  const double py=(y+.5)*height/side;if(py<box[1]||py>=box[3])continue;int start=-1;
  for(int x=0;x<=side;x++){
   const double px=(x+.5)*width/side;const bool on=x<side&&px>=box[0]&&px<box[2]&&region.mask[size_t(y)*side+x];
   if(on&&start<0)start=x;
   if(!on&&start>=0){runs.push_back(y*side+start);runs.push_back(x-start);count+=x-start;start=-1;}
  }
 }
 if(!count)return nullptr;
 return {{"version",1},{"kind","detector-support"},{"imageWidth",width},{"imageHeight",height},{"width",side},{"height",side},{"sourceBox",box},{"pixels",count},{"runs",std::move(runs)}};
}
