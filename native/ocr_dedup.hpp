#pragma once
#include "image_ops.hpp"

inline std::vector<uint32_t> ocr_characters(const std::string& text,bool punctuation=true){
 std::vector<uint32_t> result;
 for(auto character:codepoints(text)){
  if(punctuation&&character>=0xff01&&character<=0xff5e)character-=0xfee0;
  if(character<=0x20||character==0x3000)continue;
  if(punctuation&&((character<128&&std::ispunct(static_cast<unsigned char>(character)))||(character>=0x2000&&character<=0x206f)||(character>=0x3001&&character<=0x301f)))continue;
  result.push_back(character);
 }
 return result;
}

inline size_t ocr_substring_distance(const std::vector<uint32_t>& fragment,const std::vector<uint32_t>& complete,bool substring=true){
 std::vector<size_t> previous(complete.size()+1,0),current(complete.size()+1);
 if(!substring)std::iota(previous.begin(),previous.end(),0);
 for(size_t row=0;row<fragment.size();++row){
  current[0]=row+1;
  for(size_t column=0;column<complete.size();++column)current[column+1]=std::min({previous[column+1]+1,current[column]+1,previous[column]+(fragment[row]!=complete[column])});
  previous.swap(current);
 }
 return substring?*std::min_element(previous.begin(),previous.end()):previous.back();
}

inline bool ocr_repeated_latin(const std::vector<uint32_t>& text){
 size_t run=0;uint32_t previous=0;
 for(auto c:text){run=c==previous?run+1:1;previous=c;if(run>=6&&((c>='A'&&c<='Z')||(c>='a'&&c<='z')))return true;}
 return false;
}
inline std::vector<uint32_t> ocr_latin_comparison(const std::vector<uint32_t>& text){
 std::vector<uint32_t> result;size_t run=0;uint32_t previous=0;
 for(auto c:text){if(c>='a'&&c<='z')c-=32;run=c==previous?run+1:1;previous=c;if(run<=2||c<'A'||c>'Z')result.push_back(c);}return result;
}
inline bool ocr_combined_parent(size_t parent,const json& regions,const std::vector<std::vector<uint32_t>>& normalized,const std::set<size_t>& excluded){
 if(regions[parent].at("type")!="text"||regions[parent].value("ocrTruncated",false)||normalized[parent].size()<8||normalized[parent].size()>512)return false;
 const bool repeated=normalized[parent].size()>=40&&ocr_repeated_latin(normalized[parent]);
 const auto bounds=regions[parent].at("bbox").get<Box>();std::vector<size_t> children;
 for(size_t index=0;index<regions.size();++index){
  if(index==parent||excluded.count(index)||regions[index].at("type")!="text"||regions[index].value("ocrTruncated",false)||normalized[index].size()<2)continue;
  const auto child=regions[index].at("bbox").get<Box>();
  if(area(child)<area(bounds)*.8&&double(overlap(child,bounds))/std::max(1,area(child))>=(repeated?.9:.95))children.push_back(index);
 }
 if(children.size()<2||children.size()>4)return false;
 Box combined=regions[children.front()].at("bbox").get<Box>();size_t length=0;
 for(size_t position=0;position<children.size();++position){
  const auto child=regions[children[position]].at("bbox").get<Box>();length+=normalized[children[position]].size();
  combined={std::min(combined[0],child[0]),std::min(combined[1],child[1]),std::max(combined[2],child[2]),std::max(combined[3],child[3])};
  for(size_t previous=0;previous<position;++previous){const auto other=regions[children[previous]].at("bbox").get<Box>();if(double(overlap(child,other))/std::max(1,std::min(area(child),area(other)))>.1)return false;}
 }
 // A low-confidence combined English crop can loop on a letter at the
 // paragraph boundary. Prefer separate, non-overlapping paragraph readings
 // only with better detector scores, substantial text in every child, close
 // geometry, and a bounded whole-text comparison. Never change stored OCR.
 if(repeated&&double(overlap(combined,bounds))/std::max(1,area(combined)+area(bounds)-overlap(combined,bounds))>=.9&&
    std::all_of(children.begin(),children.end(),[&](size_t child){const auto& t=normalized[child];return t.size()>=20&&!ocr_repeated_latin(t)&&regions[child].value("detectorConfidence",0.)>regions[parent].value("detectorConfidence",0.)+.02&&std::count_if(t.begin(),t.end(),[](uint32_t c){return (c>='A'&&c<='Z')||(c>='a'&&c<='z');})>=t.size()*.9;})){
  const auto original=ocr_latin_comparison(normalized[parent]);auto order=children;
  do{std::vector<uint32_t> text;for(auto child:order){auto part=ocr_latin_comparison(normalized[child]);text.insert(text.end(),part.begin(),part.end());}
   if(original.size()>=24&&text.size()>=24&&std::equal(text.begin(),text.begin()+12,original.begin())&&std::equal(text.end()-12,text.end(),original.end()-12)&&ocr_substring_distance(text,original,false)<=std::min<size_t>(12,text.size()/7))return true;
  }while(std::next_permutation(order.begin(),order.end()));
 }
 // Correcting a split kanji (日生 -> 星) can make the verified children
 // differ from the original parent by more than the ordinary OCR tolerance.
 // Keep the strict containment/coverage tests and require every child to have
 // independent OCR confirmation before permitting that extra edit distance.
 const bool confirmed=std::all_of(children.begin(),children.end(),[&](size_t child){
  const auto v=regions[child].value("textVerification",json::object());
  return v.value("version",0)==1&&v.value("method",std::string{})=="ocr-consensus"&&v.value("role",std::string{})=="LABEL";
 });
 const size_t tolerance=confirmed?std::max<size_t>(2,std::min<size_t>(3,(normalized[parent].size()+3)/4)):std::max<size_t>(1,std::min<size_t>(2,normalized[parent].size()/12));
 if(length+tolerance<normalized[parent].size()||length>normalized[parent].size()+tolerance||double(overlap(combined,bounds))/std::max(1,area(combined)+area(bounds)-overlap(combined,bounds))<.9)return false;
 do{
  std::vector<uint32_t> text;for(const auto child:children)text.insert(text.end(),normalized[child].begin(),normalized[child].end());
  if(ocr_substring_distance(text,normalized[parent],false)<=tolerance)return true;
 }while(std::next_permutation(children.begin(),children.end()));
 return false;
}

