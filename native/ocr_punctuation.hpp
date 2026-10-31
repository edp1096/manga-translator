#pragma once
#include "ocr_boundary.hpp"

namespace ocr_punctuation {
inline json stroke(const PageImage& image,Box box,int threshold){
 const auto outer=expand_box(box,24,image.width,image.height);const int w=outer[2]-outer[0],h=outer[3]-outer[1];
 std::vector<uint8_t> dark(size_t(w)*h),seen(dark.size());
 for(int y=0;y<h;y++)for(int x=0;x<w;x++){auto p=(size_t(y+outer[1])*image.width+x+outer[0])*3;dark[y*w+x]=(int(image.rgb[p])+image.rgb[p+1]+image.rgb[p+2])/3<threshold;}
 size_t ink=0;json parts=json::array();
 for(int start=0;start<w*h;start++){if(seen[start]||!dark[start])continue;std::vector<int> q{start};seen[start]=1;size_t inside=0;Box extent{image.width,image.height,0,0};bool edge=false;
  for(size_t i=0;i<q.size();i++){int x=q[i]%w,y=q[i]/w,gx=x+outer[0],gy=y+outer[1];inside+=gx>=box[0]&&gx<box[2]&&gy>=box[1]&&gy<box[3];edge|=x==0||y==0||x==w-1||y==h-1;extent={std::min(extent[0],gx),std::min(extent[1],gy),std::max(extent[2],gx+1),std::max(extent[3],gy+1)};
   for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){int nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h||seen[ny*w+nx]||!dark[ny*w+nx])continue;seen[ny*w+nx]=1;q.push_back(ny*w+nx);}}
  ink+=inside;if(inside&&!edge)parts.push_back({{"ink",inside},{"box",extent}});
 }
 const int axis=std::max(box[2]-box[0],box[3]-box[1]);
 for(const auto&p:parts){const Box b=p.at("box");const int large=std::max(b[2]-b[0],b[3]-b[1]),small=std::min(b[2]-b[0],b[3]-b[1]);if(ink>=16&&p.at("ink").get<size_t>()>=ink*.5&&large>=axis*.65&&large>=small*2.5)return {{"threshold",threshold},{"totalInk",ink},{"componentInk",p.at("ink")},{"componentBox",b}};}
 return nullptr;
}
inline json proof(const PageImage& image,const json& row,const std::vector<Region>& detected){
 if(row.value("type",std::string{})!="text"||!ocr_boundary::dots_only(row.value("text",std::string{}))||row.contains("textVerification"))return nullptr;
 for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})if(row.value(flag,false))return nullptr;
 if(!row.contains("bbox")||!row["bbox"].is_array()||row["bbox"].size()!=4||!row.contains("detectorConfidence")||!row["detectorConfidence"].is_number())return nullptr;
 for(const auto& v:row["bbox"])if(!v.is_number_integer())return nullptr;
 const Box b=row["bbox"];const double confidence=row["detectorConfidence"];
 if(b[0]<0||b[1]<0||b[2]>image.width||b[3]>image.height||b[2]-b[0]<8||b[3]-b[1]<8||area(b)>int64_t(image.width)*image.height*.02||!std::isfinite(confidence)||confidence<.2||confidence>1)return nullptr;
 size_t matches=0;for(const auto&r:detected)if(r.cls==0&&r.box==b&&std::isfinite(r.score)&&std::abs(r.score-confidence)<.0001)matches++;if(matches!=1)return nullptr;
 json evidence=json::array();for(int threshold:{80,128,176}){auto e=stroke(image,b,threshold);if(e.is_null())return nullptr;evidence.push_back(std::move(e));}
 return {{"version",1},{"method","non-dot-connected-strokes"},{"id",row.at("id")},{"sourceText",row.at("text")},{"sourceBox",b},{"sourceConfidence",confidence},{"imageWidth",image.width},{"imageHeight",image.height},{"evidence",evidence}};
}
inline bool matches(const json& row,int width,int height){
 if(!row.contains("punctuationMismatch"))return false;const auto&p=row["punctuationMismatch"];
 for(const auto* flag:{"manual","layoutOverride","displayOverride"})if(row.value(flag,false))return false;
 return p.is_object()&&p.value("version",0)==1&&p.value("method",std::string{})=="non-dot-connected-strokes"&&p.value("imageWidth",0)==width&&p.value("imageHeight",0)==height&&p.value("id",-1)==row.value("id",-2)&&p.value("sourceText",std::string{})==row.value("text",std::string{})&&p.contains("sourceBox")&&row.contains("bbox")&&p["sourceBox"]==row["bbox"];
}
}
