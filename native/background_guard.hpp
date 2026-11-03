#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <vector>
// A bright glyph outline is not evidence that the surrounding paper is white.
// Require disagreement on three sides, so a nearby bubble border alone does
// not invalidate ordinary flat-paper cleaning. Inspect beyond the thin halo.
inline bool background_fill_conflict(const std::vector<uint8_t>& rgb,int w,int h,const std::array<int,4>& b,const std::array<uint8_t,3>& fill){
 const int pad=std::clamp(std::min(b[2]-b[0],b[3]-b[1])/5,6,18),gap=3;
 const std::array<std::array<int,4>,4> bands={{{b[0]-pad,b[1],b[0]-gap,b[3]},{b[2]+gap,b[1],b[2]+pad,b[3]},{b[0],b[1]-pad,b[2],b[1]-gap},{b[0],b[3]+gap,b[2],b[3]+pad}}};
 int conflict=0;
 for(auto band:bands){size_t total=0,different=0;for(int y=std::max(0,band[1]);y<std::min(h,band[3]);++y)for(int x=std::max(0,band[0]);x<std::min(w,band[2]);++x){int delta=0;for(int c=0;c<3;++c)delta+=std::abs(int(rgb[(size_t(y)*w+x)*3+c])-int(fill[c]));++total;different+=delta>3*22;}conflict+=total>=20&&different>=total*.70;}
 return conflict>=3;
}
