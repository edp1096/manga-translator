#pragma once
#include "name_reading.hpp"
#include "restoration_mask.hpp"

// Dictionary readings establish annotation ownership, not general text aliases.
// Only independently verified labels can contribute their existing mask sources.
inline size_t associate_name_ruby(json& rows,const json& dictionary,const std::vector<Region>& detected,int width,int height){
 if(!dictionary.contains("entries")||!dictionary.at("entries").is_array())return 0;
 auto label=[](const json& row){return row.value("type",std::string{})=="text"&&!row.value("ocrTruncated",false)&&restoration_verified_text(row)&&row.at("textVerification").value("role",std::string{})=="LABEL";};
 std::map<size_t,std::vector<size_t>> assignments;
 for(size_t i=0;i<rows.size();++i){
  const auto& ruby=rows[i];if(!label(ruby)||!kana_reading(ruby.value("text",std::string{})))continue;
  const auto r=ruby.at("bbox").get<Box>();int rw=r[2]-r[0],rh=r[3]-r[1];if(rw<3||rh<rw*1.5)continue;
  bool bubble=false;for(const auto& region:detected)if(region.cls==2&&region.score>=.5f&&double(overlap(region.box,r))/area(r)>.5){bubble=true;break;}if(bubble)continue;
  std::vector<size_t> owners;
  for(size_t j=0;j<rows.size();++j){
   if(i==j||!label(rows[j]))continue;const auto b=rows[j].at("bbox").get<Box>();int bw=b[2]-b[0],bh=b[3]-b[1];
   if(bh<bw*2||rw>bw*.35||rh>bh*.5||r[0]<b[0]+bw*.8||r[2]>b[2]+bw*.35||r[1]<b[1]||r[3]>b[3])continue;
   bool matches=false;
   for(const auto& entry:dictionary.at("entries")){
    if(entry.value("kind",std::string("person"))!="person"||entry.value("source",std::string{})!=rows[j].value("text",std::string{}))continue;
    std::istringstream input(entry.value("reading",std::string{}));std::string part;size_t count=0;bool match=false,valid=true;
    while(input>>part){++count;valid=valid&&kana_reading(part);match=match||part==ruby.at("text").get<std::string>();}
    if(valid&&count>=2&&match)matches=true;
   }
   if(matches)owners.push_back(j);
  }
  if(owners.size()==1)assignments[owners.front()].push_back(i);
 }
 std::set<size_t> removed;
 for(const auto& [owner,annotations]:assignments){
  auto combined=rows[owner];auto box=combined.at("bbox").get<Box>();auto& sources=combined["textVerification"]["sources"];json attached=json::array();
  for(auto i:annotations){const auto b=rows[i].at("bbox").get<Box>();box={std::min(box[0],b[0]),std::min(box[1],b[1]),std::max(box[2],b[2]),std::max(box[3],b[3])};for(const auto& source:rows[i].at("textVerification").at("sources"))if(std::find(sources.begin(),sources.end(),source)==sources.end())sources.push_back(source);attached.push_back({{"text",rows[i].at("text")},{"bbox",b}});}
  if(sources.size()>8||double(area(box))>double(width)*height*.08)continue;
  combined["bbox"]=box;combined["box"]=box;combined["textVerification"]["rubyAnnotations"]=attached;
  if(!restoration_verified_text(combined))continue;
  rows[owner]=std::move(combined);removed.insert(annotations.begin(),annotations.end());
 }
 json retained=json::array();for(size_t i=0;i<rows.size();++i)if(!removed.count(i))retained.push_back(std::move(rows[i]));rows=std::move(retained);return removed.size();
}
