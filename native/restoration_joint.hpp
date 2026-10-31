#pragma once
#include "restoration_mask.hpp"
// Joint masks are authorized atomically; every outside label must pass and
// all foreign text, balloon, and effect guards remain active.
struct JointRestoration{std::vector<std::pair<json,RestorationMask>> masks;json groups=json::array();};
inline JointRestoration joint_restoration(const PageImage& image,const std::vector<Region>& detected,const json& rows,const std::vector<Region>* refined=nullptr){
 const auto& guards=refined?*refined:detected;
 struct Candidate{size_t index;const Region* source;};std::vector<Candidate> candidates;
 for(size_t i=0;i<rows.size();i++){const auto& r=rows[i];if(r.value("type",std::string{})!="text"||r.value("mode",std::string{})!="tooltip"||r.value("manual",false)||r.value("layoutOverride",false)||r.value("displayOverride",false)||r.value("ocrTruncated",false)||r.value("truncated",false)||r.value("translation",std::string{}).empty()||!restoration_verified_text(r)||r.at("textVerification").value("role",std::string{})!="LABEL")continue;
  const Region* source=nullptr;bool ambiguous=false;for(const auto& d:detected)if(d.cls==0&&d.ocr_verified&&d.score>=.2f&&d.box==r.at("bbox").get<Box>()){if(source)ambiguous=true;source=&d;}if(source&&!ambiguous)candidates.push_back({i,source});
 }
 JointRestoration output;std::set<size_t> seen;
 for(size_t i=0;i<candidates.size();i++){if(seen.count(i))continue;std::vector<size_t> group{i};seen.insert(i);for(size_t p=0;p<group.size();p++)for(size_t j=0;j<candidates.size();j++)if(!seen.count(j)&&overlap(candidates[group[p]].source->box,candidates[j].source->box)){seen.insert(j);group.push_back(j);}if(group.size()<2||group.size()>4)continue;
  bool needed=false;for(auto c:group){const auto& candidate=candidates[c];const auto& row=rows[candidate.index];const Region* current=nullptr;double match=.65;for(const auto& r:guards)if(r.cls==0){const double agreement=double(overlap(r.box,row.at("bbox").get<Box>()))/std::max(1,std::max(area(r.box),area(row.at("bbox").get<Box>())));if(agreement>match){current=&r;match=agreement;}}if(current&&restoration_mask(image,*current,row,guards,rows).reason=="neighbor-text")needed=true;}if(!needed)continue;
  bool valid=true;for(size_t a=0;a<group.size();a++)for(size_t b=a+1;b<group.size();b++){const auto& x=*candidates[group[a]].source;const auto& y=*candidates[group[b]].source;if(x.mask_side!=y.mask_side||x.mask.size()!=y.mask.size()||x.mask.empty()){valid=false;continue;}size_t nx=0,ny=0,common=0;for(size_t p=0;p<x.mask.size();p++){nx+=x.mask[p]!=0;ny+=y.mask[p]!=0;common+=x.mask[p]&&y.mask[p];}if(!nx||!ny||common>std::min(nx,ny)*.05)valid=false;}if(!valid)continue;
  std::set<size_t> members;for(auto c:group)members.insert(candidates[c].index);std::vector<std::pair<json,RestorationMask>> masks;json proof=json::array();
  for(auto c:group){const auto& candidate=candidates[c];const auto& r=rows[candidate.index];json guarded=json::array();for(size_t j=0;j<rows.size();j++)if(j==candidate.index||!members.count(j))guarded.push_back(rows[j]);auto mask=restoration_mask(image,*candidate.source,r,guards,guarded);if(!mask.accepted()||mask.bubble){valid=false;break;}proof.push_back({{"id",r.at("id")},{"sourceText",r.at("text")},{"sourceBox",r.at("bbox")},{"verification",r.at("textVerification")}});masks.emplace_back(r,std::move(mask));}
  if(valid){output.groups.push_back(proof);for(auto& m:masks)output.masks.push_back(std::move(m));}
 }return output;
}
