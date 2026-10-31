#pragma once
#include "ocr_dedup.hpp"

// Overlapping OCR crops can duplicate a whole sentence or a partial reading.
// Require actual shared text-mask pixels before dropping the broader crop;
// preserve the tighter owner's box so unrelated strokes are not inherited.
inline json suppress_mask_duplicates(json& rows,const std::vector<Region>& detected,int width,int height){
 json proofs=json::array();if(width<=0||height<=0)return proofs;
 auto eligible=[&](const json& r){
  if(r.value("type",std::string{})!="text"||r.value("manual",false)||r.value("layoutOverride",false)||r.value("displayOverride",false)||r.value("ocrTruncated",false)||r.value("truncated",false)||r.contains("textVerification")||!r.contains("bbox")||!r.contains("detectorConfidence")||!r.at("detectorConfidence").is_number())return false;
  const auto b=r.at("bbox").get<Box>();const double score=r.at("detectorConfidence");const auto text=ocr_characters(r.value("text",std::string{}));
  return std::isfinite(score)&&score>=.2&&score<=1&&area(b)>0&&b[0]>=0&&b[1]>=0&&b[2]<=width&&b[3]<=height&&text.size()>=6&&text.size()<=512;
 };
 auto source=[&](const json& r){const Region* selected=nullptr;for(const auto& d:detected)if(d.cls==0&&d.box==r.at("bbox").get<Box>()&&std::abs(d.score-r.at("detectorConfidence").get<double>())<.0001){if(selected)return static_cast<const Region*>(nullptr);selected=&d;}if(!selected||selected->mask_side<3||selected->mask_side>512||selected->mask.size()!=size_t(selected->mask_side)*selected->mask_side)return static_cast<const Region*>(nullptr);return selected;};
 std::set<size_t> removed;
 for(size_t i=0;i<rows.size();i++){
  if(removed.count(i)||!eligible(rows[i]))continue;const auto box=rows[i].at("bbox").get<Box>();
  for(size_t j=0;j<rows.size();j++){
   if(i==j||removed.count(j)||!eligible(rows[j]))continue;const auto child=rows[j].at("bbox").get<Box>();
   const auto fragment=ocr_characters(rows[i].at("text")),complete=ocr_characters(rows[j].at("text"));
   const bool equalNested=!(rows[j].at("detectorConfidence").get<double>()<.5||rows[j].at("detectorConfidence").get<double>()<rows[i].at("detectorConfidence").get<double>()+.02||area(box)<=area(child)*1.2||area(box)>area(child)*3||double(overlap(box,child))/area(child)<.95||std::abs((box[0]+box[2])-(child[0]+child[2]))>std::min(box[2]-box[0],child[2]-child[0])||std::abs((box[1]+box[3])-(child[1]+child[3]))>.2*std::min(box[3]-box[1],child[3]-child[1])||fragment!=complete);
   // A one-character OCR discrepancy must also have the same physical glyphs.
   // Keep short exclamations and similarly worded, separate speech untouched.
   const bool partial=fragment.size()>=10&&complete.size()>=fragment.size()+3&&rows[j].at("detectorConfidence").get<double>()>=.4&&rows[j].at("detectorConfidence").get<double>()>=rows[i].at("detectorConfidence").get<double>()+.02&&area(child)>=area(box)*1.2&&area(child)<=area(box)*3&&double(overlap(box,child))/area(box)>=.95&&ocr_substring_distance(fragment,complete)==1;
   if(!equalNested&&!partial)continue;
   const auto* parentMask=source(rows[i]);const auto* childMask=source(rows[j]);if(!parentMask||!childMask||parentMask->mask_side!=childMask->mask_side)continue;
   const auto* smallMask=partial?parentMask:childMask;const auto* largeMask=partial?childMask:parentMask;const auto smallBox=partial?box:child,largeBox=partial?child:box;
   const int side=parentMask->mask_side;size_t pixels=0,shared=0;bool adjacent=true;
   for(size_t p=0;p<smallMask->mask.size();p++){
    const double x=(p%side+.5)*width/side,y=(p/side+.5)*height/side;
    if(smallMask->mask[p]&&x>=smallBox[0]&&x<smallBox[2]&&y>=smallBox[1]&&y<smallBox[3]){pixels++;if(largeMask->mask[p]&&x>=largeBox[0]&&x<largeBox[2]&&y>=largeBox[1]&&y<largeBox[3])shared++;
     // Allow at most two cells of boundary jitter on the detector grid.
     else if(partial){bool close=false;for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++){const int px=int(p%side)+dx,py=int(p/side)+dy;const double gx=(px+.5)*width/side,gy=(py+.5)*height/side;if(px>=0&&py>=0&&px<side&&py<side&&gx>=largeBox[0]&&gx<largeBox[2]&&gy>=largeBox[1]&&gy<largeBox[3]&&largeMask->mask[size_t(py)*side+px])close=true;}if(!close)adjacent=false;}
    }
   }
   if(pixels<8||shared<pixels*.9||!adjacent)continue;
   proofs.push_back({{"id",rows[i].at("id")},{"sourceText",rows[i].at("text")},{"sourceBox",box},{"owner",rows[j].at("id")},{"ownerBox",child},{"method",partial?"partial-ocr-nested-text-mask":"equal-ocr-nested-text-mask"},{"pixels",pixels},{"shared",shared}});removed.insert(i);break;
  }
 }
 json retained=json::array();for(size_t i=0;i<rows.size();i++)if(!removed.count(i))retained.push_back(std::move(rows[i]));rows=std::move(retained);return proofs;
}