inline bool ocr_duplicate(const json& candidate,const json& retained,const std::vector<uint32_t>& fragment,const std::vector<uint32_t>& complete){
 if(fragment.empty()||fragment.size()>complete.size()||candidate.at("type")!=retained.at("type")||retained.value("ocrTruncated",false))return false;
 const auto bounds=candidate.at("bbox").get<Box>(),container=retained.at("bbox").get<Box>();
 const int shared=overlap(bounds,container),combined=area(bounds)+area(container)-shared;
 if(candidate.at("type")=="text"&&fragment.size()>=6&&fragment.size()<=512&&fragment.size()==complete.size()&&retained.value("detectorConfidence",0.)>=candidate.value("detectorConfidence",0.)+.02&&combined>0&&double(shared)/combined>=.7&&std::abs((bounds[0]+bounds[2])-(container[0]+container[2]))<=.4*std::min(bounds[2]-bounds[0],container[2]-container[0])&&std::abs((bounds[1]+bounds[3])-(container[1]+container[3]))<=.2*std::min(bounds[3]-bounds[1],container[3]-container[1])&&ocr_substring_distance(fragment,complete,false)<=std::max<size_t>(1,std::min<size_t>(2,fragment.size()/10)))return true;
 // Exact same reading in aligned nested detections: retain the stronger reading.
 if(candidate.at("type")=="text"&&fragment.size()>=3&&fragment==complete&&retained.value("detectorConfidence",0.)>=.5&&retained.value("detectorConfidence",0.)>=candidate.value("detectorConfidence",0.)+.15&&area(bounds)>area(container)*1.2&&area(bounds)<=area(container)*3&&double(shared)/std::max(1,area(container))>=.95&&std::abs((bounds[0]+bounds[2])-(container[0]+container[2]))<=std::min(bounds[2]-bounds[0],container[2]-container[0])&&std::abs((bounds[1]+bounds[3])-(container[1]+container[3]))<=.2*std::min(bounds[3]-bounds[1],container[3]-container[1]))return true;
 const double coverage=double(overlap(bounds,container))/std::max(1,area(bounds));
 if(coverage<.85)return false;
 if(std::search(complete.begin(),complete.end(),fragment.begin(),fragment.end())!=complete.end())return true;
 if(candidate.at("type")!="text"||fragment.size()<8||fragment.size()>512||complete.size()>512||coverage<.95||area(container)<area(bounds)*.9||retained.value("detectorConfidence",0.)<candidate.value("detectorConfidence",0.)+.05)return false;
 return ocr_substring_distance(fragment,complete)<=std::min<size_t>(2,fragment.size()/10);
}

