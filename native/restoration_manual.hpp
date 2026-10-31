#pragma once
#include "restoration.hpp"

// Explicit user mask. It is independent of detector/OCR confidence and never
// modifies the original, the automatic restoration, or a previous preview.
inline RestorationMask checked_manual_mask(const json& input,int width,int height){
 require(input.is_object()&&input.at("width")==width&&input.at("height")==height,"Image dimensions changed; reopen the editor");
 const auto& b=input.at("bounds");require(b.is_array()&&b.size()==4&&std::all_of(b.begin(),b.end(),[](const json& v){return v.is_number_integer();}),"Invalid manual bounds");
 for(size_t i=0;i<4;i++)require(b[i]>=0&&b[i]<=(i%2?height:width),"Manual mask leaves the image");
 RestorationMask mask;mask.bounds=b.get<Box>();const auto box=mask.bounds;
 require(box[0]>=0&&box[1]>=0&&box[2]<=width&&box[3]<=height&&box[2]>box[0]&&box[3]>box[1],"Manual mask leaves the image");
 const int64_t size=int64_t(box[2]-box[0])*(box[3]-box[1]);require(size<=4000000,"Restore a smaller area at a time");
 const auto& runs=input.at("runs");require(runs.is_array()&&!runs.empty()&&runs.size()%2==0&&runs.size()<=200000,"Invalid manual mask runs");mask.pixels.resize(size);int64_t end=0;
 for(size_t i=0;i<runs.size();i+=2){require(runs[i].is_number_integer()&&runs[i+1].is_number_integer(),"Invalid manual mask run");const int64_t start=runs[i],count=runs[i+1];require(start>=end&&count>0&&start<=size&&count<=size-start,"Invalid manual mask span");end=start+count;mask.count+=count;require(mask.count<=1000000,"Restore a smaller area at a time");std::fill(mask.pixels.begin()+start,mask.pixels.begin()+end,1);}
 return mask;
}
