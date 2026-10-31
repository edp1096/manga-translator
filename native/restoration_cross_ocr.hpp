#pragma once
#include "restoration_isolated.hpp"

// A weak enclosing detection may describe background art instead of a balloon.
// Two OCR engines must independently read the original and complete detached
// components identically. This path never changes the recognized transcript.
template<class Read, class Verify>
inline RestorationRevalidation restoration_cross_ocr(const PageImage& image,const std::vector<Region>& detected,const json& rows,const LayoutRaw& raw,const std::function<void()>& check,Read read,Verify verify,const std::set<int>& excluded={}){
 RestorationRevalidation result;
 for(const auto& row:rows){
  const int id=row.value("id",-1);
  if(id<0||excluded.count(id)||row.value("translation",std::string{}).empty()||row.value("translation",std::string{})==row.value("text",std::string{})||!restoration_verified_text(row))continue;
  const Region* source=nullptr;bool ambiguous=false;
  for(const auto& r:detected)if(r.cls==0&&r.box==row.at("bbox").get<Box>()){if(source)ambiguous=true;source=&r;}
  if(!source||ambiguous||restoration_mask(image,*source,row,detected,rows,&raw).reason!="near-bubble")continue;
  bool weak=false,strong=false;
  for(const auto& r:detected)if(r.cls==2&&(mask_coverage(r,source->box,image.width,image.height)>.05||double(overlap(r.box,source->box))/area(source->box)>.25)){
   strong|=r.score>=.65f;
   weak|=r.score>=.25f&&r.score<.65f&&double(overlap(r.box,source->box))/area(source->box)>=.98;
  }
  if(strong||!weak)continue;
  auto candidate=restoration_isolated_components(image,*source,row,{},detected,rows,&raw,true);
  if(!candidate.mask.accepted()){result.evidence[std::to_string(id)]={{"rejected",candidate.mask.reason}};continue;}
  const auto expected=ocr_characters(row.at("text"),false);bool exact=true;
  json primary=json::array(),isolated=json::array(),secondary=json::array(),secondaryIsolated=json::array();
  for(int scale:{1,2})for(bool inverse:{false,true}){
   check();const auto a=read(image,source->box,scale,inverse),b=read(candidate.reading,{0,0,candidate.reading.width,candidate.reading.height},scale,inverse);
   primary.push_back(a);isolated.push_back(b);exact&=ocr_characters(a,false)==expected&&ocr_characters(b,false)==expected;
  }
  if(exact)for(int scale:{1,2})for(bool inverse:{false,true}){
   check();const auto a=verify(image,source->box,scale,inverse),b=verify(candidate.reading,{0,0,candidate.reading.width,candidate.reading.height},scale,inverse);
   secondary.push_back(a);secondaryIsolated.push_back(b);exact&=ocr_characters(a,false)==expected&&ocr_characters(b,false)==expected;
  }
  if(!exact){result.evidence[std::to_string(id)]={{"rejected","cross-component-reading-disagreement"},{"originalReadings",primary},{"isolatedReadings",isolated},{"verifierReadings",secondary},{"verifierIsolatedReadings",secondaryIsolated}};continue;}
  candidate.proof["originalReadings"]=primary;candidate.proof["isolatedReadings"]=isolated;candidate.proof["verifierReadings"]=secondary;candidate.proof["verifierIsolatedReadings"]=secondaryIsolated;
  result.masks.emplace(id,std::move(candidate.mask));result.evidence[std::to_string(id)]=std::move(candidate.proof);
 }
 return result;
}
