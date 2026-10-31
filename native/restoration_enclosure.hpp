#pragma once
#include "restoration_mask.hpp"
#include "ocr_dedup.hpp"

struct EnclosureRestoration {
 std::map<int,RestorationMask> masks;
 json evidence=json::object();
};

inline bool restoration_enclosure_reading_proof(const json& proof){
 if(!proof.is_object()||proof.value("version",0)!=1||proof.value("method",std::string{})!="four-view-original-ocr"||!proof.contains("agreement")||!proof.at("agreement").is_array()||proof.at("agreement").size()!=4)return false;
 const auto& agreement=proof.at("agreement");return std::all_of(agreement.begin(),agreement.end(),[](const json& value){return value.is_boolean();})&&agreement[0].get<bool>()&&std::count(agreement.begin(),agreement.end(),json(true))>=3;
}
// Keep the original-size, uninverted source as the anchor. Three exact
// readings across four scale/polarity views support a high-confidence source;
// do not synthesize a majority text or replace the stored OCR string.
template<class Read> inline json restoration_enclosure_reading(const std::string& original,Read read){
 const auto characters=ocr_characters(original);if(characters.size()<2||characters.size()>64)return nullptr;
 json agreement=json::array();for(int scale:{1,2})for(bool inverse:{false,true})agreement.push_back(ocr_characters(read(scale,inverse))==characters);
 json proof={{"version",1},{"method","four-view-original-ocr"},{"agreement",agreement}};return restoration_enclosure_reading_proof(proof)?proof:json(nullptr);
}

inline EnclosureRestoration restoration_enclosures(const PageImage& image,const std::vector<Region>& detected,const json& rows,const LayoutRaw& raw,const std::function<void()>& check,const std::function<bool(const json&)>& verify_reading={},const std::set<int>& excluded={},const std::function<json(const json&)>& verify_effect_reading={}){
 EnclosureRestoration result;
 for(const auto& row:rows){
  const int id=row.value("id",-1);
  if(id<0||excluded.count(id)||row.value("type",std::string{})!="text"||row.value("mode",std::string{})!="tooltip")continue;
  if(row.value("text",std::string{})==row.value("translation",std::string{}))continue;
  bool edited=false;for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})edited|=row.value(flag,false);if(edited)continue;
  const Box box=row.at("bbox");const Region* text=nullptr;double best=.65;
  for(const auto& candidate:detected)if(candidate.cls==0){const double agreement=double(overlap(box,candidate.box))/std::max(1,std::max(area(box),area(candidate.box)));if(agreement>best){best=agreement;text=&candidate;}}
  if(!text||text->box!=box||!std::isfinite(text->score)||text->score<.2f||text->score>1||std::abs(text->score-row.value("detectorConfidence",0.))>=.0001||restoration_mask(image,*text,row,detected,rows).reason!="near-bubble")continue;
  std::vector<const Region*> enclosures;
  for(const auto& candidate:detected)if(candidate.cls==2&&std::isfinite(candidate.score)&&candidate.score>=.25f&&candidate.score<.65f&&area(candidate.box)>area(box)*1.2&&area(candidate.box)<=int64_t(image.width)*image.height*.25&&mask_coverage(candidate,box,image.width,image.height)>=.98&&double(overlap(candidate.box,box))/area(box)>=.98)enclosures.push_back(&candidate);
  if(enclosures.empty()||enclosures.size()>8)continue;
  auto mask=restoration_mask(image,*text,row,detected,rows,&raw,enclosures);std::string reading;json readingProof;
  if(mask.reason=="neighbor-text"&&!mask.effectNeighbors.empty()&&text->score>=.9f&&verify_effect_reading){check();readingProof=verify_effect_reading(row);if(restoration_enclosure_reading_proof(readingProof)){mask=restoration_mask(image,*text,row,detected,rows,&raw,enclosures,true);reading="multi-view-ocr-consensus";}}
  if(!mask.accepted())continue;
  if(reading.empty()){
   if(text->ocr_verified&&restoration_verified_text(row))reading="verified-ocr";
   else if(text->score>=.9f)reading="high-confidence-text";
   else if(text->score>=.65f&&verify_reading){check();if(verify_reading(row))reading="original-ocr-consensus";}
  }
  if(reading.empty())continue;
  json guards=json::array();for(const auto* enclosure:enclosures)guards.push_back({{"bbox",enclosure->box},{"confidence",enclosure->score}});
  result.evidence[std::to_string(id)]={{"version",1},{"method","glyph-only-enclosure-intersection"},{"sourceBox",box},{"sourceText",row.at("text")},{"sourceConfidence",text->score},{"reading",reading},{"guards",guards}};
  if(!readingProof.is_null())result.evidence[std::to_string(id)]["readingProof"]=readingProof;
  result.masks.emplace(id,std::move(mask));
 }
 return result;
}

inline Region restoration_enclosure_geometry(const RestorationMask& mask){
 require(!mask.enclosures.empty(),"Missing erasure enclosures");Region clip=*mask.enclosures.front();
 for(const auto* enclosure:mask.enclosures){
  require(enclosure->mask_side==clip.mask_side&&enclosure->mask.size()==clip.mask.size(),"Enclosure masks differ");
  clip.box={std::max(clip.box[0],enclosure->box[0]),std::max(clip.box[1],enclosure->box[1]),std::min(clip.box[2],enclosure->box[2]),std::min(clip.box[3],enclosure->box[3])};
  clip.score=std::min(clip.score,enclosure->score);for(size_t i=0;i<clip.mask.size();++i)clip.mask[i]=clip.mask[i]&&enclosure->mask[i];
 }
 return clip;
}
