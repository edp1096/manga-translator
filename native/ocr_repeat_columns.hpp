#pragma once
#include "ocr_dedup.hpp"
#include "name_reading.hpp"

// The whole-crop decoder can collapse two identical utterances into one. Only
// recover them from separate physical columns, retaining their own punctuation.
// This is source reconstruction, not permission to erase a background.
namespace repeat_columns {
inline bool foreground(const PageImage& image,int x,int y,int threshold,bool inverse){
 const auto p=image.rgb.data()+(size_t(y)*image.width+x)*3;
 const int value=(int(p[0])+p[1]+p[2])/3;
 return inverse?255-value<threshold:value<threshold;
}
inline std::vector<Box> split(const PageImage& image,const Box& b,int threshold,bool inverse){
 const int w=b[2]-b[0],h=b[3]-b[1];
 if(w<24||h<48||h<w*.8||w>1024||b[0]<0||b[1]<0||b[2]>image.width||b[3]>image.height)return {};
 std::vector<int> cuts{b[0]};int start=-1;
 for(int x=b[0];x<=b[2];x++){
  bool empty=x<b[2];if(empty)for(int y=b[1];y<b[3];y++)if(foreground(image,x,y,threshold,inverse)){empty=false;break;}
  if(empty){if(start<0)start=x;continue;}
  if(start>=0){if(start>b[0]&&x<b[2]&&x-start>=2)cuts.push_back((start+x)/2);start=-1;}
 }
 cuts.push_back(b[2]);if(cuts.size()<3||cuts.size()>5)return {};
 std::vector<Box> columns;int minimum=1024,maximum=0;
 for(size_t i=1;i<cuts.size();i++){
  const Box c{cuts[i-1],b[1],cuts[i],b[3]};const int width=c[2]-c[0];if(width<6||h<width*2)return {};
  Box ink{c[2],c[3],c[0],c[1]};size_t pixels=0;
  for(int y=c[1];y<c[3];y++)for(int x=c[0];x<c[2];x++)if(foreground(image,x,y,threshold,inverse)){pixels++;ink={std::min(ink[0],x),std::min(ink[1],y),std::max(ink[2],x+1),std::max(ink[3],y+1)};}
  const int iw=ink[2]-ink[0],ih=ink[3]-ink[1];if(pixels<24||iw<6||ih<iw*2||ih<16)return {};
  minimum=std::min(minimum,iw);maximum=std::max(maximum,iw);columns.push_back(c);
 }
 // Ruby is usually narrower than the main text. Do not duplicate a name by
 // treating its reading annotation as another utterance of the same size.
 if(minimum<maximum*.7)return {};
 std::reverse(columns.begin(),columns.end());return columns;
}
struct Columns {std::vector<Box> boxes;bool inverse=false;};
inline Columns physical_columns(const PageImage& image,const Box& box,const std::string& prior){
 const auto word=ocr_characters(prior);if(word.size()<2||word.size()>6)return {};
 Columns found;
 for(bool inverse:{false,true}){
  auto cols=split(image,box,128,inverse);if(cols.empty())continue;
  // A gap appearing only after an aggressive threshold can split one glyph.
  if(split(image,box,80,inverse)!=cols||split(image,box,176,inverse)!=cols)continue;
  if(!found.boxes.empty())return {};found={std::move(cols),inverse};
 }
 return found;
}
inline bool eligible(const json& row,const PageImage& image){
 if(row.value("type",std::string{})!="text"||!row.contains("bbox")||!row["bbox"].is_array()||row["bbox"].size()!=4||!row.contains("detectorConfidence")||!row["detectorConfidence"].is_number())return false;
 for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})if(row.value(flag,false))return false;
 for(const auto& n:row["bbox"])if(!n.is_number_integer())return false;
 const double score=row["detectorConfidence"];const auto b=row["bbox"].get<Box>();
 return std::isfinite(score)&&score>=.2&&score<=1&&b[0]>=0&&b[1]>=0&&b[2]<=image.width&&b[3]<=image.height&&area(b)>0;
}
inline const Region* source(const json& row,const std::vector<Region>& detected){
 const Region* found=nullptr;const auto b=row.at("bbox").get<Box>();const double score=row.at("detectorConfidence");
 for(const auto& r:detected)if(r.cls==0&&r.box==b&&std::isfinite(r.score)&&std::abs(r.score-score)<.0001&&r.mask_side>=3&&r.mask_side<=512&&r.mask.size()==size_t(r.mask_side)*r.mask_side){if(found)return nullptr;found=&r;}
 return found;
}
inline bool glyphs_owned(const PageImage& image,const Columns& columns,const Region& source){
 const int side=source.mask_side;const auto b=source.box;
 for(const auto& c:columns.boxes){
  size_t ink=0,covered=0;
  for(int y=c[1];y<c[3];y++)for(int x=c[0];x<c[2];x++)if(foreground(image,x,y,128,columns.inverse)){
   ink++;const int sx=int((x+.5)*side/image.width),sy=int((y+.5)*side/image.height);bool hit=false;
   // One coarse detector cell accounts for antialiasing and mask quantization.
   for(int dy=-1;dy<=1&&!hit;dy++)for(int dx=-1;dx<=1;dx++){
    const int px=sx+dx,py=sy+dy;if(px<0||py<0||px>=side||py>=side)continue;
    const double gx=(px+.5)*image.width/side,gy=(py+.5)*image.height/side;
    if(gx>=b[0]&&gx<b[2]&&gy>=b[1]&&gy<b[3]&&source.mask[size_t(py)*side+px]){hit=true;break;}
   }
   covered+=hit;
  }
  if(ink<24||covered<ink*.98)return false;
 }
 return true;
}
template<class Read>
inline json correction(const PageImage& image,const json& row,const std::vector<Region>& detected,Read read){
 if(!eligible(row,image))return nullptr;
 const Box box=row.at("bbox");const std::string prior=row.value("text",std::string{});const auto cols=physical_columns(image,box,prior);
 if(cols.boxes.empty())return nullptr;const auto* mask=source(row,detected);if(!mask||!glyphs_owned(image,cols,*mask))return nullptr;
 const auto word=ocr_characters(prior);json evidence=json::array();std::string text;bool anchored=false;
 for(const auto& b:cols.boxes){
  json readings=json::array();std::string first;
  for(int scale:{1,2})for(bool inverse:{false,true}){
   const auto value=read(b,scale,inverse);if(value.empty()||ocr_characters(value)!=word)return nullptr;
   if(first.empty())first=value;else if(ocr_characters(value,false)!=ocr_characters(first,false))return nullptr;
   readings.push_back({{"scale",scale},{"inverse",inverse},{"text",value}});
  }
  anchored|=ocr_characters(first,false)==ocr_characters(prior,false);if(!text.empty())text+='\n';text+=first;evidence.push_back({{"bbox",b},{"readings",readings}});
 }
 if(!anchored)return nullptr;
 return {{"version",1},{"method","separate-physical-repeat-columns"},{"prior",prior},{"text",text},{"sourceBox",box},{"sourceConfidence",row.at("detectorConfidence")},{"sourceQuery",mask->query},{"foreground",cols.inverse?"light":"dark"},{"columns",evidence}};
}
}
