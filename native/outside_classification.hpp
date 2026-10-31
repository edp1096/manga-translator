#pragma once
#include "ocr_dedup.hpp"

inline bool outside_classification_supported(const json& regions,const std::vector<size_t>& members,const std::string& text,const std::string& role){
 if(role!="DIALOGUE"&&role!="LABEL")return false;
 if(members.empty()||std::any_of(members.begin(),members.end(),[&](size_t i){return i>=regions.size();}))return false;
 // Reading the same short sound twice proves its spelling, not that it is
 // speech or a name. Keep ambiguous effect-only fragments as tooltips even
 // when the language model invents a semantic label for them.
 const bool effects_only=std::all_of(members.begin(),members.end(),[&](size_t i){return regions[i].value("type",std::string{})=="effect"||regions[i].value("panelCandidate",false);});
 return !effects_only||ocr_characters(text).size()>3;
}

inline json outside_nearby_text(const json& regions,const Box& box,const std::vector<size_t>& members){
 std::vector<std::pair<double,size_t>> nearby;
 for(size_t i=0;i<regions.size();i++){
  const auto& r=regions[i];if(std::find(members.begin(),members.end(),i)!=members.end()||r.value("panelCandidate",false)||r.value("ocrTruncated",false)||r.value("type",std::string{})!="text")continue;
  const auto text=r.value("text",std::string{});if(text.empty()||text.size()>768||!r.contains("bbox"))continue;
  const auto b=r.at("bbox").get<Box>();const double dx=(double(b[0])+b[2]-box[0]-box[2])/2,dy=(double(b[1])+b[3]-box[1]-box[3])/2;
  nearby.push_back({dx*dx+dy*dy,i});
 }
 std::stable_sort(nearby.begin(),nearby.end());json result=json::array();
 for(const auto& item:nearby){const auto& text=regions[item.second].at("text");if(std::find(result.begin(),result.end(),text)==result.end())result.push_back(text);if(result.size()==3)break;}
 return result;
}
