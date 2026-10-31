#pragma once
#include "styled_ocr.hpp"
#include "ocr_dedup.hpp"
#include "outside_classification.hpp"
#include "name_reading.hpp"
#include "layout_refinement.hpp"
#include "ruby_columns.hpp"
#include "ruby_projection.hpp"
#include "ocr_context.hpp"
#include "annotation_ocr.hpp"
#include "ocr_detached_columns.hpp"
#include <functional>

struct OutsideProposal {json region;std::vector<size_t> members;};
inline Box united_box(Box a,const Box& b){return {std::min(a[0],b[0]),std::min(a[1],b[1]),std::max(a[2],b[2]),std::max(a[3],b[3])};}
inline bool outside_source(const json& r,const PageImage& im,const std::vector<Region>& detected){
 if(r.value("mode",std::string{})!="tooltip"||r.value("ocrTruncated",false)||ocr_characters(r.value("text",std::string{})).size()<2)return false;
 const auto b=r.at("bbox").get<Box>();const double limit=r.value("type",std::string{})=="text"?.16:.08;if(area(b)<=0||area(b)>int64_t(im.width)*im.height*limit)return false;
 // Proximity alone must not prevent OCR correction. Erasure is authorized
 // separately against the actual text/balloon masks, including their margins.
 return std::none_of(detected.begin(),detected.end(),[&](const Region& d){return d.cls==2&&(mask_coverage(d,b,im.width,im.height)>.5||double(overlap(d.box,b))/area(b)>.65);});
}
inline PageImage contrast_crop(const PageImage& im,Box b,int threshold){
 PageImage crop{b[2]-b[0],b[3]-b[1],{}};crop.rgb.resize(size_t(crop.width)*crop.height*3);
 for(int y=0;y<crop.height;y++)for(int x=0;x<crop.width;x++)for(int c=0;c<3;c++){const auto value=im.rgb[(size_t(y+b[1])*im.width+x+b[0])*3+c];crop.rgb[(size_t(y)*crop.width+x)*3+c]=threshold<0?value:value<threshold?0:255;}return crop;
}
inline std::string read_styled_crop(const PageImage& im,Box b,const fs::path& scratch,Engine& engine,int threshold){
 auto crop=contrast_crop(im,expand_box(b,5,im.width,im.height),threshold);crop_ppm(scratch,crop,{0,0,crop.width,crop.height});const auto r=engine.run(scratch,64);return r.stopped?engine.tokenizer.decode(r.ids):std::string{};
}
inline bool han_only(const std::string& text){const auto chars=ocr_characters(text);return !chars.empty()&&std::all_of(chars.begin(),chars.end(),[](uint32_t c){return (c>=0x3400&&c<=0x9fff)||(c>=0x20000&&c<=0x3134f);});}
inline std::string read_styled_glyphs(const PageImage& im,Box box,const fs::path& scratch,Engine& engine,const std::string& prior){
 const auto prior_chars=ocr_characters(prior);
 if(prior_chars.size()<2||prior_chars.size()>8||box[2]-box[0]<48.*std::min(im.width,im.height)/720.)return {};
 if(!han_only(prior)){
  const auto nonhan=std::count_if(prior_chars.begin(),prior_chars.end(),[](uint32_t c){return !((c>=0x3400&&c<=0x9fff)||(c>=0x20000&&c<=0x3134f));});
  // Decorative quotes are sometimes read as a kana. Do not remove kana
  // shared by both column readings, or attempt mixed-script personal names.
  if(nonhan!=1||prior_chars.size()<5||!han_only(read_styled_crop(im,box,scratch,engine,128)))return {};
 }
 const auto bounds=expand_box(box,5,im.width,im.height);const auto glyphs=styled_glyphs(im,bounds);if(glyphs.size()<2||glyphs.size()>10)return {};
 int maximum=0;for(const auto& g:glyphs)maximum=std::max(maximum,g.box[3]-g.box[1]);std::string text;size_t accepted=0;std::vector<std::string> letters;std::vector<bool> supported;
 for(size_t i=0;i<glyphs.size();i++){
  const auto& g=glyphs[i];const int width=g.box[2]-g.box[0],height=g.box[3]-g.box[1];
  // Short edge marks may be decorative quotation marks. Never discard a
  // full-size unreadable glyph, nor a wide horizontal character such as 一.
  auto clean=styled_glyph_image(g,bounds[2]-bounds[0]);crop_ppm(scratch,clean,{0,0,clean.width,clean.height});const auto reading=engine.run(scratch,32);if(!reading.stopped)return {};
  const auto first=engine.tokenizer.decode(reading.ids);const Box location{g.box[0]+bounds[0],g.box[1]+bounds[1],g.box[2]+bounds[0],g.box[3]+bounds[1]};const auto second=read_styled_crop(im,location,scratch,engine,-1);
  // A numeral 一 becomes indistinguishable from a dash in isolation. Retain
  // it only when both complete-crop readings identify the leading numeral.
  if(i==0&&width>height*2&&width>=maximum*.55&&ocr_characters(prior).front()==0x4e00){
   const auto contextual=ocr_characters(read_styled_crop(im,box,scratch,engine,128));
   if(!contextual.empty()&&contextual.front()==0x4e00){text+="一";letters.push_back("一");supported.push_back(true);accepted++;continue;}
  }
  if((i==0||i+1==glyphs.size())&&height<maximum*.7&&width<maximum*.55&&!han_only(first)&&!han_only(second))continue;
  if(!han_only(first)||ocr_characters(first).size()!=1)return {};
  text+=first;letters.push_back(first);supported.push_back(ocr_characters(first)==ocr_characters(second));accepted++;
 }
 // Isolating a stylized glyph can itself destroy useful reading context.
 // A disagreement is accepted only when a multi-character span of the clean
 // glyph reading is also present in both original complete-column readings.
 const auto contextual=ocr_characters(read_styled_crop(im,box,scratch,engine,128));
 const auto original=ocr_characters(prior);
 for(size_t i=0;i<supported.size();i++)if(!supported[i]){
  size_t end=i+1;while(end<supported.size()&&!supported[end])end++;
  const size_t begin=i>0?i-1:i,finish=end<letters.size()?end+1:end;
  if(finish-begin<2)return {};std::string span;for(size_t j=begin;j<finish;j++)span+=letters[j];const auto chars=ocr_characters(span);
  if(std::search(original.begin(),original.end(),chars.begin(),chars.end())==original.end()||std::search(contextual.begin(),contextual.end(),chars.begin(),chars.end())==contextual.end())return {};
  i=end-1;
 }
 return accepted>=2?text:std::string{};
}
// Newly recovered panel text has no trusted full-page detection. Preserve
// strokes in the original crop and require agreement across both scales and
// polarities; thresholded variants can repeat the same lost-stroke mistake.
inline std::string verified_panel_reading(const PageImage& im,Box box,const fs::path& scratch,Engine& engine){
 std::string agreed;std::vector<uint32_t> characters;
 for(int view=0;view<4;view++){
  auto crop=name_crop(im,box,view%2?2:1,12);
  if(view>=2)for(auto& pixel:crop.rgb)pixel=255-pixel;
  crop_ppm(scratch,crop,{0,0,crop.width,crop.height});const auto result=engine.run(scratch,64);
  if(!result.stopped)return {};
  const auto text=engine.tokenizer.decode(result.ids);const auto current=ocr_characters(text);
  if(current.size()<2)return {};
  if(view==0){agreed=text;characters=current;}else if(current!=characters)return {};
 }
 return agreed;
}
// Keep the original, non-thresholded reading as the anchor. Agreement between
// arbitrary transformed views alone can repeat the same crop-induced error.
template<class Read>
inline std::string original_styled_consensus(const std::string& original,Read read){
 const auto chars=ocr_characters(original);if(chars.size()<2||chars.size()>64)return {};
 if(ocr_characters(read(2,false))!=chars)return {};
 if(ocr_characters(read(1,true))==chars||ocr_characters(read(2,true))==chars)return original;
 return {};
}
inline std::string verified_original_styled(const PageImage& im,const Box& box,const fs::path& scratch,Engine& engine,const std::string& original){
 return original_styled_consensus(original,[&](int scale,bool inverse){auto crop=name_crop(im,box,scale,12);if(inverse)for(auto& pixel:crop.rgb)pixel=255-pixel;crop_ppm(scratch,crop,{0,0,crop.width,crop.height});const auto r=engine.run(scratch,64);return r.stopped?engine.tokenizer.decode(r.ids):std::string{};});
}
inline std::string verified_styled_reading(const PageImage& im,Box box,const fs::path& scratch,Engine& engine){
 const auto first=read_styled_crop(im,box,scratch,engine,-1),second=read_styled_crop(im,box,scratch,engine,128);
 if(ocr_characters(first)!=ocr_characters(second)){const auto third=read_styled_crop(im,box,scratch,engine,80);if(ocr_characters(second).size()>=2&&ocr_characters(second)==ocr_characters(third))return second;}
 const auto letters=read_styled_glyphs(im,box,scratch,engine,first);if(!letters.empty())return letters;
 if(ocr_characters(first).size()>=2&&ocr_characters(first)!=ocr_characters(second)){
  auto padded=name_crop(im,box,2,24);crop_ppm(scratch,padded,{0,0,padded.width,padded.height});const auto r=engine.run(scratch,64);
  if(r.stopped&&ocr_characters(engine.tokenizer.decode(r.ids))==ocr_characters(first))return first;
 }
 if(ocr_characters(first).size()<2||ocr_characters(first)!=ocr_characters(second))return verified_original_styled(im,box,scratch,engine,first);
 return first;
}
inline std::string verified_ruby_main_reading(const PageImage& im,Box box,const fs::path& scratch,Engine& engine){
 auto read=[&](Box bounds,bool inverse){auto crop=name_crop(im,bounds);if(inverse)for(auto& pixel:crop.rgb)pixel=255-pixel;crop_ppm(scratch,crop,{0,0,crop.width,crop.height});const auto r=engine.run(scratch,64);return r.stopped?engine.tokenizer.decode(r.ids):std::string{};};
 const auto text=read(box,false),other=read(box,true);
 if(ocr_characters(text).size()>=2&&ocr_characters(text)==ocr_characters(other))return text;
 // Detector rounding may clip an edge stroke. A small relative margin must
 // agree in both polarities and with one tight-crop reading, not invent text.
 const int margin=std::clamp(int(std::lround((box[2]-box[0])*.02)),1,4);
 const auto expanded=expand_box(box,margin,im.width,im.height);
 const auto padded=read(expanded,false),inverse=read(expanded,true);const auto chars=ocr_characters(padded);
 return chars.size()>=2&&chars==ocr_characters(inverse)&&(chars==ocr_characters(text)||chars==ocr_characters(other))?padded:std::string{};
}
inline std::vector<Region> outside_detail_regions(const PageImage& im,Box bounds,OnnxLayout& detector){
 auto detect=[&](int margin){const auto crop=expand_box(bounds,std::max(1,margin),im.width,im.height);auto local=name_crop(im,crop);auto input=layout_input(local,false,false,detector.input_side());auto detail=decode_regions(detector.run(input),local.width,local.height);std::vector<Region> result;for(const auto& r:detail)result.push_back(project_region(r,crop,im.width,im.height,192));return result;};
 auto result=detect(int(70.*std::min(im.width,im.height)/720.));
 // Page-relative context can swallow small ruby into a neighboring caption.
 // Retry once relative to this label, but require the independently detected
 // main column to remain stable across both views. OCR still verifies both
 // the main text and annotation; this only proposes their geometry.
 const int width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];
 if(width>=16&&height>=width*2&&area(bounds)<int64_t(im.width)*im.height*.08&&detected_label_ruby(bounds,result).empty()){
  auto local=detect(int(std::lround(width*.6)));const auto columns=detected_label_ruby(bounds,local);
  if(columns.size()==2&&std::any_of(result.begin(),result.end(),[&](const Region& r){return r.cls<2&&r.score>=.2f&&box_similarity(r.box,columns[0])>=.9;}))return local;
 }
 return result;
}
inline std::vector<Box> outside_detail_columns(Box bounds,const std::vector<Region>& detail){
 std::vector<Box> columns;for(const auto& r:detail){if(r.cls!=0||r.score<.3f)continue;auto b=r.box;
  if(area(b)<area(bounds)*.1||area(b)>area(bounds)*.8||b[3]-b[1]<1.4*(b[2]-b[0])||double(overlap(b,bounds))/area(b)<.95)continue;
  if(std::none_of(columns.begin(),columns.end(),[&](Box other){return box_similarity(b,other)>.6;}))columns.push_back(b);
 }
 if(columns.size()<2||columns.size()>4)return {};Box combined=columns.front();
 for(size_t i=0;i<columns.size();i++){combined=united_box(combined,columns[i]);for(size_t j=0;j<i;j++)if(double(overlap(columns[i],columns[j]))/std::min(area(columns[i]),area(columns[j]))>.1)return {};}
 if(box_similarity(combined,bounds)<.88)return {};
 std::sort(columns.begin(),columns.end(),[](Box a,Box b){return a[0]+a[2]>b[0]+b[2];});return columns;
}
inline std::string context_column_reading(const PageImage& image,Box bounds,const fs::path& scratch,Engine& engine,const json& dictionary,const json& rows,const std::function<std::vector<Region>(Box)>& details,json& proof){
 if(!details||!dictionary.contains("entries")||dictionary.at("entries").empty())return {};
 const auto columns=detected_label_ruby(bounds,details(bounds));if(columns.size()!=2)return {};
 auto read=[&](int method){auto crop=name_crop(image,columns[0],method==2?2:1);if(method==1)for(auto&p:crop.rgb)p=255-p;if(method==2)for(size_t p=0;p<crop.rgb.size();p+=3){const uint8_t v=std::min({crop.rgb[p],crop.rgb[p+1],crop.rgb[p+2]})>160?0:255;crop.rgb[p]=crop.rgb[p+1]=crop.rgb[p+2]=v;}crop_ppm(scratch,crop,{0,0,crop.width,crop.height});auto r=engine.run(scratch,64);return r.stopped?engine.tokenizer.decode(r.ids):std::string{};};
 const auto first=read(0),inverse=read(1);if(first.empty()||first!=inverse)return {};
 const auto foreground=read(2);auto candidate=contextual_ocr_proposal(first,foreground,bounds,dictionary,rows,true);if(candidate.is_null())return {};
 const auto ruby=verified_ruby_main_reading(image,columns[1],scratch,engine);if(!kana_reading(ruby))return {};
 candidate["bounds"]=bounds;candidate["mainBox"]=columns[0];candidate["rubyBox"]=columns[1];candidate["rubyText"]=ruby;candidate["polarity"]=inverse;candidate["preprocessing"]="white-foreground-160";proof=std::move(candidate);return proof.at("text").get<std::string>();
}
inline std::vector<OutsideProposal> outside_proposals(const PageImage& im,const json& regions,const std::vector<Region>& detected,const fs::path& folder,Engine& engine,const std::function<void()>& progress,const std::function<std::vector<Region>(Box)>& detail_regions={},const json& dictionary=json::object(),const std::function<json(Box)>& annotation_reading={}){
 std::vector<size_t> eligible;for(size_t i=0;i<regions.size();i++)if(outside_source(regions[i],im,detected))eligible.push_back(i);
 std::stable_sort(eligible.begin(),eligible.end(),[&](size_t a,size_t b){return area(regions[a].at("bbox").get<Box>())>area(regions[b].at("bbox").get<Box>());});
 std::set<size_t> used;std::vector<OutsideProposal> proposals;size_t attempts=0;
 for(const auto index:eligible){
  if(used.count(index)||attempts>=16)continue;const auto& original=regions[index];Box bounds=original.at("bbox");std::vector<size_t> members{index};std::vector<Box> columns;
  const auto ruby_main=detected_ruby_main(bounds,detected,regions);
  if(!ruby_main&&ocr_characters(original.at("text")).size()>=8)columns=detected_caption_columns(bounds,regions);
  // A full label plus a tall contained column is evidence of a multi-column
  // label. Read its columns separately instead of losing the second column.
  std::vector<Box> children;
  for(size_t child=0;child<regions.size();child++){if(ruby_main||!columns.empty()||child==index||used.count(child)||regions[child].value("mode",std::string{})!="tooltip"||ocr_characters(original.at("text")).size()>=8)continue;const auto b=regions[child].at("bbox").get<Box>();const int width=bounds[2]-bounds[0],height=bounds[3]-bounds[1],cw=b[2]-b[0],ch=b[3]-b[1];
   if(double(overlap(b,bounds))/area(b)<.9||cw<width*.3||cw>width*.72||ch<height*.6||area(b)>=area(bounds)*.75||height<width*1.25)continue;
   children.push_back(b);
  }
  std::sort(children.begin(),children.end(),[](const Box& a,const Box& b){return area(a)>area(b);});
  for(const auto& b:children){const int cw=b[2]-b[0];
   if(b[0]+b[2]<bounds[0]+bounds[2])columns={Box{std::max(bounds[0],b[2]-int(cw*.2)),bounds[1],bounds[2],bounds[3]},b};
   else columns={b,Box{bounds[0],bounds[1],std::min(bounds[2],b[0]+int(cw*.2)),bounds[3]}};
   for(const auto& other:children)if((other[0]+other[2]<bounds[0]+bounds[2])!=(b[0]+b[2]<bounds[0]+bounds[2])&&std::abs(other[0]+other[2]-b[0]-b[2])>.6*std::min(cw,other[2]-other[0])){columns=b[0]+b[2]<other[0]+other[2]?std::vector<Box>{other,b}:std::vector<Box>{b,other};break;}
   break;
  }
  if(!ruby_main&&columns.empty()&&detail_regions&&ocr_characters(original.at("text")).size()>=8&&original.value("detectorConfidence",0.)<.65&&bounds[3]-bounds[1]>1.8*(bounds[2]-bounds[0]))columns=outside_detail_columns(bounds,detail_regions(bounds));
  // A sparse large caption can have a large rectangle but few glyph pixels.
  // It still needs OCR consensus and semantic classification here; restoration
  // separately limits the actual glyph mask instead of erasing its rectangle.
  if(!ruby_main&&columns.empty()){
   bool extended=true;while(extended){extended=false;for(const auto other:eligible){if(used.count(other)||std::find(members.begin(),members.end(),other)!=members.end())continue;const auto b=regions[other].at("bbox").get<Box>();
    if(b[3]-b[1]<3*(b[2]-b[0]))continue;bool adjacent=false;for(const auto member:members){const auto a=regions[member].at("bbox").get<Box>();const int aw=a[2]-a[0],bw=b[2]-b[0],gap=std::max(a[0],b[0])-std::min(a[2],b[2]);if(a[3]-a[1]>=3*aw&&gap>=0&&gap<=.65*std::max(aw,bw)&&std::abs(a[1]-b[1])<=.3*std::min(aw,bw))adjacent=true;}
    if(adjacent&&area(united_box(bounds,b))<int64_t(im.width)*im.height*.08){members.push_back(other);bounds=united_box(bounds,b);extended=true;}
   }}
  }
  for(size_t other=0;other<regions.size();other++){if(used.count(other)||std::find(members.begin(),members.end(),other)!=members.end()||regions[other].value("mode",std::string{})!="tooltip")continue;const auto b=regions[other].at("bbox").get<Box>();if(area(b)>0&&double(overlap(b,bounds))/area(b)>=.9&&area(b)<area(bounds)*.85)members.push_back(other);}
  if(members.size()>8)continue;
  const bool high_confidence_text=members.size()==1&&original.value("type",std::string{})=="text"&&original.value("detectorConfidence",0.)>=.65;
  const bool try_annotation=annotation_reading&&!ruby_main&&columns.empty()&&members.size()==1&&original.value("type",std::string{})=="text"&&!original.value("panelCandidate",false)&&ocr_characters(original.at("text")).size()>=8&&bounds[2]-bounds[0]>=24&&bounds[3]-bounds[1]>=(bounds[2]-bounds[0])*1.8;
  if(high_confidence_text&&!try_annotation)continue;
  progress();attempts++;const auto scratch=folder/"crops"/("styled-"+std::to_string(original.at("id").get<int>())+".ppm");std::string text;json contextProofs=json::array(),annotationProof;
  if(try_annotation)annotationProof=annotation_reading(bounds);
  if(high_confidence_text&&annotationProof.is_null())continue;
  if(ruby_main)text=verified_ruby_main_reading(im,*ruby_main,scratch,engine);
  else if(!annotationProof.is_null())text=annotationProof.at("text");
  else if(columns.empty())text=original.value("panelCandidate",false)?verified_panel_reading(im,bounds,scratch,engine):verified_styled_reading(im,bounds,scratch,engine);
  else for(const auto& column:columns){json proof;auto part=context_column_reading(im,column,scratch,engine,dictionary,regions,detail_regions,proof);if(!proof.is_null())contextProofs.push_back(proof);if(part.empty())part=verified_styled_reading(im,column,scratch,engine);if(part.empty()){text.clear();break;}if(!text.empty())text+=' ';text+=part;}
  if(text.empty())continue;
  json detachedRecovery;
  if(!ruby_main&&columns.empty()&&annotationProof.is_null()&&members.size()==1&&original.value("type",std::string{})=="text"&&original.value("detectorConfidence",0.)>=.3&&original.value("detectorConfidence",0.)<.65){
   detachedRecovery=detached_columns::correction(im,bounds,text,[&](const PageImage& image,Box box,int scale,bool inverse){progress();auto crop=name_crop(image,box,scale,12);if(inverse)for(auto& v:crop.rgb)v=255-v;crop_ppm(scratch,crop,{0,0,crop.width,crop.height});const auto value=engine.run(scratch,64);return value.stopped?engine.tokenizer.decode(value.ids):std::string{};});
   if(!detachedRecovery.is_null())text=detachedRecovery.at("text");
  }
  json projected_readings;
  // A neighboring registered name can explain a kana suffix accidentally
  // attached to this label. Require independent OCR of all three columns.
  if(!ruby_main&&columns.empty()&&dictionary.contains("entries")&&dictionary.at("entries").is_array()){
   const auto projected=projected_middle_column(im,bounds);
   if(projected.size()==3){
    std::set<std::string> expected;
    for(const auto& entry:dictionary.at("entries")){
     if(entry.value("kind",std::string("person"))!="person")continue;
     auto owner=[&](const json& r){if(r.value("text",std::string{})!=entry.value("source",std::string{})||r.value("ocrTruncated",false))return false;const auto b=r.at("bbox").get<Box>();const int bw=b[2]-b[0],bh=b[3]-b[1];return bw>0&&bh>=bw*2&&projected[0][0]>=b[0]+bw*.8&&projected[0][2]<=b[2]+bw*.35&&bounds[1]>=b[1]&&bounds[3]<=b[3];};
     bool nearby=std::any_of(proposals.begin(),proposals.end(),[&](const OutsideProposal& p){return owner(p.region);});
     if(!nearby)continue;
     std::istringstream reading(entry.value("reading",std::string{}));std::string part;
     while(reading>>part)if(kana_reading(part)&&text.size()>part.size()&&text.compare(text.size()-part.size(),part.size(),part)==0)expected.insert(part);
    }
    if(expected.size()==1){
     const auto left=verified_ruby_main_reading(im,projected[0],scratch,engine),main=verified_ruby_main_reading(im,projected[1],scratch,engine),right=verified_ruby_main_reading(im,projected[2],scratch,engine);
     if(expected.count(left)&&han_only(main)&&ocr_characters(main).size()>=2&&kana_reading(right)&&ocr_characters(text)==ocr_characters(main+left)){
      projected_readings={{"main",projected[1]},{"left",{{"bbox",projected[0]},{"text",left}}},{"right",{{"bbox",projected[2]},{"text",right}}}};text=main;
     }
    }
   }
  }
  auto proposed=original;proposed["bbox"]=bounds;proposed["box"]=bounds;proposed["text"]=text;proposed["mode"]="tooltip";proposed["safe"]=false;proposed["type"]="text";
  json sources=json::array();for(const auto member:members)sources.push_back(regions[member].at("bbox"));proposed["textVerification"]={{"version",1},{"method","ocr-consensus"},{"sources",sources}};if(columns.size()>=2)proposed["textVerification"]["columns"]=columns;
  if(!detachedRecovery.is_null())proposed["textVerification"]["columnRecovery"]=detachedRecovery;
  if(!contextProofs.empty()){proposed["textVerification"]["method"]="ocr-context";proposed["textVerification"]["contextProofs"]=contextProofs;}
  if(!annotationProof.is_null())proposed["textVerification"]["annotationSeparation"]=annotationProof;
  if(ruby_main)proposed["textVerification"]["rubyMainColumn"]=*ruby_main;
  if(!projected_readings.is_null())proposed["textVerification"]["projectedRuby"]=projected_readings;
  proposals.push_back({std::move(proposed),members});used.insert(members.begin(),members.end());
 }
 return proposals;
}
