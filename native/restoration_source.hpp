#pragma once
#include "restoration_mask.hpp"
#include "ocr_dedup.hpp"
#include <optional>

// This is local evidence for isolated-glyph restoration, not a global rewrite
// of detector regions. In particular, old results without proof stay guarded.
inline std::optional<Region> restoration_original_source(const json& row,const std::vector<Region>& detected,const LayoutRaw& raw){
 try{
  auto eligible=[](const json& r){
   if(r.value("type",std::string{})!="text"||r.value("mode",std::string{})!="tooltip"||r.value("text",std::string{}).empty()||r.contains("textVerification"))return false;
   for(const auto* k:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})if(r.value(k,false))return false;
   return r.contains("bbox")&&r.at("bbox").is_array()&&r.at("bbox").size()==4&&std::all_of(r.at("bbox").begin(),r.at("bbox").end(),[](const json& v){return v.is_number_integer();})&&r.contains("detectorConfidence")&&r.at("detectorConfidence").is_number()&&std::isfinite(r.at("detectorConfidence").get<double>());
  };
  if(!eligible(row))return {};
  auto match=[&](const json& r)->const Region*{if(!eligible(r))return nullptr;const Region* selected=nullptr;for(const auto& d:detected)if(d.cls==0&&d.box==r.at("bbox").get<Box>()&&std::abs(d.score-r.at("detectorConfidence").get<double>())<.0001&&restoration_effect_matches(d,&raw)){if(selected)return nullptr;selected=&d;}return selected;};
  if(!row.contains("ocrDuplicateGeometry")){const auto* d=match(row);return d?std::optional<Region>(*d):std::nullopt;}
  const auto& proof=row.at("ocrDuplicateGeometry");
  if(!proof.is_object()||proof.value("version",0)!=1||proof.value("method",std::string{})!="ocr-duplicate-box-union"||proof.at("sourceText")!=row.at("text")||proof.at("sourceBox")!=row.at("bbox"))return {};
  const auto& source=proof.at("source");const auto& fragments=proof.at("fragments");
  if(!fragments.is_array()||fragments.empty()||fragments.size()>8||source.contains("ocrDuplicateGeometry")||source.at("id")!=row.at("id")||source.at("text")!=row.at("text")||source.at("detectorConfidence")!=row.at("detectorConfidence"))return {};
  const auto* anchor=match(source);if(!anchor||anchor->score<.65f)return {};
  const Box box=row.at("bbox");if(area(box)>area(anchor->box)*1.25||overlap(box,anchor->box)!=area(anchor->box))return {};
  Region merged=*anchor;merged.box=box;json replay=json::array({source});std::set<int> ids{source.at("id").get<int>()};
  for(const auto& fragment:fragments){
   if(fragment.contains("ocrDuplicateGeometry")||!ids.insert(fragment.at("id").get<int>()).second)return {};
   const auto* d=match(fragment);std::optional<Region> composite;
   // A duplicate can itself be an independently verified union of OCR
   // columns. Rebuild every original column exactly; never infer the missing
   // mask from the composite rectangle alone.
   if(!d&&fragment.contains("textVerification")){
    auto plain=fragment;plain.erase("textVerification");const auto& v=fragment.at("textVerification");
    if(!eligible(plain)||!restoration_verified_text(fragment)||v.value("method",std::string{})!="ocr-consensus")return {};
    Box combined{};std::set<int> queries;float confidence=0;
    for(const auto& b:v.at("sources")){
     const Region* column=nullptr;for(const auto& r:detected)if(r.cls==0&&r.box==b.get<Box>()&&r.score>=.2f&&restoration_effect_matches(r,&raw)){if(column)return {};column=&r;}
     if(!column||!queries.insert(column->query).second)return {};
     if(!composite){composite=*column;combined=column->box;}else{if(column->mask_side!=composite->mask_side||column->mask.size()!=composite->mask.size())return {};for(size_t i=0;i<column->mask.size();i++)composite->mask[i]|=column->mask[i];combined={std::min(combined[0],column->box[0]),std::min(combined[1],column->box[1]),std::max(combined[2],column->box[2]),std::max(combined[3],column->box[3])};}
     confidence=std::max(confidence,column->score);
    }
    if(!composite||combined!=fragment.at("bbox").get<Box>()||std::abs(confidence-fragment.at("detectorConfidence").get<double>())>=.0001)return {};
    composite->box=combined;composite->score=confidence;d=&*composite;
   }
   if(!d||d->mask_side!=merged.mask_side||d->mask.size()!=merged.mask.size())return {};
   replay.push_back(fragment);for(size_t i=0;i<merged.mask.size();i++)merged.mask[i]|=d->mask[i];
  }
  deduplicate_ocr(replay);
  if(replay.size()!=1||replay[0].at("id")!=row.at("id")||replay[0].at("bbox")!=row.at("bbox")||replay[0].at("text")!=row.at("text")||replay[0].at("detectorConfidence")!=row.at("detectorConfidence"))return {};
  return merged;
 }catch(const json::exception&){return {};}
}

// Reconstruct a single original detector source after OCR reclassified an
// effect as a label. Do not reuse a refined or merged mask as raw evidence.
inline std::optional<Region> restoration_single_verified_source(const json& row,const std::vector<Region>& original,const LayoutRaw& raw){
 try{if(!restoration_verified_text(row)||row.at("textVerification").value("method",std::string{})!="ocr-consensus"||row.at("textVerification").at("sources")!=json::array({row.at("bbox")}))return {};
 for(const auto* key:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})if(row.value(key,false))return {};
 const Region* found=nullptr;for(const auto& r:original)if(r.cls<2&&r.box==row.at("bbox").get<Box>()&&std::abs(r.score-row.value("detectorConfidence",0.))<.0001&&restoration_effect_matches(r,&raw)){if(found)return {};found=&r;}return found?std::optional<Region>(*found):std::nullopt;
 }catch(const json::exception&){return {};}
}
