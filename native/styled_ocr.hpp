#pragma once
#include "image_ops.hpp"

struct StyledGlyph {Box box;std::vector<int> pixels;};
inline std::vector<StyledGlyph> styled_glyphs(const PageImage& image,Box bounds){
 const int width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];std::vector<uint8_t> seen(size_t(width)*height);std::vector<StyledGlyph> parts;
 auto dark=[&](int x,int y){const auto p=(size_t(y+bounds[1])*image.width+x+bounds[0])*3;return image.rgb[p]+image.rgb[p+1]+image.rgb[p+2]<240;};
 for(int y=0;y<height;y++)for(int x=0;x<width;x++){
  const int start=y*width+x;if(seen[start]||!dark(x,y))continue;seen[start]=1;StyledGlyph part{{x,y,x+1,y+1},{start}};
  for(size_t i=0;i<part.pixels.size();i++){const int px=part.pixels[i]%width,py=part.pixels[i]/width;for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){const int nx=px+dx,ny=py+dy;if(nx<0||ny<0||nx>=width||ny>=height||seen[ny*width+nx]||!dark(nx,ny))continue;seen[ny*width+nx]=1;part.pixels.push_back(ny*width+nx);part.box={std::min(part.box[0],nx),std::min(part.box[1],ny),std::max(part.box[2],nx+1),std::max(part.box[3],ny+1)};}}
  const int w=part.box[2]-part.box[0],h=part.box[3]-part.box[1];if(part.pixels.size()<12||w<3||h<3||(h>width*.8&&w<width*.2))continue;
  size_t edge=0,white=0;for(const int p:part.pixels){const int px=p%width,py=p/width;for(const auto d:std::array<std::array<int,2>,4>{{{{-1,0}},{{1,0}},{{0,-1}},{{0,1}}}}){const int nx=px+d[0],ny=py+d[1];if(nx<0||ny<0||nx>=width||ny>=height||dark(nx,ny))continue;const int gx=std::clamp(bounds[0]+px+d[0]*2,0,image.width-1),gy=std::clamp(bounds[1]+py+d[1]*2,0,image.height-1);const auto q=(size_t(gy)*image.width+gx)*3;edge++;white+=image.rgb[q]+image.rgb[q+1]+image.rgb[q+2]>=660;}}
  if(!edge||double(white)/edge<.6)continue;parts.push_back(std::move(part));
 }
 bool changed=true;while(changed){changed=false;for(size_t i=0;i<parts.size()&&!changed;i++)for(size_t j=i+1;j<parts.size();j++){
  const auto a=parts[i].box,b=parts[j].box;Box combined{std::min(a[0],b[0]),std::min(a[1],b[1]),std::max(a[2],b[2]),std::max(a[3],b[3])};const int w=combined[2]-combined[0],h=combined[3]-combined[1],xgap=std::max(0,std::max(a[0],b[0])-std::min(a[2],b[2])),ygap=std::max(0,std::max(a[1],b[1])-std::min(a[3],b[3]));
  const double xover=double(std::max(0,std::min(a[2],b[2])-std::max(a[0],b[0])))/std::min(a[2]-a[0],b[2]-b[0]),yover=double(std::max(0,std::min(a[3],b[3])-std::max(a[1],b[1])))/std::min(a[3]-a[1],b[3]-b[1]);
  if(h>1.2*w||h>width*.95||w>width*.98||!((xover>.5&&ygap<=width*.1)||(yover>.5&&xgap<=width*.12)))continue;
  parts[i].box=combined;parts[i].pixels.insert(parts[i].pixels.end(),parts[j].pixels.begin(),parts[j].pixels.end());parts.erase(parts.begin()+j);changed=true;break;
 }}
 parts.erase(std::remove_if(parts.begin(),parts.end(),[&](const StyledGlyph& p){const int w=p.box[2]-p.box[0],h=p.box[3]-p.box[1];return w<width*.35||(h<width*.3&&(w<width*.55||h<width*.04))||h>width*1.6;}),parts.end());
 std::sort(parts.begin(),parts.end(),[](const auto&a,const auto&b){return a.box[1]<b.box[1];});return parts;
}
inline PageImage styled_glyph_image(const StyledGlyph& glyph,int source_width){
 const int padding=8,width=glyph.box[2]-glyph.box[0]+padding*2,height=glyph.box[3]-glyph.box[1]+padding*2;PageImage image{width,height,std::vector<uint8_t>(size_t(width)*height*3,255)};
 for(const int p:glyph.pixels){const int x=p%source_width-glyph.box[0]+padding,y=p/source_width-glyph.box[1]+padding;for(int c=0;c<3;c++)image.rgb[(size_t(y)*width+x)*3+c]=0;}return image;
}
