#pragma once
#include "ocr_dedup.hpp"
#include <functional>

// A combined detection may repeat letters or misread the boundary between two
// labels. Require independently detected, disjoint owners for its visible mask.
inline json suppress_mask_parents(json& rows,const std::vector<Region>& detected,int width,int height,const std::function<json(const json&)>& verify={},const PageImage* image=nullptr){
 json proofs=json::array();if(width<=0||height<=0)return proofs;
 auto eligible=[&](const json& r){if(r.value("type",std::string{})!="text"||r.value("manual",false)||r.value("layoutOverride",false)||r.value("displayOverride",false)||r.value("ocrTruncated",false)||r.value("truncated",false)||!r.contains("bbox")||!r.contains("detectorConfidence")||!r.at("detectorConfidence").is_number())return false;const auto b=r.at("bbox").get<Box>();const double score=r.at("detectorConfidence");return std::isfinite(score)&&score>=.2&&score<=1&&area(b)>0&&b[0]>=0&&b[1]>=0&&b[2]<=width&&b[3]<=height&&ocr_characters(r.value("text",std::string{})).size()>=2;};
 struct Mask{std::vector<uint8_t> bits;int side=0;size_t count=0;};
 auto mask=[&](const json& row){Mask out;const Region* selected=nullptr;for(const auto& r:detected)if(r.cls<2&&r.box==row.at("bbox").get<Box>()&&std::abs(r.score-row.at("detectorConfidence").get<double>())<.0001){if(selected)return out;selected=&r;}if(!selected||selected->mask_side<3||selected->mask_side>512||selected->mask.size()!=size_t(selected->mask_side)*selected->mask_side)return out;out.side=selected->mask_side;out.bits.resize(selected->mask.size());const auto box=row.at("bbox").get<Box>();for(size_t p=0;p<out.bits.size();p++){const double x=(p%out.side+.5)*width/out.side,y=(p/out.side+.5)*height/out.side;if(selected->mask[p]&&x>=box[0]&&x<box[2]&&y>=box[1]&&y<box[3]){out.bits[p]=1;out.count++;}}return out;};
 std::set<size_t> removed;
 for(size_t i=0;i<rows.size();i++){const auto& parent=rows[i];if(!eligible(parent)||(parent.value("mode",std::string{})!="tooltip"&&(!verify||parent.value("mode",std::string{})!="replace"))||parent.contains("textVerification")||parent.at("detectorConfidence").get<double>()>.65||ocr_characters(parent.at("text")).size()<8)continue;const auto bounds=parent.at("bbox").get<Box>();std::vector<size_t> children;double best=0;bool confirmed=false;
  for(size_t j=0;j<rows.size();j++){if(i==j||removed.count(j)||!eligible(rows[j]))continue;const auto b=rows[j].at("bbox").get<Box>();if(area(b)>=area(bounds)*.8||double(overlap(b,bounds))/area(b)<.8)continue;children.push_back(j);best=std::max(best,rows[j].at("detectorConfidence").get<double>());const auto v=rows[j].value("textVerification",json::object());confirmed=confirmed||(v.value("version",0)==1&&v.value("method",std::string{})=="ocr-consensus"&&v.value("role",std::string{})=="LABEL");}
  if(children.size()<2||children.size()>4||(!confirmed&&!verify)||parent.at("detectorConfidence").get<double>()>best+.05)continue;const auto p=mask(parent);if(!p.count)continue;std::vector<Mask> owners;bool valid=true;for(auto j:children){owners.push_back(mask(rows[j]));if(!owners.back().count||owners.back().side!=p.side)valid=false;}if(!valid)continue;
  std::vector<uint8_t> covered(p.bits.size());for(const auto& o:owners)for(size_t k=0;k<covered.size();k++)covered[k]|=o.bits[k];size_t residual=0;for(size_t k=0;k<p.bits.size();k++)if(p.bits[k]&&!covered[k]){residual++;bool close=false;for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){const int x=int(k%p.side)+dx,y=int(k/p.side)+dy;if(x>=0&&y>=0&&x<p.side&&y<p.side&&covered[size_t(y)*p.side+x])close=true;}if(!close)valid=false;}if(residual>p.count*.05)valid=false;
  for(size_t a=0;a<owners.size();a++){size_t unique=0;for(size_t k=0;k<p.bits.size();k++)if(p.bits[k]&&owners[a].bits[k]){bool own=true;for(size_t b=0;b<owners.size();b++)if(a!=b&&owners[b].bits[k])own=false;unique+=own;}if(unique<p.count*.1)valid=false;for(size_t b=a+1;b<owners.size();b++){size_t common=0;for(size_t k=0;k<p.bits.size();k++)common+=owners[a].bits[k]&&owners[b].bits[k];if(common>std::min(owners[a].count,owners[b].count)*.05)valid=false;}}
  bool pixelOwnership=false;size_t checkedInk=0;
  if(!valid&&verify&&image&&image->width==width&&image->height==height&&image->rgb.size()==size_t(width)*height*3&&residual<=p.count*.15){
   // Coarse masks can disagree on white edge cells. Validate actual dark ink
   // against the disjoint child masks instead of widening rectangle overlap.
   pixelOwnership=true;for(int y=bounds[1];y<bounds[3]&&pixelOwnership;y++)for(int x=bounds[0];x<bounds[2];x++){
    const size_t pixel=(size_t(y)*width+x)*3;const int sx=int((x+.5)*p.side/width),sy=int((y+.5)*p.side/height);
    if(!p.bits[size_t(sy)*p.side+sx]||(int(image->rgb[pixel])+image->rgb[pixel+1]+image->rgb[pixel+2])/3>=128)continue;checkedInk++;bool own=false;
    for(int dy=-1;dy<=1&&!own;dy++)for(int dx=-1;dx<=1;dx++){const int px=sx+dx,py=sy+dy;if(px>=0&&py>=0&&px<p.side&&py<p.side&&covered[size_t(py)*p.side+px])own=true;}
    if(!own){pixelOwnership=false;break;}
   }pixelOwnership=pixelOwnership&&checkedInk>=32;
   // This fallback only relaxes parent edge quantization, never child overlap.
   for(size_t a=0;a<owners.size();a++){size_t unique=0;for(size_t k=0;k<p.bits.size();k++)if(p.bits[k]&&owners[a].bits[k]){bool own=true;for(size_t b=0;b<owners.size();b++)if(a!=b&&owners[b].bits[k])own=false;unique+=own;}if(unique<p.count*.1)pixelOwnership=false;for(size_t b=a+1;b<owners.size();b++){size_t common=0;for(size_t k=0;k<p.bits.size();k++)common+=owners[a].bits[k]&&owners[b].bits[k];if(common>std::min(owners[a].count,owners[b].count)*.05)pixelOwnership=false;}}
  }
  if(!valid&&!pixelOwnership)continue;valid=true;json independent=json::array();
  if(!confirmed||pixelOwnership){
   const auto original=ocr_characters(parent.at("text"));bool agreement=false;auto order=children;
   do{std::vector<uint32_t> combined;for(auto child:order){const auto chars=ocr_characters(rows[child].at("text"));combined.insert(combined.end(),chars.begin(),chars.end());}
    if(original.size()>=12&&combined.size()>=12&&std::equal(original.begin(),original.begin()+4,combined.begin())&&std::equal(original.end()-4,original.end(),combined.end()-4)&&ocr_substring_distance(combined,original,false)<=(pixelOwnership?original.size()/3:std::min<size_t>(4,original.size()/5))){agreement=true;break;}
   }while(std::next_permutation(order.begin(),order.end()));
   if(!agreement)continue;
   for(auto child:children){const auto proof=verify(rows[child]);if(!proof.is_array()||proof.size()!=4||!std::all_of(proof.begin(),proof.end(),[&](const json& v){return v.is_string()&&ocr_characters(v.get<std::string>(),false)==ocr_characters(rows[child].at("text"),false);})){valid=false;break;}independent.push_back({{"id",rows[child].at("id")},{"readings",proof}});}
   if(!valid)continue;
  }
  json members=json::array();for(auto j:children)members.push_back({{"id",rows[j].at("id")},{"sourceText",rows[j].at("text")},{"sourceBox",rows[j].at("bbox")}});proofs.push_back({{"id",parent.at("id")},{"sourceText",parent.at("text")},{"sourceBox",bounds},{"method",independent.empty()?"independent-mask-owners":"verified-mask-owners"},{"readings",independent},{"members",members},{"pixels",p.count},{"residual",residual},{"pixelOwnership",pixelOwnership},{"checkedInk",checkedInk}});removed.insert(i);
 }
 json retained=json::array();for(size_t i=0;i<rows.size();i++)if(!removed.count(i))retained.push_back(std::move(rows[i]));rows=std::move(retained);return proofs;
}
