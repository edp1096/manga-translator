#pragma once
#include "restoration_mask.hpp"

// A weak whole-page balloon can be background geometry. Reconsider it only
// for one independently stable text region; never remove a global guard.
struct RestorationRevalidation {
 std::map<int,RestorationMask> masks;
 json evidence=json::object();
 size_t passes=0;
};
inline std::vector<Box> restoration_revalidation_crops(const PageImage& image,const Box& bounds){
 const double scale=std::min(image.width,image.height)/720.;
 const int close=int(std::ceil(std::max(384*scale,std::max(bounds[2]-bounds[0],bounds[3]-bounds[1])+128*scale)));
 const int wide=std::max(std::min(image.width,image.height),close);
 std::vector<Box> crops;
 for(const int side:{wide,(wide+close)/2,close}){
  const int w=std::min(side,image.width),h=std::min(side,image.height);
  const int left=std::clamp((bounds[0]+bounds[2]-w)/2,0,image.width-w),top=std::clamp((bounds[1]+bounds[3]-h)/2,0,image.height-h);
  const Box crop{left,top,left+w,top+h};
  if(std::find(crops.begin(),crops.end(),crop)!=crops.end())return {};
  crops.push_back(crop);
 }
 return crops;
}
inline json restoration_revalidation_view(const LayoutRaw& raw,const Box& crop,const Box& box){
 if(raw.logits.size()%5||raw.boxes.size()!=raw.logits.size()/5*4||area(box)<=0||area(crop)<=0)return nullptr;
 float text=0,bubble=0;double agreement=0;
 const int w=crop[2]-crop[0],h=crop[3]-crop[1];
 for(size_t q=0;q<raw.logits.size()/5;q++){
  const auto* b=raw.boxes.data()+q*4;
  for(int k=0;k<4;k++)if(!std::isfinite(b[k]))return nullptr;
  if(!std::isfinite(raw.logits[q*5])||!std::isfinite(raw.logits[q*5+2]))return nullptr;
  const Box bounds{int((b[0]-b[2]/2)*w)+crop[0],int((b[1]-b[3]/2)*h)+crop[1],int((b[0]+b[2]/2)*w)+crop[0],int((b[1]+b[3]/2)*h)+crop[1]};
  auto confidence=[&](int cls){return 1.f/(1.f+std::exp(-std::clamp(raw.logits[q*5+cls],-30.f,30.f)));};
  const double match=box_similarity(box,bounds);
  if(match>=.8&&confidence(0)>text){text=confidence(0);agreement=match;}
  // Check the balloon logit even when another class wins this query.
  if(double(overlap(box,bounds))/area(box)>.25)bubble=std::max(bubble,confidence(2));
 }
 return {{"crop",crop},{"textScore",text},{"textAgreement",agreement},{"bubbleScore",bubble},{"pass",text>=.85f&&bubble<.25f}};
}
inline RestorationRevalidation restoration_revalidate_weak_bubbles(const PageImage& image,LayoutEngine& detector,const std::vector<Region>& detected,const json& recognized,const std::function<void()>& check,const std::function<bool(const json&)>& verify_reading={}){
 RestorationRevalidation out;
 for(const auto& row:recognized){
  if(row.value("type",std::string{})!="text"||row.value("mode",std::string{})!="tooltip"||(row.value("panelCandidate",false)&&!restoration_verified_text(row)))continue;
  const Box box=row.at("bbox");const Region* text=nullptr;double agreement=.9;
  for(const auto& r:detected)if(r.cls==0&&box_similarity(box,r.box)>agreement){agreement=box_similarity(box,r.box);text=&r;}
  const bool readingEligible=verify_reading&&text&&std::isfinite(text->score)&&text->score>=.65f&&text->score<=1&&text->box==box&&std::abs(text->score-row.value("detectorConfidence",0.))<.0001&&!row.value("manual",false)&&!row.value("layoutOverride",false)&&!row.value("displayOverride",false)&&!row.value("ocrTruncated",false)&&!row.value("truncated",false)&&!row.value("panelCandidate",false)&&ocr_characters(row.value("text",std::string{})).size()>=2;
  if(!text||(text->score<.9f&&!readingEligible)||restoration_mask(image,*text,row,detected,recognized).reason!="near-bubble")continue;
  const Region* owner=nullptr;std::set<size_t> ignored;bool strong=false;
  for(size_t i=0;i<detected.size();i++){const auto& r=detected[i];
   if(r.cls!=2||(mask_coverage(r,box,image.width,image.height)<=.05&&double(overlap(r.box,box))/area(box)<=.25))continue;
   if(r.score>=.5f){strong=true;break;}ignored.insert(i);if(!owner||r.score>owner->score)owner=&r;
  }
  if(strong||!owner||mask_coverage(*owner,box,image.width,image.height)<.9||double(overlap(owner->box,box))/area(box)<.98)continue;
  const auto crops=restoration_revalidation_crops(image,owner->box);if(crops.size()!=3)continue;
  json views=json::array();bool supported=text->score>=.9f,stable=readingEligible;
  for(const auto& crop:crops){
   check();const int w=crop[2]-crop[0],h=crop[3]-crop[1];PageImage local{w,h,std::vector<uint8_t>(size_t(w)*h*3)};
   for(int y=0;y<h;y++)std::copy_n(image.rgb.data()+(size_t(y+crop[1])*image.width+crop[0])*3,w*3,local.rgb.data()+size_t(y)*w*3);
   auto input=layout_input(local,false,false,detector.input_side());auto raw=detector.run(input);out.passes++;
   auto view=restoration_revalidation_view(raw,crop,box);
   if(view.is_null()){supported=false;stable=false;break;}
   supported=supported&&view.value("pass",false);
   stable=stable&&view.at("textScore").get<double>()>=.2&&view.at("textAgreement").get<double>()>=.9&&view.at("bubbleScore").get<double>()<.25;
   views.push_back(std::move(view));if(!supported&&!stable)break;
  }
  const bool readingConfirmed=!supported&&stable&&views.size()==3&&verify_reading(row);
  if(!supported&&!readingConfirmed)continue;
  std::vector<Region> scoped;scoped.reserve(detected.size()-ignored.size());
  for(size_t i=0;i<detected.size();i++)if(!ignored.count(i))scoped.push_back(detected[i]);
  auto mask=restoration_mask(image,*text,row,scoped,recognized);
  // Only outside masks are retained: no pointers into the temporary scope.
  if(!mask.accepted()||mask.bubble)continue;
  const int id=row.at("id");out.masks.emplace(id,std::move(mask));
  json guards=json::array();for(const auto i:ignored)guards.push_back(region_json(detected[i]));
  out.evidence[std::to_string(id)]={{"version",1},{"method",readingConfirmed?"ocr-multiscale-weak-bubble-revalidation":"multiscale-weak-bubble-revalidation"},{"sourceText",row.at("text")},{"sourceBox",box},{"guards",guards},{"views",views}};if(readingConfirmed)out.evidence[std::to_string(id)]["readingConfirmed"]=true;
 }
 return out;
}
