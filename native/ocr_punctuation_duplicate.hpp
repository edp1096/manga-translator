#pragma once
#include "ocr_dedup.hpp"

// A punctuation-only crop can be the already-recognized end of a larger crop.
// Text agreement alone is insufficient: require the same detector glyphs and
// keep their complete mask inside the unchanged owner's bounds. This proves
// physical ownership, not the accuracy of the owner's OCR or its semantic role.
namespace ocr_punctuation_duplicate {
inline bool eligible(const json& row,int width,int height){
 if(row.value("type",std::string{})!="text"||!row.contains("id")||!row["id"].is_number_integer()||!row.contains("bbox")||!row["bbox"].is_array()||row["bbox"].size()!=4||!row.contains("detectorConfidence")||!row["detectorConfidence"].is_number())return false;
 for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})if(row.value(flag,false))return false;
 for(const auto& n:row["bbox"])if(!n.is_number_integer())return false;
 const auto b=row["bbox"].get<Box>();const double confidence=row["detectorConfidence"];
 return width>0&&height>0&&b[0]>=0&&b[1]>=0&&b[2]<=width&&b[3]<=height&&area(b)>0&&std::isfinite(confidence)&&confidence>=.2&&confidence<=1;
}
inline std::vector<uint32_t> characters(const std::string& text){
 auto chars=ocr_characters(text,false);for(auto& c:chars)if(c>=0xff01&&c<=0xff5e)c-=0xfee0;return chars;
}
inline bool text_matches(const json& owner,const json& child){
 const auto full=characters(owner.value("text",std::string{})),tail=characters(child.value("text",std::string{}));
 return ocr_characters(owner.value("text",std::string{})).size()>=2&&tail.size()>=1&&tail.size()<=4&&full.size()>tail.size()&&std::all_of(tail.begin(),tail.end(),[](uint32_t c){return c=='!'||c=='?';})&&std::equal(tail.rbegin(),tail.rend(),full.rbegin());
}
inline bool geometry_matches(const Box& owner,const Box& child){
 if(area(child)>.3*area(owner)||double(overlap(owner,child))/area(child)<.95)return false;
 const int w=owner[2]-owner[0],h=owner[3]-owner[1];
 // A nested fragment must be at the reading end, not a similar mark elsewhere.
 if(h>=1.5*w)return (child[1]+child[3])*.5>=owner[1]+h*.65;
 if(w>=1.5*h)return (child[0]+child[2])*.5>=owner[0]+w*.65;
 return false;
}
inline int source(const json& row,const std::vector<Region>& detected,bool replay=false,int query=-1){
 int found=-1;const auto b=row.at("bbox").get<Box>();const double confidence=row.at("detectorConfidence");
 for(size_t i=0;i<detected.size();i++){
  const auto& d=detected[i];
  const double similarity=double(overlap(d.box,b))/std::max(1,area(d.box)+area(b)-overlap(d.box,b));
  if(d.cls!=0||!std::isfinite(d.score)||std::abs(d.score-confidence)>=.0001||(replay?(d.query!=query||similarity<.95):d.box!=b)||d.mask_side<3||d.mask_side>512||d.mask.size()!=size_t(d.mask_side)*d.mask_side)continue;
  if(found!=-1)return -1;found=int(i);
 }
 return found;
}
struct Ownership {std::vector<size_t> cells;size_t shared=0;};
inline Ownership ownership(const Region& owner,const Region& child,const Box& bounds,const Box& fragment,int width,int height){
 Ownership out;if(owner.mask_side!=child.mask_side)return out;const int side=owner.mask_side;
 auto inside=[&](size_t p,const Box& b){const double x=(p%side+.5)*width/side,y=(p/side+.5)*height/side;return x>=b[0]&&x<b[2]&&y>=b[1]&&y<b[3];};
 for(size_t p=0;p<child.mask.size();p++)if(child.mask[p]&&inside(p,fragment)){
  if(!inside(p,bounds))return {};out.cells.push_back(p);
  if(owner.mask[p]){out.shared++;continue;}
  bool adjacent=false;for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){const int x=int(p%side)+dx,y=int(p/side)+dy;if(x>=0&&y>=0&&x<side&&y<side&&inside(size_t(y)*side+x,bounds)&&owner.mask[size_t(y)*side+x])adjacent=true;}
  if(!adjacent)return {};
 }
 if(out.cells.size()<8||out.shared<out.cells.size()*.95)return {};return out;
}
inline bool pair(const json& owner,const json& child,int width,int height){
 return eligible(owner,width,height)&&eligible(child,width,height)&&owner["id"]!=child["id"]&&text_matches(owner,child)&&geometry_matches(owner["bbox"].get<Box>(),child["bbox"].get<Box>())&&owner["detectorConfidence"].get<double>()>=child["detectorConfidence"].get<double>()+.05;
}
inline json suppress(json& rows,std::vector<Region>& detected,int width,int height){
 json proofs=json::array();std::set<size_t> removed,removedDetections;
 for(size_t j=0;j<rows.size();j++){
  if(removed.count(j)||!eligible(rows[j],width,height))continue;
  const int fragment=source(rows[j],detected);if(fragment<0||removedDetections.count(fragment))continue;
  int chosen=-1,ownerSource=-1;Ownership chosenMask;
  for(size_t i=0;i<rows.size();i++){
   if(i==j||removed.count(i)||!pair(rows[i],rows[j],width,height))continue;
   const int candidate=source(rows[i],detected);if(candidate<0||candidate==fragment||removedDetections.count(candidate))continue;
   auto mask=ownership(detected[candidate],detected[fragment],rows[i]["bbox"].get<Box>(),rows[j]["bbox"].get<Box>(),width,height);if(mask.cells.empty())continue;
   if(chosen!=-1){chosen=-2;break;}chosen=int(i);ownerSource=candidate;chosenMask=std::move(mask);
  }
  if(chosen<0)continue;
  // A detector source reused by another recognized row is ambiguous.
  bool reused=false;for(size_t i=0;i<rows.size();i++)if(i!=j&&!removed.count(i)&&rows[i].contains("bbox")&&rows[i]["bbox"]==rows[j]["bbox"])reused=true;if(reused)continue;
  auto& owner=rows[chosen];if(owner.contains("punctuationFragments")&&owner["punctuationFragments"].size()>=4)continue;
  json proof={{"version",1},{"method","same-glyph-terminal-punctuation"},{"imageWidth",width},{"imageHeight",height},{"owner",owner["id"]},{"ownerText",owner["text"]},{"ownerBox",owner["bbox"]},{"ownerConfidence",owner["detectorConfidence"]},{"ownerQuery",detected[ownerSource].query},{"id",rows[j]["id"]},{"sourceText",rows[j]["text"]},{"sourceBox",rows[j]["bbox"]},{"sourceConfidence",rows[j]["detectorConfidence"]},{"sourceQuery",detected[fragment].query},{"pixels",chosenMask.cells.size()},{"shared",chosenMask.shared},{"side",detected[ownerSource].mask_side}};
  if(!owner.contains("punctuationFragments"))owner["punctuationFragments"]=json::array();owner["punctuationFragments"].push_back(proof);owner.erase("hitMask");
  for(auto p:chosenMask.cells)detected[ownerSource].mask[p]=1;
  proofs.push_back(std::move(proof));removed.insert(j);removedDetections.insert(fragment);
 }
 json retained=json::array();for(size_t i=0;i<rows.size();i++)if(!removed.count(i))retained.push_back(std::move(rows[i]));rows=std::move(retained);
 std::vector<Region> kept;for(size_t i=0;i<detected.size();i++)if(!removedDetections.count(i))kept.push_back(std::move(detected[i]));detected=std::move(kept);return proofs;
}
// Redetection during restoration must prove ownership again. A persisted tag
// alone never authorizes removing a neighbor or expanding an erasure mask.
inline size_t replay(std::vector<Region>& detected,const json& rows,int width,int height){
 size_t count=0;std::set<size_t> removed;
 for(const auto& owner:rows){
  if(!eligible(owner,width,height)||!owner.contains("punctuationFragments")||!owner["punctuationFragments"].is_array()||owner["punctuationFragments"].size()>4)continue;
  for(const auto& p:owner["punctuationFragments"]){
   if(!p.is_object())continue;bool shape=true;for(const char* key:{"version","imageWidth","imageHeight","owner","ownerQuery","id","sourceQuery","pixels","shared","side"})if(!p.contains(key)||!p[key].is_number_integer())shape=false;for(const char* key:{"method","ownerText","sourceText"})if(!p.contains(key)||!p[key].is_string())shape=false;if(!shape)continue;
   if(!p.is_object()||p.value("version",0)!=1||p.value("method",std::string{})!="same-glyph-terminal-punctuation"||p.value("imageWidth",0)!=width||p.value("imageHeight",0)!=height||p.value("owner",-1)!=owner["id"]||p.value("ownerText",std::string{})!=owner.value("text",std::string{})||!p.contains("ownerBox")||p["ownerBox"]!=owner["bbox"]||!p.contains("ownerConfidence")||p["ownerConfidence"]!=owner["detectorConfidence"]||!p.contains("sourceBox")||!p.contains("sourceConfidence")||!p.contains("id")||!p.contains("ownerQuery")||!p.contains("sourceQuery"))continue;
   json child={{"id",p["id"]},{"type","text"},{"text",p.value("sourceText",std::string{})},{"bbox",p["sourceBox"]},{"detectorConfidence",p["sourceConfidence"]}};
   if(!pair(owner,child,width,height))continue;
   bool present=false;for(const auto& r:rows)if(r.value("id",-1)==child["id"]||r.value("bbox",json())==child["bbox"])present=true;if(present)continue;
   const int a=source(owner,detected,true,p["ownerQuery"].get<int>()),b=source(child,detected,true,p["sourceQuery"].get<int>());if(a<0||b<0||a==b||removed.count(a)||removed.count(b)||p.value("side",0)!=detected[a].mask_side)continue;
   auto mask=ownership(detected[a],detected[b],owner["bbox"].get<Box>(),child["bbox"].get<Box>(),width,height);
   if(mask.cells.empty()||p.value("pixels",size_t(0))!=mask.cells.size()||p.value("shared",size_t(0))>mask.shared)continue;
   for(auto cell:mask.cells)detected[a].mask[cell]=1;removed.insert(b);count++;
  }
 }
 std::vector<Region> kept;for(size_t i=0;i<detected.size();i++)if(!removed.count(i))kept.push_back(std::move(detected[i]));detected=std::move(kept);return count;
}
// Initial flat-background cleaning precedes OCR grouping. Do not leave a hole
// where a removed fragment was painted but its retained owner uses a tooltip.
inline void retain_paint(std::vector<uint8_t>& paint,const json& proofs,const json& rows,int width,int height){
 if(paint.size()!=size_t(width)*height)return;std::vector<Box> retained;
 for(const auto& r:rows)if(r.value("safe",false)&&r.value("mode",std::string{})=="replace"&&!r.value("ocrTruncated",false)&&!r.value("translation",std::string{}).empty())retained.push_back(expand_box(r.at("bbox").get<Box>(),3,width,height));
 for(const auto& proof:proofs){const Box b=expand_box(proof.at("sourceBox").get<Box>(),3,width,height);
  for(int y=b[1];y<b[3];y++)for(int x=b[0];x<b[2];x++)if(std::none_of(retained.begin(),retained.end(),[&](const Box& r){return x>=r[0]&&x<r[2]&&y>=r[1]&&y<r[3];}))paint[size_t(y)*width+x]=0;
 }
}
}
