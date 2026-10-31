#include "../../../native/restoration_isolated.hpp"
#include <cassert>
int main(){
 PageImage image{100,200,std::vector<uint8_t>(100*200*3,255)};Region source{0,0,.7f,{40,50,48,80},std::vector<uint8_t>(200*200),200};
 for(int y=50;y<80;y++)for(int x=40;x<48;x++)source.mask[y*200+x*2]=source.mask[y*200+x*2+1]=1;
 auto ink=[&](int x,int y){for(int c=0;c<3;c++)image.rgb[(y*100+x)*3+c]=0;};for(int y:{54,68})for(int dy=0;dy<6;dy++)for(int x=42;x<46;x++)ink(x,y+dy);
 json row={{"id",1},{"type","text"},{"mode","tooltip"},{"bbox",source.box},{"box",source.box},{"detectorConfidence",source.score},{"text","AB"},{"translation","번역"}};json rows=json::array({row});std::vector<Region> detected{source};std::vector<IsolatedGlyphView> views(3,{{0,0,100,200},source,1});size_t checks=0;
 auto call=[&](){return restoration_isolated_components(image,source,row,views,detected,rows);};
 auto good=call();assert(good.mask.accepted()&&good.proof.at("glyphPixels")==48&&good.proof.at("components").size()==2);checks++;
 // A separate background mark must remain pixel-identical even inside dilation.
 ink(40,53);good=call();assert(good.mask.accepted());const auto b=good.mask.bounds;assert(!good.mask.pixels[(53-b[1])*(b[2]-b[0])+40-b[0]]);checks++;
 // Connecting text to a long contour must reject the whole candidate.
 auto saved=image;for(int y=20;y<55;y++)ink(42,y);assert(!call().mask.accepted());image=saved;checks++;
 auto changed=views;std::fill(views[0].text.mask.begin(),views[0].text.mask.end(),0);assert(!call().mask.accepted());views=changed;checks++;
 views[1].agreement=.89;assert(!call().mask.accepted());views=changed;checks++;
 views.pop_back();assert(!call().mask.accepted());views=changed;checks++;
 auto peer=row;peer["id"]=2;peer["bbox"]=Box{42,54,46,60};rows.push_back(peer);assert(!call().mask.accepted());rows=json::array({row});checks++;
 auto effect=source;effect.cls=1;effect.score=.2;detected.push_back(effect);assert(!call().mask.accepted());detected.pop_back();checks++;
 const float score=source.score;source.score=.64;assert(!call().mask.accepted());source.score=score;checks++;
 // The raw-source link rejects fabricated masks, scores, edits, and lost proof.
 LayoutRaw raw;raw.mask_side=200;raw.logits={std::log(.7f/.3f),-10,-10,-10,-10};raw.masks.resize(200*200);for(size_t i=0;i<source.mask.size();i++)raw.masks[i]=source.mask[i]?1:-1;
 assert(restoration_original_source(row,detected,raw));checks++;
 for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){auto bad=row;bad[flag]=true;assert(!restoration_original_source(bad,detected,raw));checks++;}
 auto bad=row;bad["bbox"]=Box{39,50,48,80};assert(!restoration_original_source(bad,detected,raw));checks++;
 bad=row;bad["detectorConfidence"]=.8;assert(!restoration_original_source(bad,detected,raw));checks++;
 detected[0].mask[0]=1;assert(!restoration_original_source(row,detected,raw));detected[0]=source;checks++;
 bad=row;bad["ocrDuplicateGeometry"]={{"version",1}};assert(!restoration_original_source(bad,detected,raw));checks++;
 auto fragment=row;fragment["id"]=2;fragment["text"]="A";fragment["bbox"]=Box{39,50,46,65};fragment["box"]=fragment["bbox"];fragment["detectorConfidence"]=.3f;
 auto child=source;child.query=1;child.box=fragment["bbox"].get<Box>();child.score=.3f;detected.push_back(child);raw.logits.insert(raw.logits.end(),{std::log(.3f/.7f),-10,-10,-10,-10});for(auto pixel:child.mask)raw.masks.push_back(pixel?1:-1);
 auto merged=json::array({row,fragment});assert(deduplicate_ocr(merged)==1&&merged[0].contains("ocrDuplicateGeometry"));assert(restoration_original_source(merged[0],detected,raw));checks++;
 for(const auto* field:{"sourceBox","sourceText","source","fragments"}){auto stale=merged[0];stale["ocrDuplicateGeometry"].erase(field);assert(!restoration_original_source(stale,detected,raw));checks++;}
 auto stale=merged[0];stale["ocrDuplicateGeometry"]["fragments"][0]["text"]="Z";assert(!restoration_original_source(stale,detected,raw));checks++;
 stale=merged[0];stale["text"]="AC";assert(!restoration_original_source(stale,detected,raw));checks++;
 stale=merged[0];stale["ocrDuplicateGeometry"]["fragments"].push_back(fragment);assert(!restoration_original_source(stale,detected,raw));checks++;
 auto composite=fragment;composite["textVerification"]={{"version",1},{"method","ocr-consensus"},{"role","DIALOGUE"},{"sources",json::array({Box{39,50,46,57},Box{39,57,46,65}})}};
 detected.back().box={39,50,46,57};auto second=detected.back();second.query=2;second.box={39,57,46,65};second.score=.25f;detected.push_back(second);raw.logits.insert(raw.logits.end(),{std::log(.25f/.75f),-10,-10,-10,-10});for(auto pixel:second.mask)raw.masks.push_back(pixel?1:-1);
 merged=json::array({row,composite});deduplicate_ocr(merged);assert(restoration_original_source(merged[0],detected,raw));checks++;
 for(const auto* change:{"method","role","sources","confidence"}){auto corrupt=merged[0];auto& fragment=corrupt["ocrDuplicateGeometry"]["fragments"][0];if(std::string(change)=="sources")fragment["textVerification"]["sources"][0][0]=38;else if(std::string(change)=="confidence")fragment["detectorConfidence"]=.4;else fragment["textVerification"][change]="invalid";assert(!restoration_original_source(corrupt,detected,raw));checks++;}
 // A large enclosing peer rectangle must not block disjoint glyph masks.
 {
  auto src=source;src.score=.95f;auto r=row;r["detectorConfidence"]=src.score;
  auto peer=src;peer.query=1;peer.box={35,45,65,85};std::fill(peer.mask.begin(),peer.mask.end(),0);
  for(int y=50;y<80;y++)for(int x=58;x<62;x++)peer.mask[y*200+x*2]=peer.mask[y*200+x*2+1]=1;
  auto pr=r;pr["id"]=2;pr["text"]="CD";pr["bbox"]=peer.box;pr["box"]=peer.box;
  std::vector<Region> ds{src,peer};json rs=json::array({r,pr});
  LayoutRaw evidence;evidence.mask_side=200;
  for(const auto& d:ds){evidence.logits.insert(evidence.logits.end(),{std::log(d.score/(1-d.score)),-10,-10,-10,-10});for(auto v:d.mask)evidence.masks.push_back(v?1:-1);}
  auto run=[&](const LayoutRaw* raw){return restoration_isolated_components(image,src,r,views,ds,rs,raw);};
  auto ok=run(&evidence);assert(ok.mask.accepted()&&ok.mask.segmentedNeighbors.size()==1);checks++;
  assert(!run(nullptr).mask.accepted());checks++;
  for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated"}){rs[1][flag]=true;assert(!run(&evidence).mask.accepted());rs[1].erase(flag);checks++;}
  ds.push_back(peer);assert(!run(&evidence).mask.accepted());ds.pop_back();checks++;
  ds[1].mask[0]=1;assert(!run(&evidence).mask.accepted());ds[1]=peer;checks++;
  ds[1].mask=src.mask;for(size_t k=0;k<src.mask.size();k++)evidence.masks[src.mask.size()+k]=src.mask[k]?1:-1;
  assert(!run(&evidence).mask.accepted());checks++;
 }
 std::cout<<"PASS "<<checks<<" isolated glyph and source guards\n";
}
