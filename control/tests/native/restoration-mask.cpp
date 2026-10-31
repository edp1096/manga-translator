#include "../../../native/restoration_mask.hpp"
#include <cassert>
int main(){
 size_t checks=0;
 for(int scale:{1,2,4}){
  PageImage image{720*scale,1020*scale,{}};Region text{0,0,.95f,{200*scale,300*scale,260*scale,400*scale},std::vector<uint8_t>(192*192),192};
  for(int y=0;y<192;y++)for(int x=0;x<192;x++){double px=(x+.5)*720/192,py=(y+.5)*1020/192;if(px>=205&&px<252&&py>=308&&py<392)text.mask[y*192+x]=1;}
  json row={{"id",1},{"type","text"},{"mode","tooltip"},{"bbox",text.box},{"text","これは独白です"},{"translation","독백입니다"}};
  const auto good=restoration_mask(image,text,row,{text},json::array({row}));assert(good.accepted());assert(good.margin>=3*scale&&good.margin<=7*scale);assert(good.count>0&&good.count<size_t(area(text.box)*1.8));checks++;
  auto neighbor=row;neighbor["id"]=2;neighbor["bbox"]=Box{240*scale,300*scale,280*scale,400*scale};assert(restoration_mask(image,text,row,{text},json::array({row,neighbor})).reason=="neighbor-text");checks++;
  Region balloon=text;balloon.cls=2;assert(restoration_mask(image,text,row,{text,balloon},json::array({row})).reason=="near-bubble");checks++;
  balloon.box={180*scale,270*scale,300*scale,430*scale};balloon.score=.72f;
  for(int y=0;y<192;y++)for(int x=0;x<192;x++){double px=(x+.5)*720/192,py=(y+.5)*1020/192;balloon.mask[y*192+x]=px>=180&&px<300&&py>=270&&py<430;}
  std::vector<Region> connected{text,balloon};auto restored=restoration_mask(image,text,row,connected,json::array({row}));assert(restored.accepted()&&restored.bubble==&connected[1]);
  for(int y=restored.bounds[1];y<restored.bounds[3];y++)for(int x=restored.bounds[0];x<restored.bounds[2];x++)if(restored.pixels[size_t(y-restored.bounds[1])*(restored.bounds[2]-restored.bounds[0])+x-restored.bounds[0]])assert(restoration_interior(connected[1],x,y,image));checks++;
  connected[1].score=.64f;assert(restoration_mask(image,text,row,connected,json::array({row})).reason=="near-bubble");checks++;
  connected[1].score=.72f;connected[1].mask[65*192+60]=0;
  assert(restoration_mask(image,text,row,connected,json::array({row})).reason=="bubble-boundary");checks++;
  connected[1]=balloon;auto overlap_text=row;overlap_text["id"]=99;overlap_text["bbox"]=Box{240*scale,300*scale,270*scale,400*scale};assert(restoration_mask(image,text,row,connected,json::array({row,overlap_text})).reason=="neighbor-text");checks++;
  Region effect=text;effect.cls=1;assert(restoration_mask(image,text,row,{text,effect},json::array({row})).reason=="effect-mask-collision");checks++;
  for(const auto& field:{"ocrTruncated","truncated"}){auto clipped=row;clipped[field]=true;assert(restoration_mask(image,text,clipped,{text},json::array({clipped})).reason=="incomplete-text");checks++;}
  auto empty=text;std::fill(empty.mask.begin(),empty.mask.end(),0);assert(restoration_mask(image,empty,row,{empty},json::array({row})).reason=="weak-segmentation");checks++;
  auto weak=text;weak.score=.5;assert(restoration_mask(image,weak,row,{weak},json::array({row})).reason=="uncertain-detection");checks++;
  auto verified=row;verified["textVerification"]={{"version",1},{"method","ocr-consensus"},{"role","LABEL"},{"sources",json::array({weak.box})}};
  assert(restoration_mask(image,weak,verified,{weak},json::array({verified})).reason=="uncertain-detection");checks++;
  std::vector<Region> reconstructed{weak};restoration_verified_regions(reconstructed,json::array({verified}));assert(reconstructed.size()==1&&reconstructed[0].ocr_verified);assert(restoration_mask(image,reconstructed[0],verified,reconstructed,json::array({verified})).accepted());checks++;
  auto invalid=verified;invalid["textVerification"]["role"]="EFFECT";assert(!restoration_verified_text(invalid));checks++;
  invalid=verified;invalid["textVerification"]["sources"]=json::array({Box{0,0,10,10}});assert(!restoration_verified_text(invalid));checks++;
  invalid=verified;invalid["textVerification"]["sources"]=json::array({Box{200*scale,300*scale,230*scale,330*scale}});reconstructed={weak};restoration_verified_regions(reconstructed,json::array({invalid}));assert(!reconstructed[0].ocr_verified);checks++;
  // Overlapping label rectangles are safe only with separate verified masks.
  Region separate=text;separate.box={240*scale,300*scale,290*scale,400*scale};separate.ocr_verified=true;
  for(int y=0;y<192;y++)for(int x=0;x<192;x++){double px=(x+.5)*720/192,py=(y+.5)*1020/192;separate.mask[y*192+x]=px>=270&&px<285&&py>=308&&py<392;}
  auto label=verified;label["id"]=2;label["bbox"]=separate.box;label["textVerification"]["sources"]=json::array({separate.box});
  auto source=text;source.ocr_verified=true;std::vector<Region> pair{source,separate};auto labels=json::array({verified,label});
  const auto safeNeighbor=restoration_mask(image,pair[0],verified,pair,labels);assert(safeNeighbor.accepted());assert(safeNeighbor.protectedNeighbors.size()==1&&safeNeighbor.protectedNeighbors[0].at("verification")==label.at("textVerification"));checks++;
  pair[1].ocr_verified=false;assert(restoration_mask(image,pair[0],verified,pair,labels).reason=="neighbor-text");checks++;
  pair[1]=separate;pair[1].mask=text.mask;assert(restoration_mask(image,pair[0],verified,pair,labels).reason=="neighbor-text");checks++;
  pair[1]=separate;std::fill(pair[1].mask.begin(),pair[1].mask.end(),0);assert(restoration_mask(image,pair[0],verified,pair,labels).reason=="neighbor-text");checks++;
  pair[1]=separate;labels[1].erase("textVerification");assert(restoration_mask(image,pair[0],verified,pair,labels).reason=="neighbor-text");checks++;
  // A neighboring balloon meets only the added margin: keep every source
  // glyph while excluding every protected balloon pixel from the erasure.
  Region close=balloon;close.box={255*scale,290*scale,340*scale,420*scale};
  for(int y=0;y<192;y++)for(int x=0;x<192;x++){double px=(x+.5)*720/192,py=(y+.5)*1020/192;close.mask[y*192+x]=px>=255&&px<340&&py>=290&&py<420;}
  std::vector<Region> adjacent{text,close};adjacent[0].ocr_verified=true;auto marginOnly=restoration_mask(image,adjacent[0],verified,adjacent,json::array({verified}));assert(marginOnly.accepted());
  for(int y=marginOnly.bounds[1];y<marginOnly.bounds[3];y++)for(int x=marginOnly.bounds[0];x<marginOnly.bounds[2];x++){auto pixel=marginOnly.pixels[size_t(y-marginOnly.bounds[1])*(marginOnly.bounds[2]-marginOnly.bounds[0])+x-marginOnly.bounds[0]];if(region_pixel(text,x,y,image.width,image.height))assert(pixel);if(region_pixel(close,x,y,image.width,image.height))assert(!pixel);}checks++;
  auto changed=row;changed["mode"]="replace";assert(restoration_mask(image,text,changed,{text},json::array({changed})).reason=="already-replaced");checks++;
 }
 LayoutRaw raw;raw.mask_side=1;raw.masks={1};raw.boxes={230.f/720,355.f/1020,80.f/720,150.f/1020};raw.logits={-5,-5,-.8473f,-5,-5};
 json candidate={{"id",1},{"type","text"},{"mode","tooltip"},{"bbox",Box{200,300,260,400}}};std::vector<Region> guards;
 restoration_uncertain_bubbles(raw,720,1020,json::array({candidate}),guards);assert(guards.size()==1&&guards[0].cls==2);checks++;
 guards.clear();raw.logits[2]=-2;restoration_uncertain_bubbles(raw,720,1020,json::array({candidate}),guards);assert(guards.empty());checks++;
 raw.logits[2]=-.8473f;candidate["bbox"]=Box{500,500,550,550};restoration_uncertain_bubbles(raw,720,1020,json::array({candidate}),guards);assert(guards.empty());checks++;
 json large={{"bbox",Box{100,100,340,450}},{"textVerification",{{"version",1},{"method","ocr-consensus"},{"role","LABEL"},{"sources",json::array({Box{100,100,340,450}})},{"columns",json::array({Box{100,100,210,450},Box{230,100,340,450}})}}}};
 assert(restoration_verified_columns(large));checks++;
 auto badColumns=large;badColumns["textVerification"]["columns"][1]=Box{100,100,210,450};assert(!restoration_verified_columns(badColumns));checks++;
 badColumns=large;badColumns["textVerification"]["columns"][1]=Box{300,100,400,450};assert(!restoration_verified_columns(badColumns));checks++;
 badColumns=large;badColumns["textVerification"]["columns"]=json::array({Box{100,100,210,450}});assert(!restoration_verified_columns(badColumns));checks++;
 RestorationMask a,b,c;a.bounds={0,0,4,4};a.pixels.assign(16,0);a.pixels[5]=1;a.pixels[10]=1;a.count=2;
 b.bounds={1,1,5,5};b.pixels.assign(16,0);b.pixels[5]=1;b.pixels[10]=1;b.count=2;
 c.bounds={0,0,4,4};c.pixels.assign(16,0);c.pixels[3]=1;c.count=1;
 auto groups=restoration_mask_groups({{json{},a},{json{},c},{json{},b}});assert(groups.size()==2);checks++;
 size_t pixels=0;for(const auto& group:groups)pixels+=group.count;assert(pixels==4);checks++;
 assert(restoration_masks_overlap(a,b)&&!restoration_masks_overlap(a,c));checks++;
 assert(text_characters("日本語 a ")==4);std::cout<<"PASS "<<checks<<" mask guards at 1x/2x/4x, unicode character sizing, verified columns and exact mask unions\n";
}
