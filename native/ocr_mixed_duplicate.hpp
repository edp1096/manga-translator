#pragma once
#include "ocr_dedup.hpp"

// A weak whole-balloon detection can repeat the dialogue while also covering
// a separate exclamation. Keep both independent owners and their geometry.
// Equal OCR alone cannot authorize dropping the extra physical ink.
inline json suppress_mixed_duplicates(json& rows,const std::vector<Region>& detected,int width,int height){
 json proofs=json::array();if(width<=0||height<=0)return proofs;
 auto eligible=[&](const json& r){
  for(const auto* key:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})if(r.value(key,false))return false;
  if(r.contains("textVerification")||r.contains("ocrDuplicateGeometry")||!r.contains("bbox")||!r.contains("detectorConfidence")||!r.at("detectorConfidence").is_number())return false;
  const auto b=r.at("bbox").get<Box>();const double s=r.at("detectorConfidence");return area(b)>0&&b[0]>=0&&b[1]>=0&&b[2]<=width&&b[3]<=height&&std::isfinite(s)&&s>=.2&&s<=1;
 };
 auto source=[&](const json& r)->const Region*{const Region* found=nullptr;for(const auto& d:detected)if(d.cls==(r.at("type")=="text"?0:1)&&d.box==r.at("bbox").get<Box>()&&std::abs(d.score-r.at("detectorConfidence").get<double>())<.0001){if(found)return nullptr;found=&d;}return found&&found->mask_side>=3&&found->mask_side<=512&&found->mask.size()==size_t(found->mask_side)*found->mask_side?found:nullptr;};
 auto text=[](const json& r){return ocr_characters(r.value("text",std::string{}),false);};
 std::set<size_t> removed;
 for(size_t i=0;i<rows.size();i++){
  const auto& parent=rows[i];if(removed.count(i)||!eligible(parent)||parent.at("type")!="text"||parent.at("detectorConfidence").get<double>()>.65||ocr_characters(parent.value("text",std::string{})).size()<6)continue;
  const auto bounds=parent.at("bbox").get<Box>();const auto* pm=source(parent);if(!pm)continue;
  for(size_t j=0;j<rows.size();j++){
   const auto& child=rows[j];if(i==j||removed.count(j)||!eligible(child)||child.at("type")!="text"||text(child)!=text(parent)||child.at("detectorConfidence").get<double>()<.65||child.at("detectorConfidence").get<double>()<parent.at("detectorConfidence").get<double>()+.2)continue;
   const auto cb=child.at("bbox").get<Box>();if(area(cb)<area(bounds)*.3||area(cb)>area(bounds)*.8||double(overlap(bounds,cb))/area(cb)<.95)continue;
   const auto* cm=source(child);if(!cm||cm->mask_side!=pm->mask_side)continue;
   std::vector<size_t> members{j};std::vector<const Region*> masks{cm};
   for(size_t k=0;k<rows.size();k++){
    if(k==i||k==j||removed.count(k)||!eligible(rows[k])||rows[k].at("type")!="effect")continue;
    const auto chars=text(rows[k]);if(chars.empty()||chars.size()>6||!std::all_of(chars.begin(),chars.end(),[](uint32_t c){return c=='!'||c=='?'||c==0xff01||c==0xff1f;}))continue;
    const auto b=rows[k].at("bbox").get<Box>();const double score=rows[k].at("detectorConfidence");if(score<.4||score<parent.at("detectorConfidence").get<double>()+.15||area(b)>area(bounds)*.5||double(overlap(b,bounds))/area(b)<.95||overlap(b,cb)>0)continue;
    const auto* m=source(rows[k]);if(m&&m->mask_side==pm->mask_side){members.push_back(k);masks.push_back(m);}
   }
   if(members.size()<2||members.size()>3)continue;
   const int side=pm->mask_side;auto inside=[&](size_t p,const Box& b){const double x=(p%side+.5)*width/side,y=(p/side+.5)*height/side;return x>=b[0]&&x<b[2]&&y>=b[1]&&y<b[3];};
   std::vector<uint8_t> covered(pm->mask.size());size_t total=0,residual=0,remote=0;bool valid=true;
   for(size_t a=0;a<masks.size();a++){const auto b=rows[members[a]].at("bbox").get<Box>();size_t count=0,shared=0;for(size_t p=0;p<covered.size();p++)if(masks[a]->mask[p]&&inside(p,b)){if(covered[p])valid=false;covered[p]=1;count++;if(pm->mask[p]&&inside(p,bounds))shared++;}if(count<8||shared<count*.8)valid=false;}
   for(size_t p=0;p<covered.size();p++)if(pm->mask[p]&&inside(p,bounds)){total++;if(covered[p])continue;residual++;bool adjacent=false;for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){const int x=int(p%side)+dx,y=int(p/side)+dy;if(x>=0&&y>=0&&x<side&&y<side&&covered[size_t(y)*side+x])adjacent=true;}if(!adjacent)remote++;}
   // One isolated detector cell can be boundary noise; never permit a
   // remote multi-cell component or more than one percent unowned ink.
   if(!valid||total<16||residual>total*.05||remote>1||remote>total*.01)continue;
   json owners=json::array();for(auto k:members)owners.push_back({{"id",rows[k].at("id")},{"sourceText",rows[k].at("text")},{"sourceBox",rows[k].at("bbox")}});
   proofs.push_back({{"id",parent.at("id")},{"sourceText",parent.at("text")},{"sourceBox",bounds},{"method","equal-dialogue-and-independent-punctuation-masks"},{"owners",owners},{"pixels",total},{"residual",residual},{"remote",remote}});removed.insert(i);break;
  }
 }
 json result=json::array();for(size_t i=0;i<rows.size();i++)if(!removed.count(i))result.push_back(std::move(rows[i]));rows=std::move(result);return proofs;
}
