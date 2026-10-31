#pragma once
#include "restoration_source.hpp"
#include "restoration_revalidation.hpp"

// A merged reading can straddle a balloon contour. Authenticate the original
// detections again: fragment verification never becomes parent verification.
inline std::optional<Region> restoration_boundary_source(const json& row,const std::vector<Region>& found,const LayoutRaw& raw){
 try{
  auto eligible=[](const json& r){
   if(r.value("type",std::string{})!="text"||r.value("text",std::string{}).empty())return false;
   for(const auto* k:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})if(r.value(k,false))return false;
   return true;
  };
  if(!eligible(row)||row.value("mode",std::string{})!="tooltip"||row.contains("textVerification")||row.value("translation",std::string{}).empty())return {};
  const auto& p=row.at("ocrDuplicateGeometry");const auto& source=p.at("source");const auto& fragments=p.at("fragments");
  if(p.value("version",0)!=1||p.value("method",std::string{})!="ocr-duplicate-box-union"||p.at("sourceBox")!=row.at("bbox")||p.at("sourceText")!=row.at("text")||source.at("id")!=row.at("id")||source.at("text")!=row.at("text")||source.at("detectorConfidence")!=row.at("detectorConfidence")||!fragments.is_array()||fragments.size()<2||fragments.size()>4)return {};
  auto match=[&](const json& r)->const Region*{
   if(!eligible(r)||r.contains("ocrDuplicateGeometry"))return nullptr;
   if(r.contains("textVerification")&&(!restoration_verified_text(r)||r.at("textVerification").at("sources")!=json::array({r.at("bbox")})))return nullptr;
   const Region* selected=nullptr;
   for(const auto& d:found)if(d.cls==0&&d.score>=.2f&&d.box==r.at("bbox").get<Box>()&&std::abs(d.score-r.at("detectorConfidence").get<double>())<.0001&&restoration_effect_matches(d,&raw)){if(selected)return nullptr;selected=&d;}
   return selected;
  };
  const auto* anchor=match(source);if(!anchor||anchor->score<.35f)return {};
  const Box b=row.at("bbox");if(area(b)>area(anchor->box)*1.1||overlap(b,anchor->box)!=area(anchor->box))return {};
  Region merged=*anchor;merged.box=b;json replay=json::array({source});std::set<int> ids{row.at("id")};
  for(const auto& fragment:fragments){const auto* d=match(fragment);if(!d||!ids.insert(fragment.at("id").get<int>()).second||d->mask.size()!=merged.mask.size()||d->mask_side!=merged.mask_side)return {};replay.push_back(fragment);for(size_t i=0;i<merged.mask.size();i++)merged.mask[i]|=d->mask[i];}
  deduplicate_ocr(replay);
  if(replay.size()!=1||replay[0].at("id")!=row.at("id")||replay[0].at("bbox")!=row.at("bbox")||replay[0].at("text")!=row.at("text"))return {};
  return merged;
 }catch(const std::exception&){return {};}
}
inline bool restoration_boundary_readings(const json& readings,const std::string& source){
 if(!readings.is_array()||readings.size()!=4)return false;
 const auto expected=ocr_characters(source,false);if(expected.size()<8||expected.size()>64)return false;
 int exact=0;for(const auto& value:readings){if(!value.is_string())return false;const auto r=ocr_characters(value.get<std::string>(),false);if(r==expected)exact++;else{if(r.empty()||r.size()+3<expected.size()||r.size()>expected.size())return false;size_t at=0;for(auto c:expected)if(at<r.size()&&c==r[at])at++;if(at!=r.size())return false;}}
 // Two polarities at 2x must agree; at least one 3x view must confirm them.
 return exact>=3&&ocr_characters(readings[0].get<std::string>(),false)==expected&&ocr_characters(readings[1].get<std::string>(),false)==expected;
}
inline RestorationRevalidation restoration_boundary(const PageImage& image,const std::vector<Region>& found,const json& rows,const LayoutRaw& raw,const std::function<void()>& check,const std::function<std::string(const PageImage&,Box,int,bool)>& read,const std::vector<Region>* original=nullptr){
 RestorationRevalidation out;
 for(const auto& row:rows){
  if(!row.contains("ocrDuplicateGeometry"))continue;
  auto stage=[&](const char* reason){out.evidence[std::to_string(row.at("id").get<int>())]={{"rejected",reason}};};stage("boundary-source");
  const auto source=restoration_boundary_source(row,original?*original:found,raw);if(!source||!restoration_box(source->box,image)||area(source->box)>int64_t(image.width)*image.height*.08)continue;
  stage("boundary-owner");const Region* owner=nullptr;bool conflict=false;
  for(const auto& r:found)if(r.cls==2&&r.score>=.65f&&mask_coverage(r,source->box,image.width,image.height)>.05){if(owner){conflict=true;break;}owner=&r;}
  if(conflict||!owner)continue;
  // A local view may detect only the upper part of the same balloon. It is
  // redundant only when its actual segmented interior is contained by the
  // strong owner; a distinct neighboring enclosure still vetoes restoration.
  for(const auto& r:found)if(&r!=owner&&r.cls==2&&r.score>=.25f&&mask_coverage(r,source->box,image.width,image.height)>.05){
   if(r.score>=.65f||area(r.box)>area(owner->box)||double(overlap(r.box,owner->box))/std::max(1,area(r.box))<.95){conflict=true;break;}
   size_t total=0,inside=0;for(int y=r.box[1];y<r.box[3];y++)for(int x=r.box[0];x<r.box[2];x++)if(region_pixel(r,x,y,image.width,image.height)){total++;inside+=region_pixel(*owner,x,y,image.width,image.height);}
   if(!total||inside<total*.9){conflict=true;break;}
  }
  if(conflict)continue;
  stage("boundary-coverage");const double coverage=mask_coverage(*owner,source->box,image.width,image.height);if(coverage<.5||coverage>=.95||area(owner->box)>int64_t(image.width)*image.height*.15)continue;
  const Box b=source->box;const int margin=std::max(1,int(std::ceil(1.5*std::min(image.width,image.height)/720.)));
  RestorationMask mask;mask.bounds=expand_box(b,margin,image.width,image.height);mask.margin=margin;mask.character_size=std::sqrt(double(area(b))/std::max(size_t(1),codepoints(row.at("text")).size()));
  const int w=mask.bounds[2]-mask.bounds[0],h=mask.bounds[3]-mask.bounds[1];mask.pixels.resize(size_t(w)*h);size_t paper=0;
  for(int y=b[1];y<b[3];y++)for(int x=b[0];x<b[2];x++){const auto* p=image.rgb.data()+(size_t(y)*image.width+x)*3;if(std::min({p[0],p[1],p[2]})>=224){paper++;continue;}for(int dy=-margin;dy<=margin;dy++)for(int dx=-margin;dx<=margin;dx++){const int nx=x+dx-mask.bounds[0],ny=y+dy-mask.bounds[1];if(nx>=0&&ny>=0&&nx<w&&ny<h)mask.pixels[size_t(ny)*w+nx]=1;}}
  stage("boundary-paper");if(paper<area(b)*.65)continue;
  auto hits=[&](Box box,const Region* region){for(int y=std::max(box[1],mask.bounds[1]);y<std::min(box[3],mask.bounds[3]);y++)for(int x=std::max(box[0],mask.bounds[0]);x<std::min(box[2],mask.bounds[2]);x++)if(mask.pixels[size_t(y-mask.bounds[1])*w+x-mask.bounds[0]]&&(!region||region_pixel(*region,x,y,image.width,image.height)))return true;return false;};
  for(const auto& other:rows)if(other.at("id")!=row.at("id")&&hits(expand_box(other.at("bbox").get<Box>(),1,image.width,image.height),nullptr)){conflict=true;break;}
  for(const auto& r:found)if(r.cls==1&&r.score>=.2f&&hits(r.box,&r)){conflict=true;break;}
  stage("boundary-neighbor");if(conflict)continue;
  stage("boundary-mask-size");mask.count=std::count(mask.pixels.begin(),mask.pixels.end(),uint8_t(1));if(mask.count<8||mask.count>area(b)*.8)continue;
  json readings=json::array();for(int scale:{2,3})for(bool inverse:{false,true}){check();readings.push_back(read(image,b,scale,inverse));}
  stage("boundary-readings");if(!restoration_boundary_readings(readings,row.at("text")))continue;
  const int id=row.at("id");mask.bubble=owner;out.masks.emplace(id,std::move(mask));
  out.evidence[std::to_string(id)]={{"version",1},{"method","merged-boundary-foreground"},{"sourceText",row.at("text")},{"sourceBox",b},{"sourceConfidence",row.at("detectorConfidence")},{"duplicateProof",row.at("ocrDuplicateGeometry")},{"readings",readings},{"coverage",coverage},{"paperFraction",double(paper)/area(b)}};
 }
 return out;
}
