#pragma once
#include "restoration_mask.hpp"
#include <set>

// Remove inpainting ghosts only where the complete unmasked collar is nearly
// white paper. Never expand the authorized mask or whiten a textured/ink edge.
inline size_t restoration_flat_paper(const PageImage& source,const RestorationMask& mask,std::vector<uint8_t>& rgba){
 if(!mask.accepted()||!restoration_box(mask.bounds,source)||rgba.size()!=size_t(source.width)*source.height*4)return 0;
 const int w=mask.bounds[2]-mask.bounds[0],h=mask.bounds[3]-mask.bounds[1];if(mask.pixels.size()!=size_t(w)*h)return 0;
 std::vector<uint8_t> seen(mask.pixels.size());size_t changed=0;
 auto masked=[&](int x,int y){return x>=mask.bounds[0]&&x<mask.bounds[2]&&y>=mask.bounds[1]&&y<mask.bounds[3]&&mask.pixels[size_t(y-mask.bounds[1])*w+x-mask.bounds[0]];};
 for(int start=0;start<w*h;start++){
  if(!mask.pixels[start]||seen[start])continue;std::vector<int> component{start};seen[start]=1;std::set<size_t> collar;bool closed=true;
  for(size_t i=0;i<component.size();i++){const int x=component[i]%w,y=component[i]/w,gx=x+mask.bounds[0],gy=y+mask.bounds[1];
   for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++){const int px=gx+dx,py=gy+dy;if(px<0||py<0||px>=source.width||py>=source.height){closed=false;continue;}if(!masked(px,py))collar.insert(size_t(py)*source.width+px);}
   for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){const int nx=x+dx,ny=y+dy,n=ny*w+nx;if(nx<0||ny<0||nx>=w||ny>=h||seen[n]||!mask.pixels[n])continue;seen[n]=1;component.push_back(n);}
  }
  if(!closed||collar.size()<8)continue;std::array<std::vector<uint8_t>,3> samples;bool paper=true;
  for(const auto p:collar)for(int c=0;c<3;c++){const auto value=source.rgb[p*3+c];if(value<240)paper=false;samples[c].push_back(value);}
  if(!paper)continue;Color fill{};for(int c=0;c<3;c++){auto& values=samples[c];std::nth_element(values.begin(),values.begin()+values.size()/2,values.end());fill[c]=values[values.size()/2];if(fill[c]<248)paper=false;}
  if(!paper)continue;
  for(const int p:component){const auto q=(size_t(p/w+mask.bounds[1])*source.width+p%w+mask.bounds[0])*4;if(!rgba[q+3])continue;for(int c=0;c<3;c++)rgba[q+c]=fill[c];changed++;}
 }
 return changed;
}
