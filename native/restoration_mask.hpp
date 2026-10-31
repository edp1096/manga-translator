#pragma once
#include "image_ops.hpp"
#include "ocr_context.hpp"
#include "ocr_punctuation.hpp"
#include "layout_refinement.hpp"
#include "restoration_effect.hpp"
#include "restoration_neighbor.hpp"
#include <functional>

inline bool restoration_verified_text(const json& row){
 if(!row.contains("textVerification")||!row.at("textVerification").is_object())return false;const auto& v=row.at("textVerification");
 if(v.value("version",0)!=1||(v.value("method",std::string{})!="ocr-consensus"&&!valid_ocr_context(row))||(v.value("role",std::string{})!="DIALOGUE"&&v.value("role",std::string{})!="LABEL")||!v.contains("sources")||!v.at("sources").is_array()||v.at("sources").empty()||v.at("sources").size()>8)return false;
 const auto bounds=row.at("bbox").get<Box>();if(area(bounds)<=0)return false;
 for(const auto& source:v.at("sources")){if(!source.is_array()||source.size()!=4||!std::all_of(source.begin(),source.end(),[](const json& x){return x.is_number_integer();}))return false;const auto b=source.get<Box>();if(area(b)<=0||double(overlap(b,bounds))/area(b)<.85)return false;}
 return true;
}
inline bool restoration_verified_columns(const json& row){
 if(!restoration_verified_text(row))return false;const auto& v=row.at("textVerification");
 if(!v.contains("columns")||!v.at("columns").is_array()||v.at("columns").size()<2||v.at("columns").size()>4)return false;
 const auto bounds=row.at("bbox").get<Box>();Box combined{};std::vector<Box> columns;
 for(const auto& column:v.at("columns")){
  if(!column.is_array()||column.size()!=4||!std::all_of(column.begin(),column.end(),[](const json& n){return n.is_number_integer();}))return false;
  const auto b=column.get<Box>();if(area(b)<=0||area(b)>=area(bounds)*.8||double(overlap(b,bounds))/area(b)<.95)return false;
  for(auto other:columns)if(double(overlap(b,other))/std::min(area(b),area(other))>.1)return false;
  if(columns.empty())combined=b;else combined={std::min(combined[0],b[0]),std::min(combined[1],b[1]),std::max(combined[2],b[2]),std::max(combined[3],b[3])};columns.push_back(b);
 }
 return box_similarity(combined,bounds)>=.88;
}
inline void restoration_verified_regions(std::vector<Region>& detected,const json& recognized){
 std::set<size_t> owned;std::vector<Region> additions;
 for(const auto& row:recognized){if(!restoration_verified_text(row)||!ocr_context_sources_match(row,recognized))continue;std::set<size_t> matched;bool complete=true;
  for(const auto& source:row.at("textVerification").at("sources")){bool found=false;const auto bounds=source.get<Box>();for(size_t i=0;i<detected.size();i++)if(detected[i].cls<2&&detected[i].score>=.2f&&box_similarity(detected[i].box,bounds)>=.8){matched.insert(i);found=true;}if(!found){complete=false;break;}}
  if(!complete||matched.empty())continue;Region combined=detected[*matched.begin()];combined.cls=0;combined.ocr_verified=true;combined.box=row.at("bbox").get<Box>();std::fill(combined.mask.begin(),combined.mask.end(),0);
  for(const auto i:matched){const auto& r=detected[i];if(r.mask_side!=combined.mask_side||r.mask.size()!=combined.mask.size()){complete=false;break;}combined.score=std::max(combined.score,r.score);for(size_t p=0;p<r.mask.size();p++)combined.mask[p]|=r.mask[p];}
  if(complete){additions.push_back(std::move(combined));owned.insert(matched.begin(),matched.end());}
 }
 std::vector<Region> retained;for(size_t i=0;i<detected.size();i++)if(!owned.count(i))retained.push_back(std::move(detected[i]));retained.insert(retained.end(),std::make_move_iterator(additions.begin()),std::make_move_iterator(additions.end()));detected=std::move(retained);
}

#include "restoration_effect_components.hpp"

// A low-confidence balloon is enough to veto erasing, but never enough to
// authorize white painting. Keep these guards local to restoration.
inline void restoration_uncertain_bubbles(const LayoutRaw& raw,int width,int height,const json& recognized,std::vector<Region>& detected){
 for(size_t q=0;q<raw.logits.size()/5;q++){
  const auto* logits=raw.logits.data()+q*5;if(std::max_element(logits,logits+4)-logits!=2)continue;
  const float confidence=1/(1+std::exp(-std::clamp(logits[2],-30.f,30.f)));if(confidence<.25f||confidence>=.5f)continue;
  const auto* b=raw.boxes.data()+q*4;Box box{std::max(0,int((b[0]-b[2]/2)*width)),std::max(0,int((b[1]-b[3]/2)*height)),std::min(width,int((b[0]+b[2]/2)*width+1)),std::min(height,int((b[1]+b[3]/2)*height+1))};
  if(area(box)<=0||area(box)>int64_t(width)*height*.25)continue;
  bool encloses=false;for(const auto& text:recognized)if(text.value("type",std::string{})=="text"&&text.value("mode",std::string{})=="tooltip"){auto bounds=text.at("bbox").get<Box>();if(area(bounds)>0&&area(box)>1.2*area(bounds)&&double(overlap(box,bounds))/area(bounds)>.9){encloses=true;break;}}
  if(!encloses)continue;Region guard{int(q),2,confidence,box,{},raw.mask_side};guard.mask.resize(size_t(raw.mask_side)*raw.mask_side);const float* mask=raw.masks.data()+q*guard.mask.size();for(size_t i=0;i<guard.mask.size();i++)guard.mask[i]=mask[i]>0;detected.push_back(std::move(guard));
 }
}

