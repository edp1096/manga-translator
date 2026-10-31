#pragma once
#include "name_reading.hpp"
// Only proposes crops. Callers must independently verify every column and its
// reading ownership; projection alone must never authorize deletion.
inline std::vector<Box> projected_middle_column(const PageImage& image,const Box& bounds){
 const int w=bounds[2]-bounds[0],h=bounds[3]-bounds[1];
 if(w<32||h<w*1.4||h>w*5||bounds[0]<0||bounds[1]<0||bounds[2]>image.width||bounds[3]>image.height)return {};
 std::vector<std::array<int,2>> splits;
 for(int threshold:{60,100,140}){
  std::vector<int> ink(w);for(int x=0;x<w;++x)for(int y=bounds[1];y<bounds[3];++y){const auto p=(size_t(y)*image.width+x+bounds[0])*3;ink[x]+=std::max({image.rgb[p],image.rgb[p+1],image.rgb[p+2]})<threshold;}
  auto valley=[&](int start,int end){int best=-1;double value=1e30;for(int x=start;x<=end;++x){const double score=ink[x]+.3*ink[x-1]+.3*ink[x+1];if(score<value){value=score;best=x;}}return best;};
  const int left=valley(int(w*.15),int(w*.35)),right=valley(int(w*.65),int(w*.88));
  if(ink[left]>h*.08||ink[right]>h*.08||right-left<w*.4||right-left>w*.65)return {};
  for(auto range:std::vector<std::array<int,2>>{{0,left},{left,right},{right,w}}){int n=0;for(int x=range[0];x<range[1];++x)n+=ink[x];if(n<double(range[1]-range[0])*h*.04)return {};}
  splits.push_back({left,right});
 }
 for(int side=0;side<2;++side){const auto [low,high]=std::minmax({splits[0][side],splits[1][side],splits[2][side]});if(high-low>std::max(2,int(w*.04)))return {};}
 const int l=bounds[0]+splits[1][0],r=bounds[0]+splits[1][1];
 return {Box{bounds[0],bounds[1],l,bounds[3]},Box{l,bounds[1],r,bounds[3]},Box{r,bounds[1],bounds[2],bounds[3]}};
}
