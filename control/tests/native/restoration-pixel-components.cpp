#include "../../../native/restoration_isolated.hpp"
#include <cassert>
int main(){PageImage image{100,200,std::vector<uint8_t>(100*200*3,255)};Region source{0,0,.7f,{40,50,48,80},std::vector<uint8_t>(200*200),200};for(int y=50;y<80;y++)for(int x=40;x<48;x++)source.mask[y*200+x*2]=source.mask[y*200+x*2+1]=1;auto ink=[&](int x,int y){for(int c=0;c<3;c++)image.rgb[(y*100+x)*3+c]=0;};for(int y:{54,68})for(int dy=0;dy<6;dy++)for(int x=42;x<46;x++)ink(x,y+dy);json row={{"id",1},{"type","text"},{"mode","tooltip"},{"bbox",source.box},{"box",source.box},{"detectorConfidence",source.score},{"text","AB"},{"translation","번역"}};json rows=json::array({row});std::vector<Region> detected{source};std::vector<IsolatedGlyphView> views(3,{{0,0,100,200},source,1});size_t checks=0;auto call=[&](){return restoration_isolated_components(image,source,row,views,detected,rows,nullptr,false,true);};auto good=call();assert(good.mask.accepted()&&good.proof["method"]=="isolated-pixel-components"&&good.proof["foregroundResidualFraction"]==0);checks++;
 std::fill(views[0].text.mask.begin(),views[0].text.mask.end(),0);assert(!restoration_isolated_components(image,source,row,views,detected,rows).mask.accepted());assert(call().mask.accepted());checks++;
 auto saved=views;views[1].agreement=.89;assert(!call().mask.accepted());views=saved;checks++;
 source.score=.64;assert(!call().mask.accepted());source.score=.7;checks++;
 auto original=image;ink(40,51);assert(call().mask.accepted());image=original;checks++;for(int y=5;y<52;y++)ink(40,y);assert(call().mask.reason=="isolated-unclaimed-foreground");image=original;checks++;
 for(int y=20;y<55;y++)ink(42,y);assert(!call().mask.accepted());image=original;checks++;
 auto neighbor=row;neighbor["id"]=2;rows.push_back(neighbor);assert(!call().mask.accepted());rows.erase(1);checks++;

 // Unselected foreground belonging to an unchanged neighboring detection is
 // protected, not misreported as a missing source glyph. Forged masks fail.
 {
  auto savedImage=image;for(int y=5;y<52;y++)ink(40,y);
  auto peer=source;peer.query=1;peer.box={35,5,41,52};std::fill(peer.mask.begin(),peer.mask.end(),0);for(int y=5;y<52;y++)peer.mask[y*200+80]=peer.mask[y*200+81]=1;
  auto other=row;other["id"]=2;other["text"]="CD";other["bbox"]=peer.box;other["box"]=peer.box;
  std::vector<Region> ds{source,peer};json rs=json::array({row,other});LayoutRaw raw;raw.mask_side=200;for(const auto& d:ds){raw.logits.insert(raw.logits.end(),{std::log(d.score/(1-d.score)),-10,-10,-10,-10});for(auto v:d.mask)raw.masks.push_back(v?1:-1);}
  auto run=[&](){return restoration_isolated_components(image,source,row,views,ds,rs,&raw,false,true);};assert(run().mask.accepted());checks++;
  ds[1].mask[0]=1;assert(!run().mask.accepted());ds[1]=peer;checks++;
  rs[1]["manual"]=true;assert(!run().mask.accepted());checks++;
  image=savedImage;
 }
 views.pop_back();assert(!call().mask.accepted());checks++;
 std::cout<<"PASS "<<checks<<" pixel component guards\n";}
