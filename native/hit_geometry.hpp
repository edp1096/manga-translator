#pragma once
#include "vendor/json.hpp"
#include <array>
#include <vector>
#include <algorithm>
#include <cmath>

// Interaction metadata only: this must never authorize painting or erasure.
// Attach after OCR grouping so a changed box cannot inherit an old glyph mask.
template<class Regions>
inline size_t attach_hit_geometry(nlohmann::json& recognized,const Regions& detected,int image_width,int image_height){
 using nlohmann::json;size_t attached=0;
 for(auto& row:recognized){
  row.erase("hitMask");
  if(image_width<=0||image_height<=0||!row.contains("bbox")||!row["bbox"].is_array()||row["bbox"].size()!=4)continue;
  if(!std::all_of(row["bbox"].begin(),row["bbox"].end(),[](const json& v){return v.is_number_integer();}))continue;
  const auto box=row["bbox"].template get<std::array<int,4>>();
  if(box[0]<0||box[1]<0||box[2]>image_width||box[3]>image_height||box[2]<=box[0]||box[3]<=box[1])continue;
  const auto type=row.value("type",std::string{});if(type!="text"&&type!="effect")continue;
  const auto text=row.value("text",std::string{});if(text.empty())continue;
  const typename Regions::value_type* match=nullptr;
  for(const auto& region:detected){
   if(region.cls!=(type=="effect"?1:0)||region.box!=box||!std::isfinite(region.score))continue;
   if(region.mask_side<3||region.mask_side>512||region.mask.size()!=size_t(region.mask_side)*region.mask_side)continue;
   if(!match||region.score>match->score)match=&region;
  }
  if(!match)continue;
  const int side=match->mask_side;
  json runs=json::array();size_t count=0;
  // Keep row-bounded runs and the page-space grid; do not stretch a crop mask.
  for(int y=0;y<side;y++){
   const double py=(y+.5)*image_height/side;if(py<box[1]||py>=box[3])continue;
   int start=-1;
   for(int x=0;x<=side;x++){
    const double px=(x+.5)*image_width/side;
    const bool on=x<side&&px>=box[0]&&px<box[2]&&match->mask[size_t(y)*side+x];
    if(on&&start<0)start=x;
    if(!on&&start>=0){runs.push_back(y*side+start);runs.push_back(x-start);count+=x-start;start=-1;}
   }
  }
  if(!count)continue;
  row["hitMask"]={{"version",1},{"kind","detector-text-region"},{"imageWidth",image_width},{"imageHeight",image_height},{"width",side},{"height",side},{"sourceBox",box},{"sourceText",text},{"runs",std::move(runs)},{"pixels",count}};
  attached++;
 }
 return attached;
}
