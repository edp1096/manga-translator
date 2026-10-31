#pragma once
#include "name_reading.hpp"
#include "layout_refinement.hpp"

// A contained detector column plus narrow kana to its right is evidence of
// ruby, not a reason to split every multi-column caption. OCR must independently
// confirm the proposed main column before the caller uses it.
inline std::optional<Box> detected_ruby_main(const Box& bounds,const std::vector<Region>& detected,const json& recognized){
 const int width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];
 if(width<16||height<width*2)return {};
 std::optional<Box> selected;
 for(const auto& region:detected){
  const auto b=region.box;const int bw=b[2]-b[0],bh=b[3]-b[1];
  if(region.cls>1||region.score<.2f||bw<width*.55||bw>width*.85||bh<height*.85||bh>height*1.1||std::abs(b[0]-bounds[0])>width*.1||double(overlap(b,bounds))/std::max(1,area(b))<.95)continue;
  bool ruby=false,unexplained=false;
  for(const auto& row:recognized){
   if(!row.contains("bbox")||!row.contains("text")||row.value("ocrTruncated",false))continue;
   const auto r=row.at("bbox").get<Box>();const int rw=r[2]-r[0],rh=r[3]-r[1];
   if(area(r)<=0||double(overlap(r,bounds))/area(r)<.9||area(r)>area(bounds)*.85||double(overlap(r,b))/area(r)>.9)continue;
   if(rw>=4&&rw<=width*.35&&rw<=bw*.45&&rh>=rw*2&&rh<height*.8&&r[0]>=b[0]+bw*.8&&kana_reading(row.at("text").get<std::string>()))ruby=true;
   else unexplained=true;
  }
  if(ruby&&!unexplained){if(selected&&box_similarity(*selected,b)<.9)return {};selected=b;}
 }
 return selected;
}

// Complete independently detected caption columns, without inventing a split
// through a glyph or discarding the enclosing detection's mask.
inline std::vector<Box> detected_caption_columns(const Box& bounds,const json& rows){
 const int w=bounds[2]-bounds[0],h=bounds[3]-bounds[1];if(w<=0||h<w*1.25)return {};
 std::vector<Box> candidates;
 for(const auto& row:rows){if(!row.contains("bbox")||row.value("ocrTruncated",false)||row.value("detectorConfidence",0.)<.2)continue;const auto b=row.at("bbox").get<Box>();const int bw=b[2]-b[0],bh=b[3]-b[1];if(bw<w*.25||bw>w*.75||bh<h*.6||area(b)>=area(bounds)*.8||double(overlap(b,bounds))/std::max(1,area(b))<.95)continue;candidates.push_back(b);}
 std::vector<Box> chosen;
 for(size_t i=0;i<candidates.size();++i)for(size_t j=i+1;j<candidates.size();++j){auto a=candidates[i],b=candidates[j];if(overlap(a,b)>std::min(area(a),area(b))*.05)continue;const Box combined{std::min(a[0],b[0]),std::min(a[1],b[1]),std::max(a[2],b[2]),std::max(a[3],b[3])};if(box_similarity(combined,bounds)<.9)continue;if(a[0]<b[0])std::swap(a,b);if(!chosen.empty()&&(box_similarity(chosen[0],a)<.95||box_similarity(chosen[1],b)<.95))return {};chosen={a,b};}
 return chosen;
}
inline std::vector<Box> detected_label_ruby(const Box& bounds,const std::vector<Region>& detected){
 const int w=bounds[2]-bounds[0],h=bounds[3]-bounds[1];if(w<16||h<w*2)return {};
 std::vector<Box> chosen;
 for(const auto& core:detected){const auto b=core.box;const int bw=b[2]-b[0],bh=b[3]-b[1];if(core.cls>1||core.score<.2f||bw<w*.5||bw>w*.8||bh<h*.85||bh>h*1.1||double(overlap(b,bounds))/std::max(1,area(b))<.95)continue;
  for(const auto& annotation:detected){const auto r=annotation.box;const int rw=r[2]-r[0],rh=r[3]-r[1];if(annotation.cls>1||annotation.score<.25f||rw<3||rw>bw*.7||rh<rw*2||rh>bh*.65||r[0]<b[2]-bw*.15||double(overlap(r,bounds))/std::max(1,area(r))<.95)continue;if(!chosen.empty()&&(box_similarity(chosen[0],b)<.95||box_similarity(chosen[1],r)<.95))return {};chosen={b,r};}
 }
 return chosen;
}