inline size_t deduplicate_ocr(json& regions,const json& dictionary=json::object()){
 const auto original_regions=regions;
 std::vector<std::vector<uint32_t>> normalized;for(const auto& region:regions)normalized.push_back(ocr_characters(region.at("text"),region.at("type")=="text"));
 std::vector<size_t> order(regions.size());std::iota(order.begin(),order.end(),0);
 std::stable_sort(order.begin(),order.end(),[&](size_t first,size_t second){return normalized[first].size()!=normalized[second].size()?normalized[first].size()>normalized[second].size():regions[first].value("detectorConfidence",0.)>regions[second].value("detectorConfidence",0.);});
 std::vector<size_t> retained;std::set<size_t> removed;std::map<size_t,size_t> owners;
 std::set<size_t> named;
 for(size_t index=0;index<regions.size();++index)if(!regions[index].value("ocrTruncated",false)&&normalized[index].size()>=2)for(const auto& entry:dictionary.value("entries",json::array()))if(normalized[index]==ocr_characters(entry.at("source")))named.insert(index);
 for(const auto parent:named)for(size_t index=0;index<regions.size();++index){
  if(named.count(index)||normalized[index].empty()||normalized[index].size()>=normalized[parent].size())continue;
  const auto fragment=regions[index].at("bbox").get<Box>(),bounds=regions[parent].at("bbox").get<Box>();
  if(double(overlap(fragment,bounds))/std::max(1,area(fragment))>=.9&&std::search(normalized[parent].begin(),normalized[parent].end(),normalized[index].begin(),normalized[index].end())!=normalized[parent].end()){removed.insert(index);owners[index]=parent;}
 }
 for(const auto index:order)if(!removed.count(index))for(const auto other:order){
  if(index==other||removed.count(other)||std::search(normalized[other].begin(),normalized[other].end(),normalized[index].begin(),normalized[index].end())!=normalized[other].end())continue;
  if(ocr_duplicate(regions[index],regions[other],normalized[index],normalized[other])){removed.insert(index);owners[index]=other;break;}
 }
 for(size_t index=0;index<regions.size();++index)if(!removed.count(index)&&!named.count(index)&&ocr_combined_parent(index,regions,normalized,removed))removed.insert(index);
 for(const auto index:order){
  if(removed.count(index))continue;
  const bool duplicate=std::any_of(retained.begin(),retained.end(),[&](size_t previous){if(!ocr_duplicate(regions[index],regions[previous],normalized[index],normalized[previous]))return false;owners[index]=previous;return true;});
  if(duplicate)removed.insert(index);else retained.push_back(index);
 }
 std::map<size_t,json> geometry_members;
 for(const auto& pair:owners){
  if(regions[pair.first].at("type")!="text")continue;size_t owner=pair.second;std::set<size_t> visited{pair.first};
  while(removed.count(owner)&&owners.count(owner)&&visited.insert(owner).second)owner=owners.at(owner);
  if(removed.count(owner))continue;
  if(!geometry_members.count(owner))geometry_members[owner]=json::array();
  geometry_members[owner].push_back(original_regions[pair.first]);
  const auto fragment=regions[pair.first].at("bbox").get<Box>();auto bounds=regions[owner].at("bbox").get<Box>();
  bounds={std::min(bounds[0],fragment[0]),std::min(bounds[1],fragment[1]),std::max(bounds[2],fragment[2]),std::max(bounds[3],fragment[3])};regions[owner]["bbox"]=bounds;
 }
 // Preserve the actual OCR inputs when duplicate suppression expands a box.
 // A later restoration pass must validate these inputs, never guess them
 // from a nearby detector rectangle or treat display geometry as provenance.
 for(const auto& entry:geometry_members)if(regions[entry.first]["bbox"]!=original_regions[entry.first]["bbox"])
  regions[entry.first]["ocrDuplicateGeometry"]={{"version",1},{"method","ocr-duplicate-box-union"},{"source",original_regions[entry.first]},{"fragments",entry.second},{"sourceText",regions[entry.first]["text"]},{"sourceBox",regions[entry.first]["bbox"]}};
 json result=json::array();for(size_t index=0;index<regions.size();++index)if(!removed.count(index))result.push_back(std::move(regions[index]));regions=std::move(result);return removed.size();
}