inline size_t restoration_bubble_guards(const PageImage& image,OnnxLayout& detector,std::vector<Region>& detected,const json& recognized,const std::function<void()>& check_cancel){
 std::vector<Box> examined;size_t passes=0;
 for(const auto& text:recognized){
  if(text.value("type",std::string{})!="text"||text.value("mode",std::string{})!="tooltip"||text.value("ocrTruncated",false))continue;
  const auto box=text.at("bbox").get<Box>();if(area(box)<=0)continue;
  if(std::any_of(detected.begin(),detected.end(),[&](const Region& r){return r.cls==2&&(mask_coverage(r,box,image.width,image.height)>.05||double(overlap(r.box,box))/area(box)>.25);}))continue;
  const int side=int(std::ceil(std::max(384.*std::min(image.width,image.height)/720.,2.5*std::max(box[2]-box[0],box[3]-box[1]))));
  const int width=std::min(side,image.width),height=std::min(side,image.height),left=std::clamp((box[0]+box[2]-width)/2,0,image.width-width),top=std::clamp((box[1]+box[3]-height)/2,0,image.height-height);const Box crop{left,top,left+width,top+height};
  if(std::any_of(examined.begin(),examined.end(),[&](const Box& previous){return box_similarity(crop,previous)>.9;}))continue;
  check_cancel();examined.push_back(crop);passes++;
  PageImage detail{width,height,std::vector<uint8_t>(size_t(width)*height*3)};
  for(int y=0;y<height;y++)std::copy_n(image.rgb.data()+(size_t(y+top)*image.width+left)*3,width*3,detail.rgb.data()+size_t(y)*width*3);
  auto input=layout_input(detail,false,false,detector.input_side());const auto local=decode_regions(detector.run(input),width,height);
  for(const auto& bubble:local)if(bubble.cls==2&&bubble.score>=.5f){
   auto projected=project_region(bubble,crop,image.width,image.height,detector.input_side()/4);
   if(std::none_of(detected.begin(),detected.end(),[&](const Region& r){return r.cls==2&&box_similarity(r.box,projected.box)>.8;}))detected.push_back(std::move(projected));
  }
 }
 return passes;
}

