#pragma once
#include "ocr_dedup.hpp"

namespace ocr_boundary {
inline bool dots_only(const std::string& text) {
 size_t count=0;
 for(auto c:codepoints(text)) {
  if(c<=0x20||c==0x3000)continue;
  if(c==0x2026||c==0x22ef){count+=3;continue;}
  if(c=='.'||c==0xff0e||c==0x30fb||c==0xb7){++count;continue;}
  return false;
 }
 return count>=2;
}
struct StrokeEvidence {size_t ink=0,connected=0;int radius=0;};
inline StrokeEvidence strokes(const PageImage& image,Box box,int threshold,int padding) {
 const auto outer=expand_box(box,padding,image.width,image.height);
 const int w=outer[2]-outer[0],h=outer[3]-outer[1];
 std::vector<uint8_t> dark(size_t(w)*h),seen(dark.size());
 std::vector<int> distance(dark.size());
 for(int y=0;y<h;y++)for(int x=0;x<w;x++) {
  const size_t p=(size_t(y+outer[1])*image.width+x+outer[0])*3;
  dark[y*w+x]=(int(image.rgb[p])+image.rgb[p+1]+image.rgb[p+2])/3<threshold;
  distance[y*w+x]=dark[y*w+x]?w+h:0;
 }
 StrokeEvidence out;
 for(int y=0;y<h;y++)for(int x=0;x<w;x++) {
  const int start=y*w+x;if(seen[start]||!dark[start])continue;
  std::vector<int> queue{start};seen[start]=1;size_t inside=0;bool escapes=false;
  for(size_t k=0;k<queue.size();k++) {
   const int px=queue[k]%w,py=queue[k]/w,gx=px+outer[0],gy=py+outer[1];
   inside+=gx>=box[0]&&gx<box[2]&&gy>=box[1]&&gy<box[3];
   escapes|=px==0||py==0||px+1==w||py+1==h;
   for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++) {
    const int nx=px+dx,ny=py+dy;
    if(nx<0||ny<0||nx>=w||ny>=h||seen[ny*w+nx]||!dark[ny*w+nx])continue;
    seen[ny*w+nx]=1;queue.push_back(ny*w+nx);
   }
  }
  out.ink+=inside;if(escapes)out.connected+=inside;
 }
 // Chessboard distance to white pixels bounds stroke thickness. Thick letters
 // joined to a thin outline must not be mistaken for the outline itself.
 for(int pass=0;pass<2;pass++) {
  const int direction=pass?-1:1;
  for(int yy=0;yy<h;yy++)for(int xx=0;xx<w;xx++) {
   const int y=pass?h-1-yy:yy,x=pass?w-1-xx:xx;auto& value=distance[y*w+x];
   if(!value)continue;
   for(const auto d:std::array<std::array<int,2>,4>{{{{-direction,0}},{{-1,-direction}},{{0,-direction}},{{1,-direction}}}}) {
    const int nx=x+d[0],ny=y+d[1];
    value=std::min(value,1+(nx<0||ny<0||nx>=w||ny>=h?0:distance[ny*w+nx]));
   }
  }
 }
 for(int y=box[1];y<box[3];y++)for(int x=box[0];x<box[2];x++)out.radius=std::max(out.radius,distance[(y-outer[1])*w+x-outer[0]]);
 return out;
}
inline json proof(const PageImage& image,const json& row,const std::vector<Region>& detected) {
 if(row.value("type",std::string{})!="effect"||row.value("mode",std::string{})!="tooltip"||!dots_only(row.value("text",std::string{})))return nullptr;
 for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})if(row.value(flag,false))return nullptr;
 if(row.contains("textVerification")||!row.contains("bbox")||!row["bbox"].is_array()||row["bbox"].size()!=4)return nullptr;
 for(const auto& n:row["bbox"])if(!n.is_number_integer())return nullptr;
 const Box box=row["bbox"];
 if(box[0]<0||box[1]<0||box[2]>image.width||box[3]>image.height||box[2]-box[0]<8||box[3]-box[1]<8||area(box)>int64_t(image.width)*image.height*.02)return nullptr;
 const int longSide=std::max(box[2]-box[0],box[3]-box[1]),shortSide=std::min(box[2]-box[0],box[3]-box[1]);
 if(longSide<shortSide*1.5||!row.contains("detectorConfidence")||!row["detectorConfidence"].is_number())return nullptr;
 const double confidence=row["detectorConfidence"];
 if(!std::isfinite(confidence)||confidence<.2||confidence>.6)return nullptr;
 const Region* source=nullptr;
 for(const auto& region:detected)if(region.cls==1&&region.box==box&&std::isfinite(region.score)&&std::abs(region.score-confidence)<.0001) {if(source)return nullptr;source=&region;}
 if(!source||source->mask_side<3||source->mask_side>512||source->mask.size()!=size_t(source->mask_side)*source->mask_side)return nullptr;
 size_t pixels=0;for(auto p:source->mask)pixels+=p!=0;if(pixels<8)return nullptr;
 const Region* balloon=nullptr;
 for(const auto& b:detected) {
  if(b.cls!=2||!std::isfinite(b.score)||b.score<.85||b.mask_side!=source->mask_side||b.mask.size()!=source->mask.size())continue;
  const double intersection=double(overlap(b.box,box))/area(box);
  if(intersection<.2||intersection>.85)continue;
  size_t inside=0;for(size_t p=0;p<b.mask.size();p++)inside+=source->mask[p]&&b.mask[p];
  if(double(inside)/pixels>.1)continue;
  // At least some source support must touch this balloon, not just its bbox.
  if(!inside)continue;
  if(!balloon||b.score>balloon->score)balloon=&b;
 }
 if(!balloon)return nullptr;
 const double scale=std::min(image.width,image.height)/960.;
 const int padding=std::max(8,int(std::ceil(24*scale))),radiusLimit=std::max(1,int(std::ceil(3*scale)));
 json evidence=json::array();
 for(int threshold:{80,128,176}) {
  const auto m=strokes(image,box,threshold,padding);
  if(m.ink<16||m.ink>area(box)*.35||m.connected<m.ink*.98||m.radius>radiusLimit)return nullptr;
  evidence.push_back({{"threshold",threshold},{"ink",m.ink},{"connected",m.connected},{"radius",m.radius}});
 }
 return {{"version",1},{"imageWidth",image.width},{"imageHeight",image.height},{"sourceConfidence",confidence},{"id",row.at("id")},{"sourceText",row.at("text")},{"sourceBox",box},{"method","connected-thin-balloon-outline"},{"balloonBox",balloon->box},{"balloonConfidence",balloon->score},{"strokeEvidence",evidence}};
}
}
