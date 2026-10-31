#pragma once
#include "restoration_effect.hpp"

// Only page-local, unchanged high-confidence text detections can replace a
// foreign text rectangle with segmentation. Source overlap still vetoes below.
inline bool restoration_neighbor_source(const Region& region,const json& row,const LayoutRaw* raw){
 if(region.cls!=0||!std::isfinite(region.score)||region.score<.9f||region.score>1||!restoration_effect_matches(region,raw))return false;
 for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated"})if(row.value(flag,false))return false;
 if(row.value("type",std::string{})!="text"||row.value("text",std::string{}).empty()||!row.contains("detectorConfidence")||!row.at("detectorConfidence").is_number()||!row.contains("bbox")||row.at("bbox").get<Box>()!=region.box)return false;
 const auto score=row.at("detectorConfidence").get<double>();
 return std::isfinite(score)&&score>=.9&&score<=1&&std::abs(score-region.score)<.0001&&std::any_of(region.mask.begin(),region.mask.end(),[](uint8_t v){return v!=0;});
}