// Text segmentation is a glyph mask, not a rectangle. Keep it at page
// resolution and include the outline/antialiasing lost by the detector grid.
struct RestorationMask {
 Box bounds{};std::vector<uint8_t> pixels;double character_size=0;int margin=0;
 json protectedNeighbors=json::array(),effectNeighbors=json::array(),segmentedNeighbors=json::array();
 size_t count=0;std::string reason;const Region* bubble=nullptr;
 std::vector<const Region*> enclosures;
 bool accepted()const{return reason.empty()&&count>0;}
};
inline bool restoration_masks_overlap(const RestorationMask& a,const RestorationMask& b){
 if(!overlap(a.bounds,b.bounds))return false;
 const int aw=a.bounds[2]-a.bounds[0],bw=b.bounds[2]-b.bounds[0];
 for(int y=std::max(a.bounds[1],b.bounds[1]);y<std::min(a.bounds[3],b.bounds[3]);y++)for(int x=std::max(a.bounds[0],b.bounds[0]);x<std::min(a.bounds[2],b.bounds[2]);x++)
  if(a.pixels[size_t(y-a.bounds[1])*aw+x-a.bounds[0]]&&b.pixels[size_t(y-b.bounds[1])*bw+x-b.bounds[0]])return true;
 return false;
}
inline std::vector<RestorationMask> restoration_mask_groups(const std::vector<std::pair<json,RestorationMask>>& masks){
 std::vector<RestorationMask> groups;
 for(const auto& item:masks){auto combined=item.second;
  for(size_t i=0;i<groups.size();)if(restoration_masks_overlap(combined,groups[i])){
   const auto& other=groups[i];const Box b{std::min(combined.bounds[0],other.bounds[0]),std::min(combined.bounds[1],other.bounds[1]),std::max(combined.bounds[2],other.bounds[2]),std::max(combined.bounds[3],other.bounds[3])};const int width=b[2]-b[0];std::vector<uint8_t> bits(size_t(width)*(b[3]-b[1]));
   for(const auto* source:std::array<const RestorationMask*,2>{&combined,&other}){const int sw=source->bounds[2]-source->bounds[0];for(int y=source->bounds[1];y<source->bounds[3];y++)for(int x=source->bounds[0];x<source->bounds[2];x++)bits[size_t(y-b[1])*width+x-b[0]]|=source->pixels[size_t(y-source->bounds[1])*sw+x-source->bounds[0]];}
   combined.bounds=b;combined.pixels=std::move(bits);combined.count=std::count(combined.pixels.begin(),combined.pixels.end(),uint8_t(1));groups.erase(groups.begin()+i);i=0;
  }else i++;
  groups.push_back(std::move(combined));
 }
 return groups;
}
inline bool restoration_box(const Box& b,const PageImage& image){return b[0]>=0&&b[1]>=0&&b[2]<=image.width&&b[3]<=image.height&&b[2]>b[0]&&b[3]>b[1];}
inline bool restoration_columns_covered(const json& row,const Box& bounds){
 if(!restoration_verified_columns(row))return true;
 for(const auto& value:row.at("textVerification").at("columns")){const auto b=value.get<Box>();if(double(overlap(b,bounds))/area(b)<.95)return false;}
 return true;
}
// Independently verified columns may have been merged for OCR/translation.
// Apply the same per-region budget to each column without dropping any pixel
// of the enclosing detector mask. Pixels outside all column margins veto it.
inline std::vector<size_t> restoration_column_pixels(const PageImage& image,const RestorationMask& mask,const json& row,int padding){
 if(!restoration_verified_columns(row)||padding<0||!restoration_box(mask.bounds,image))return {};
 const int w=mask.bounds[2]-mask.bounds[0],h=mask.bounds[3]-mask.bounds[1];if(mask.pixels.size()!=size_t(w)*h)return {};
 const auto columns=row.at("textVerification").at("columns").get<std::vector<Box>>();std::vector<size_t> counts(columns.size());size_t total=0;
 for(int y=0;y<h;++y)for(int x=0;x<w;++x)if(mask.pixels[size_t(y)*w+x]){
  const int px=x+mask.bounds[0],py=y+mask.bounds[1];size_t owner=columns.size();int64_t distance=INT64_MAX;
  for(size_t i=0;i<columns.size();++i){const auto& b=columns[i];const int dx=std::max({b[0]-px,0,px-b[2]+1}),dy=std::max({b[1]-py,0,py-b[3]+1});if(dx>padding||dy>padding)continue;const int64_t d=int64_t(dx)*dx+int64_t(dy)*dy;if(d<distance){distance=d;owner=i;}}
  if(owner==columns.size())return {};if(++counts[owner]>int64_t(image.width)*image.height*.08)return {};++total;
 }
 if(total!=mask.count||std::any_of(counts.begin(),counts.end(),[](size_t n){return n==0;}))return {};
 return counts;
}
inline bool region_pixel(const Region& region,int x,int y,int width,int height){
 if(region.mask_side<=0||region.mask.size()!=size_t(region.mask_side)*region.mask_side)return false;
 const int sx=std::clamp(int((x+.5)*region.mask_side/width),0,region.mask_side-1),sy=std::clamp(int((y+.5)*region.mask_side/height),0,region.mask_side-1);
 return region.mask[size_t(sy)*region.mask_side+sx]!=0;
}
inline size_t text_characters(const std::string& text){size_t n=0;for(unsigned char c:text)if((c&0xc0)!=0x80&&!std::isspace(c))n++;return n;}
// A containing balloon permits glyph-only restoration, never painting its
// whole area. Leave a page-scaled inset along its boundary; uncertain or merely
// nearby balloons still veto erasure.
inline bool restoration_interior(const Region& bubble,int x,int y,const PageImage& image){
 const int inset=std::max(2,int(std::ceil(2.*std::min(image.width,image.height)/720.)));
 if(x-inset<bubble.box[0]||y-inset<bubble.box[1]||x+inset>=bubble.box[2]||y+inset>=bubble.box[3])return false;
 for(int dy=-inset;dy<=inset;dy+=inset)for(int dx=-inset;dx<=inset;dx+=inset)if(!region_pixel(bubble,x+dx,y+dy,image.width,image.height))return false;
 return true;
}
inline RestorationMask restoration_mask(const PageImage& image,const Region& text,const json& recognized,const std::vector<Region>& detected,const json& all_text,const LayoutRaw* effectRaw=nullptr,const std::vector<const Region*>& enclosures={},bool verified_enclosure_reading=false){
 RestorationMask out;auto reject=[&](const char* why){out.reason=why;return out;};
 if(text.cls!=0||recognized.value("type",std::string{})!="text")return reject("effect");
 if(recognized.value("mode",std::string{})!="tooltip")return reject("already-replaced");
 if(ocr_punctuation::matches(recognized,image.width,image.height))return reject("uncertain-punctuation");
 if(recognized.value("ocrTruncated",false)||recognized.value("truncated",false)||recognized.value("text",std::string{}).empty()||recognized.value("translation",std::string{}).empty())return reject("incomplete-text");
 if(!ocr_context_sources_match(recognized,all_text))return reject("stale-ocr-context");
 if(text.score<.65f&&(!text.ocr_verified||!restoration_verified_text(recognized)||text.score<.2f))return reject("uncertain-detection");
 const double box_limit=text.ocr_verified&&restoration_verified_text(recognized)?.16:.08;
 if(!restoration_box(text.box,image)||area(text.box)>int64_t(image.width)*image.height*box_limit)return reject("large-or-invalid-region");
 for(const auto& r:detected)if(r.cls==2&&r.score>=.65f&&area(r.box)>area(text.box)*1.2&&area(r.box)<=int64_t(image.width)*image.height*.4&&mask_coverage(r,text.box,image.width,image.height)>=.9&&double(overlap(r.box,text.box))/area(text.box)>=.98){
  if(!out.bubble||area(r.box)<area(out.bubble->box))out.bubble=&r;
 }
 // Weak enclosures constrain glyph-only erasure. Their scores remain weak;
 // they never authorize painting the entire balloon or expanding text layout.
 if(!enclosures.empty()){
  if(out.bubble||enclosures.size()>8)return reject("conflicting-enclosure");
  for(const auto* enclosure:enclosures){
   if(!enclosure||!std::any_of(detected.begin(),detected.end(),[&](const Region& r){return &r==enclosure;})||enclosure->cls!=2||!std::isfinite(enclosure->score)||enclosure->score<.25f||enclosure->score>=.65f||area(enclosure->box)<=area(text.box)*1.2||area(enclosure->box)>int64_t(image.width)*image.height*.25||mask_coverage(*enclosure,text.box,image.width,image.height)<.98||double(overlap(enclosure->box,text.box))/area(text.box)<.98)return reject("invalid-enclosure");
  }
  out.bubble=enclosures.front();out.enclosures=enclosures;
 }
 const bool verified=text.ocr_verified&&restoration_verified_text(recognized);
 for(const auto& r:detected)if(r.cls==2&& &r!=out.bubble&&std::find(out.enclosures.begin(),out.enclosures.end(),&r)==out.enclosures.end()){const double coverage=mask_coverage(r,text.box,image.width,image.height),intersection=double(overlap(r.box,text.box))/area(text.box);
  if((coverage>.05||intersection>.25)&&!(verified&&!out.bubble&&coverage<=.5&&intersection<=.65))return reject("near-bubble");
 }
 if(text.mask_side<1||text.mask.size()!=size_t(text.mask_side)*text.mask_side)return reject("missing-segmentation");
 const double scale=std::min(image.width,image.height)/720.,cell=double(std::max(image.width,image.height))/text.mask_side;
 out.character_size=std::clamp(std::sqrt(double(area(text.box))/std::max(size_t(1),text_characters(recognized.value("text",std::string{})))),8*scale,48*scale);
 out.margin=std::max(1,int(std::ceil(std::clamp(cell*.55+out.character_size*.08,2*scale,7*scale))));
 const int search=std::max(out.margin+2,int(std::ceil(cell*2)));
 out.bounds=expand_box(text.box,search,image.width,image.height);
 const int w=out.bounds[2]-out.bounds[0],h=out.bounds[3]-out.bounds[1];
 std::vector<uint8_t> seeds(size_t(w)*h);size_t seed_count=0;
 for(int y=0;y<h;y++)for(int x=0;x<w;x++)if(region_pixel(text,x+out.bounds[0],y+out.bounds[1],image.width,image.height)){seeds[size_t(y)*w+x]=1;seed_count++;}
 if(seed_count<4||double(seed_count)/area(text.box)<.025)return reject("weak-segmentation");
 // Never clip the detected glyph itself. Only excess dilation may be clipped
 // to the containing balloon; a glyph touching its boundary stays a tooltip.
 const auto interior=[&](int x,int y){return (!out.bubble||restoration_interior(*out.bubble,x,y,image))&&std::all_of(out.enclosures.begin(),out.enclosures.end(),[&](const Region* r){return restoration_interior(*r,x,y,image);});};
 if(out.bubble)for(int y=0;y<h;y++)for(int x=0;x<w;x++)if(seeds[size_t(y)*w+x]&&!interior(x+out.bounds[0],y+out.bounds[1]))return reject("bubble-boundary");
 // A summed-area table makes the scale-aware dilation independent of radius.
 std::vector<int> sums(size_t(w+1)*(h+1));
 for(int y=0;y<h;y++){int row=0;for(int x=0;x<w;x++){row+=seeds[size_t(y)*w+x];sums[size_t(y+1)*(w+1)+x+1]=sums[size_t(y)*(w+1)+x+1]+row;}}
 out.pixels.resize(size_t(w)*h);
 for(int y=0;y<h;y++)for(int x=0;x<w;x++){
  const int x0=std::max(0,x-out.margin),y0=std::max(0,y-out.margin),x1=std::min(w,x+out.margin+1),y1=std::min(h,y+out.margin+1);
  out.pixels[size_t(y)*w+x]=sums[size_t(y1)*(w+1)+x1]-sums[size_t(y0)*(w+1)+x1]-sums[size_t(y1)*(w+1)+x0]+sums[size_t(y0)*(w+1)+x0]>0;
 }
 // Fill enclosed glyph counters only; never fill a paragraph-sized background
 // enclosed by several letters. Connected background remains untouched.
 std::vector<uint8_t> seen(out.pixels.size());std::vector<int> component;
 for(int start=0;start<w*h;start++){
  if(seen[start]||out.pixels[start])continue;seen[start]=1;component.clear();component.push_back(start);bool edge=false;
  for(size_t i=0;i<component.size();i++){int x=component[i]%w,y=component[i]/w;edge|=x==0||y==0||x==w-1||y==h-1;
   for(auto offset:std::array<std::array<int,2>,4>{{{{-1,0}},{{1,0}},{{0,-1}},{{0,1}}}}){int nx=x+offset[0],ny=y+offset[1];if(nx<0||nx>=w||ny<0||ny>=h)continue;int p=ny*w+nx;if(!seen[p]&&!out.pixels[p]){seen[p]=1;component.push_back(p);}}
  }
  if(!edge&&component.size()<=out.character_size*out.character_size)for(int p:component)out.pixels[p]=1;
 }
 for(int y=0;y<h;y++)for(int x=0;x<w;x++){
  auto& pixel=out.pixels[size_t(y)*w+x];if(pixel&&out.bubble&&!interior(x+out.bounds[0],y+out.bounds[1]))pixel=0;
  out.count+=pixel!=0;
 }
 if(out.count>area(text.box)*1.8)return reject("mask-too-large");
 // Column coordinates describe detected source glyphs. The completed mask
 // also includes dilation, so retain that same margin when assigning pixels.
 if(out.count>int64_t(image.width)*image.height*.08&&(!text.ocr_verified||restoration_column_pixels(image,out,recognized,search+out.margin).empty()))return reject("mask-too-large");
 // Protect every other recognized string, even ones left as tooltips. Only
 // added dilation may be trimmed; an overlapping source glyph still vetoes.
 for(const auto& other:all_text){
  if(other.value("id",-1)==recognized.value("id",-2)||!other.contains("bbox"))continue;
  const auto b=expand_box(other.at("bbox").get<Box>(),1,image.width,image.height);if(!overlap(b,out.bounds))continue;
  // Two independently verified labels may have overlapping rectangles without
  // overlapping strokes. Use the reconstructed neighbor's mask only when its
  // provenance and detector match are both available; otherwise keep the box.
  const Region* neighbor=nullptr;
  if(verified&&restoration_verified_text(other))for(const auto& r:detected)
   if(r.cls==0&&r.ocr_verified&&r.score>=.2f&&box_similarity(r.box,other.at("bbox").get<Box>())>=.95&&!r.mask.empty()&&std::any_of(r.mask.begin(),r.mask.end(),[](uint8_t p){return p!=0;})){neighbor=&r;break;}
  bool verifiedEffectNeighbor=false;
  // An independently verified single raw text detection may sit in the empty
  // corner of an effect rectangle. Retain the entire effect mask; never claim
  // any overlapping effect pixels as text.
  if(!neighbor&&verified&&!out.bubble&&restoration_verified_text(recognized)&&recognized.at("textVerification").at("sources").size()==1&&recognized.at("textVerification").at("sources")[0]==text.box&&text.box==recognized.at("bbox").get<Box>()&&std::abs(text.score-recognized.value("detectorConfidence",0.))<.0001&&restoration_effect_matches(text,effectRaw)){
   bool edited=false;for(const auto& row:{recognized,other})for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})edited|=row.value(flag,false);
   if(!edited&&other.value("type",std::string{})=="effect"&&!other.value("text",std::string{}).empty()){
    const Region* candidate=nullptr;bool ambiguous=false;
    for(const auto& r:detected)if(r.cls==1&&r.score>=.2f&&r.score<=1&&r.box==other.at("bbox").get<Box>()&&std::abs(r.score-other.value("detectorConfidence",0.))<.0001&&restoration_effect_matches(r,effectRaw)){if(candidate)ambiguous=true;candidate=&r;}
    if(candidate&&!ambiguous&&candidate->query!=text.query){neighbor=candidate;verifiedEffectNeighbor=true;}
   }
  }
  bool segmentedNeighbor=false;
  if(!neighbor&&!out.bubble&&restoration_neighbor_source(text,recognized,effectRaw)){
   const Region* candidate=nullptr;bool ambiguous=false;
   for(const auto& r:detected)if(restoration_neighbor_source(r,other,effectRaw)){if(candidate)ambiguous=true;candidate=&r;}
   if(candidate&&!ambiguous&&candidate->query!=text.query){neighbor=candidate;segmentedNeighbor=true;}
  }
  bool effectNeighbor=false;
  if(!neighbor&&!recognized.value("manual",false)&&!recognized.value("layoutOverride",false)&&!recognized.value("displayOverride",false)&&text.score>=.9f&&recognized.value("detectorConfidence",0.)>=.9&&box_similarity(text.box,recognized.at("bbox").get<Box>())>=.95&&std::abs(text.score-recognized.value("detectorConfidence",0.))<.0001&&other.value("type",std::string{})=="effect"&&!other.value("manual",false)&&!other.value("layoutOverride",false)&&!other.value("displayOverride",false)&&restoration_effect_matches(text,effectRaw))for(const auto& r:detected)
   if(r.cls==1&&r.score>=.2f&&r.score<.3f&&std::abs(r.score-other.value("detectorConfidence",0.))<.0001&&box_similarity(r.box,other.at("bbox").get<Box>())>=.95&&restoration_effect_matches(r,effectRaw)){neighbor=&r;effectNeighbor=true;break;}
  bool componentNeighbor=false;RestorationEffectComponents component;Region componentGuard;
  if(!neighbor&&verified&&!out.bubble){const Region* candidate=nullptr;bool ambiguous=false;for(const auto& r:detected)if(r.cls==1&&r.box==other.at("bbox").get<Box>()&&std::abs(r.score-other.value("detectorConfidence",0.))<.0001){if(candidate)ambiguous=true;candidate=&r;}if(candidate&&!ambiguous){component=restoration_effect_components(image,text,recognized,*candidate,other,effectRaw);if(component.accepted()){componentGuard=*candidate;componentGuard.mask=component.retained;neighbor=&componentGuard;componentNeighbor=true;}}}
  const bool scopedEffect=effectNeighbor&&verified_enclosure_reading&&!out.enclosures.empty()&&!other.value("ocrTruncated",false)&&!other.value("truncated",false)&&neighbor->box==other.at("bbox").get<Box>();
  const auto effectOwned=[&](int x,int y){return restoration_effect_owned(text,*neighbor,x,y,image,effectRaw)||(scopedEffect&&restoration_enclosure_effect_owned(text,*neighbor,x,y,image,effectRaw));};
  if(effectNeighbor){json runs=json::array();const int side=neighbor->mask_side;std::vector<uint8_t> bits=neighbor->mask;for(int y=0;y<side;y++)for(int x=0;x<side;x++)if(bits[size_t(y)*side+x]&&effectOwned(int((x+.5)*image.width/side),int((y+.5)*image.height/side)))bits[size_t(y)*side+x]=0;
   for(size_t i=0;i<bits.size();){if(!bits[i]){i++;continue;}auto start=i;while(i<bits.size()&&bits[i]&&i/side==start/side)i++;runs.push_back(start);runs.push_back(i-start);}
   out.effectNeighbors.push_back({{"id",other.at("id")},{"sourceText",other.at("text")},{"sourceBox",other.at("bbox")},{"method",scopedEffect?"enclosure-effect-mask":"weighted-effect-mask"},{"sourceConfidence",text.score},{"geometry",{{"width",side},{"height",side},{"bbox",neighbor->box},{"runs",runs},{"confidence",neighbor->score}}}});
  }
  else if(componentNeighbor){json runs=json::array();const int side=neighbor->mask_side;for(size_t i=0;i<neighbor->mask.size();){if(!neighbor->mask[i]){i++;continue;}const auto start=i;while(i<neighbor->mask.size()&&neighbor->mask[i]&&i/side==start/side)i++;runs.push_back(start);runs.push_back(i-start);}out.effectNeighbors.push_back({{"id",other.at("id")},{"sourceText",other.at("text")},{"sourceBox",other.at("bbox")},{"method","verified-source-effect-components"},{"sourceConfidence",recognized.at("detectorConfidence")},{"componentOwnership",component.proof},{"geometry",{{"width",side},{"height",side},{"bbox",neighbor->box},{"runs",runs},{"confidence",neighbor->score}}}});}
  else if(segmentedNeighbor||verifiedEffectNeighbor){
   json runs=json::array();const int side=neighbor->mask_side;
   for(size_t i=0;i<neighbor->mask.size();){if(!neighbor->mask[i]){i++;continue;}const auto start=i;while(i<neighbor->mask.size()&&neighbor->mask[i]&&i/side==start/side)i++;runs.push_back(start);runs.push_back(i-start);}
   out.segmentedNeighbors.push_back({{"id",other.at("id")},{"sourceText",other.at("text")},{"sourceBox",other.at("bbox")},{"sourceConfidence",text.score},{"geometry",{{"width",side},{"height",side},{"bbox",neighbor->box},{"runs",runs},{"confidence",neighbor->score}}}});
   if(verifiedEffectNeighbor)out.segmentedNeighbors.back()["sourceVerification"]=recognized.at("textVerification");
  }
  else if(neighbor)out.protectedNeighbors.push_back({{"id",other.at("id")},{"sourceText",other.at("text")},{"sourceBox",other.at("bbox")},{"verification",other.at("textVerification")}});
 auto protected_neighbor=[&](int x,int y){if(!neighbor)return true;if(effectNeighbor&&region_pixel(text,x,y,image.width,image.height)&&effectOwned(x,y))return false;for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)if(region_pixel(*neighbor,x+dx,y+dy,image.width,image.height))return true;return false;};
  for(int y=std::max(b[1],out.bounds[1]);y<std::min(b[3],out.bounds[3]);y++)for(int x=std::max(b[0],out.bounds[0]);x<std::min(b[2],out.bounds[2]);x++)if(protected_neighbor(x,y)&&seeds[size_t(y-out.bounds[1])*w+x-out.bounds[0]])return reject("neighbor-text");
  for(int y=std::max(b[1],out.bounds[1]);y<std::min(b[3],out.bounds[3]);y++)for(int x=std::max(b[0],out.bounds[0]);x<std::min(b[2],out.bounds[2]);x++){auto& pixel=out.pixels[size_t(y-out.bounds[1])*w+x-out.bounds[0]];if(pixel&&protected_neighbor(x,y)){pixel=0;out.count--;}}
 }
 for(const auto& r:detected){
  if((r.cls!=1&&r.cls!=2)||&r==out.bubble||std::find(out.enclosures.begin(),out.enclosures.end(),&r)!=out.enclosures.end()||r.score<(verified&&r.cls==2?.25:.5)||!overlap(r.box,out.bounds))continue;
  bool collision=false;for(int y=out.bounds[1];y<out.bounds[3];y++)for(int x=out.bounds[0];x<out.bounds[2];x++)if(out.pixels[size_t(y-out.bounds[1])*w+x-out.bounds[0]]&&region_pixel(r,x,y,image.width,image.height))collision=true;
  if(!collision)continue;
  // A neighboring balloon may meet only the added erasure margin. Preserve
  // its boundary without shaving any detected glyph from the source text.
  // A nearby glyph may occupy padding, but must never enter the protected mask.
  const int inset=std::max(2,int(std::ceil(2*scale)));const auto protected_pixel=[&](int x,int y){for(int dy=-inset;dy<=inset;dy+=inset)for(int dx=-inset;dx<=inset;dx+=inset)if(region_pixel(r,x+dx,y+dy,image.width,image.height))return true;return false;};
  for(int y=0;y<h;y++)for(int x=0;x<w;x++)if(seeds[size_t(y)*w+x]&&region_pixel(r,x+out.bounds[0],y+out.bounds[1],image.width,image.height))return reject(r.cls==2?"bubble-mask-collision":"effect-mask-collision");
  for(int y=0;y<h;y++)for(int x=0;x<w;x++)if(out.pixels[size_t(y)*w+x]&&!seeds[size_t(y)*w+x]&&protected_pixel(x+out.bounds[0],y+out.bounds[1])){out.pixels[size_t(y)*w+x]=0;out.count--;}
 }
 return out;
}

// Recheck a coarse boundary in a crop with page context, then in a closer crop.
// Both detections must agree on the existing balloon. Keep its classification
// confidence; refine only geometry. Missing/uncertain crop balloons never
// authorize outside restoration, and the same boundary guard runs again.
// A refined main column must retain the independently recognized annotations
// already owned by this region. Reproject their local coarse mask at the
// refined resolution; the normal neighbor/bubble guards still validate it.
inline bool restoration_keep_annotations(Region& refined,const Region& original,const json& row,const PageImage& image){
 if(!row.contains("textVerification")||!row.at("textVerification").contains("rubyAnnotations"))return true;
 const auto& annotations=row.at("textVerification").at("rubyAnnotations");
 if(!annotations.is_array()||annotations.empty()||annotations.size()>4||!restoration_verified_text(row)||!original.ocr_verified)return false;
 if(refined.mask_side<1||refined.mask.size()!=size_t(refined.mask_side)*refined.mask_side||original.mask_side<1||original.mask.size()!=size_t(original.mask_side)*original.mask_side)return false;
 const auto box=row.at("bbox").get<Box>();std::vector<Box> areas;
 const int margin=int(std::ceil(2.*std::max(image.width,image.height)/original.mask_side));
 for(const auto& annotation:annotations){
  if(!annotation.contains("bbox")||!annotation.at("bbox").is_array()||annotation.at("bbox").size()!=4)return false;
  const auto b=annotation.at("bbox").get<Box>();if(area(b)<=0||double(overlap(b,box))/area(b)<.95)return false;
  areas.push_back(expand_box(b,margin,image.width,image.height));
 }
 const double cell_x=double(image.width)/refined.mask_side,cell_y=double(image.height)/refined.mask_side;
 for(int y=0;y<refined.mask_side;++y)for(int x=0;x<refined.mask_side;++x){
  const int px=int((x+.5)*cell_x),py=int((y+.5)*cell_y);if(px>=image.width||py>=image.height)continue;
  if(std::any_of(areas.begin(),areas.end(),[&](const Box& b){return px>=b[0]&&px<b[2]&&py>=b[1]&&py<b[3];})&&region_pixel(original,px,py,image.width,image.height))refined.mask[size_t(y)*refined.mask_side+x]=1;
 }
 refined.box=box;return true;
}
// Retry geometry only for a uniquely matched, reliable ordinary text source.
// This is not OCR consensus: refined sources retain normal score/class guards.
inline bool restoration_ordinary_refinement(const json& row,const Region& source,const RestorationMask& coarse,const std::vector<Region>& detected){
 if(coarse.bubble||coarse.reason!="bubble-mask-collision"||row.value("type",std::string{})!="text"||row.value("mode",std::string{})!="tooltip"||row.value("manual",false)||row.value("layoutOverride",false)||row.value("displayOverride",false)||row.value("ocrTruncated",false)||row.value("truncated",false)||row.value("text",std::string{}).empty()||row.value("translation",std::string{}).empty()||row.contains("textVerification"))return false;
 const double score=row.value("detectorConfidence",0.);
 if(source.cls!=0||!std::isfinite(score)||score<.85||score>1||!std::isfinite(source.score)||source.score<.85f||source.score>1||source.box!=row.at("bbox").get<Box>()||std::abs(source.score-score)>=.0001||source.mask_side<3||source.mask_side>512||source.mask.size()!=size_t(source.mask_side)*source.mask_side)return false;
 return std::count_if(detected.begin(),detected.end(),[&](const Region& r){return r.cls==0&&r.box==source.box&&std::abs(r.score-score)<.0001;})==1;
}
inline size_t restoration_refine_masks(const PageImage& image,OnnxLayout& detector,std::vector<Region>& detected,const json& recognized,const std::function<void()>& check_cancel){
 struct Detail {Box crop;std::vector<Region> regions;};std::vector<Detail> details;
 for(const auto& row:recognized){
  if(row.value("type",std::string{})!="text"||row.value("mode",std::string{})!="tooltip")continue;
  const auto box=row.at("bbox").get<Box>();size_t selected=detected.size();double match=.65;
  for(size_t i=0;i<detected.size();i++)if(detected[i].cls==0){const double score=double(overlap(box,detected[i].box))/std::max(1,std::max(area(box),area(detected[i].box)));if(score>=match){selected=i;match=score;}}
  if(selected==detected.size())continue;
  const auto coarse=restoration_mask(image,detected[selected],row,detected,recognized);
  // Coarse glyph masks can spill into an adjacent verified label or ruby.
  // Tiny annotations can also exceed the area limit from coarse-grid dilation.
  // Retry at crop resolution; all original size and neighbor guards still apply.
  const bool verified_outside=detected[selected].ocr_verified&&restoration_verified_text(row)&&!coarse.bubble&&(coarse.reason=="bubble-mask-collision"||coarse.reason=="effect-mask-collision"||coarse.reason=="neighbor-text"||coarse.reason=="mask-too-large");
  const bool ordinary_outside=restoration_ordinary_refinement(row,detected[selected],coarse,detected);
  const bool outside_refinement=verified_outside||ordinary_outside;
  if(!outside_refinement&&(coarse.reason!="bubble-boundary"||!coarse.bubble))continue;
  const size_t owner=coarse.bubble?size_t(coarse.bubble-detected.data()):detected.size();const auto bounds=coarse.bubble?coarse.bubble->box:box;const double scale=std::min(image.width,image.height)/720.;
  const int close_side=int(std::ceil(std::max(384*scale,std::max(bounds[2]-bounds[0],bounds[3]-bounds[1])+128*scale)));
  std::set<Box> tried;
  for(const int side:{std::max(std::min(image.width,image.height),close_side),close_side}){
   const int width=std::min(side,image.width),height=std::min(side,image.height),left=std::clamp((bounds[0]+bounds[2]-width)/2,0,image.width-width),top=std::clamp((bounds[1]+bounds[3]-height)/2,0,image.height-height);const Box crop{left,top,left+width,top+height};
   if(!tried.insert(crop).second)continue;
   auto detail=std::find_if(details.begin(),details.end(),[&](const Detail& d){return d.crop==crop;});
   if(detail==details.end()){
    check_cancel();PageImage local{width,height,std::vector<uint8_t>(size_t(width)*height*3)};
    for(int y=0;y<height;y++)std::copy_n(image.rgb.data()+(size_t(y+top)*image.width+left)*3,width*3,local.rgb.data()+size_t(y)*width*3);
    auto input=layout_input(local,false,false,detector.input_side());auto regions=decode_regions(detector.run(input),width,height);details.push_back({crop,{}});detail=std::prev(details.end());
    for(const auto& region:regions)if(region.cls<3)detail->regions.push_back(project_region(region,crop,image.width,image.height,512));
   }
   const Region* replacement=nullptr;match=.65;
   for(const auto& region:detail->regions)if((region.cls==0||(verified_outside&&region.cls==1))&&region.score>=(verified_outside?.2f:.65f)){const double score=double(overlap(box,region.box))/std::max(1,std::max(area(box),area(region.box)));if(score>=match){replacement=&region;match=score;}}
   if(!replacement||!restoration_columns_covered(row,replacement->box))continue;
   auto refined=detected;refined[selected]=*replacement;
   if(verified_outside){refined[selected].cls=0;refined[selected].ocr_verified=true;if(!restoration_keep_annotations(refined[selected],detected[selected],row,image))continue;}
   const Region* balloon=nullptr;double agreement=.8;
   for(const auto& region:detail->regions)if(region.cls==2&&region.score>=.5f){const double score=box_similarity(bounds,region.box);if(score>=agreement){balloon=&region;agreement=score;}}
   if(balloon&&owner<detected.size()){refined[owner]=*balloon;refined[owner].score=std::max(detected[owner].score,balloon->score);refined[owner].detail_verified=true;}
   if(outside_refinement)for(size_t i=0;i<detected.size();i++)if(detected[i].cls==2){
    const Region* neighbor=nullptr;double agreement=.8;
    for(const auto& region:detail->regions)if(region.cls==2&&region.score>=.5f){const double score=box_similarity(detected[i].box,region.box);if(score>=agreement){neighbor=&region;agreement=score;}}
    if(neighbor){refined[i]=*neighbor;refined[i].score=std::max(detected[i].score,neighbor->score);refined[i].detail_verified=true;}
   }
   for(const auto& region:detail->regions)if(region.cls==1&&region.score>=.5f&&!(verified_outside&&box_similarity(region.box,replacement->box)>.65)&&std::none_of(refined.begin(),refined.end(),[&](const Region& r){return r.cls==1&&box_similarity(r.box,region.box)>.8;}))refined.push_back(region);
   if(restoration_mask(image,refined[selected],row,refined,recognized).accepted()){detected=std::move(refined);break;}
  }
 }
 return details.size();
}
