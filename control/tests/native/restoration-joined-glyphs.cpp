#include "../../../native/restoration_isolated.hpp"
#include <cassert>
int main(){PageImage image{100,200,std::vector<uint8_t>(100*200*3,255)};Region source{0,0,.7f,{40,50,48,80},std::vector<uint8_t>(200*200),200};for(int y=50;y<80;y++)for(int x=40;x<48;x++)source.mask[y*200+x*2]=source.mask[y*200+x*2+1]=1;auto ink=[&](int x,int y){for(int c=0;c<3;c++)image.rgb[(y*100+x)*3+c]=0;};for(int y=50;y<80;y++)for(int x=42;x<46;x++)ink(x,y);json row={{"id",1},{"type","text"},{"mode","tooltip"},{"bbox",source.box},{"box",source.box},{"detectorConfidence",source.score},{"text","AB"},{"translation","번역"}};json rows=json::array({row});std::vector<Region> detected{source};std::vector<IsolatedGlyphView> views(3,{{0,0,100,200},source,1});LayoutRaw raw;raw.mask_side=200;raw.logits={std::log(source.score/(1-source.score)),-10,-10,-10,-10};for(auto v:source.mask)raw.masks.push_back(v?1:-1);size_t checks=0;auto run=[&](){return restoration_isolated_components(image,source,row,views,detected,rows,&raw,false,true,true);};
 assert(restoration_isolated_components(image,source,row,views,detected,rows,&raw,false,true).mask.reason=="isolated-attached-source");checks++;
 auto valid=run();assert(valid.mask.accepted()&&valid.proof["method"]=="isolated-joined-glyphs"&&valid.proof["foregroundResidualFraction"]==0);checks++;
 assert(!restoration_isolated_components(image,source,row,views,detected,rows,nullptr,false,true,true).mask.accepted());checks++;
 assert(!restoration_isolated_components(image,source,row,views,detected,rows,&raw,false,false,true).mask.accepted());checks++;
 auto saved=image;for(int y=20;y<50;y++)ink(42,y);assert(!run().mask.accepted());image=saved;checks++;
 for(int y=43;y<50;y++)ink(42,y);assert(!run().mask.accepted());image=saved;checks++;
 auto neighbor=row;neighbor["id"]=2;rows.push_back(neighbor);assert(!run().mask.accepted());rows.erase(1);checks++;
 source.mask[0]=1;assert(!run().mask.accepted());source.mask[0]=0;checks++;
 source.score=.64;assert(!run().mask.accepted());source.score=.7;checks++;
 {
  auto peer=source;peer.query=1;peer.score=.95f;peer.box={44,50,60,80};std::fill(peer.mask.begin(),peer.mask.end(),0);for(int y=50;y<80;y++)for(int x=44;x<60;x++)peer.mask[y*200+x*2]=peer.mask[y*200+x*2+1]=1;
  auto other=row;other["id"]=2;other["bbox"]=peer.box;other["box"]=peer.box;other["text"]="CD";other["detectorConfidence"]=peer.score;auto ds=detected;ds.push_back(peer);auto rs=rows;rs.push_back(other);auto r=raw;r.logits.insert(r.logits.end(),{std::log(peer.score/(1-peer.score)),-10,-10,-10,-10});for(auto v:peer.mask)r.masks.push_back(v?1:-1);
  for(int y=55;y<61;y++)for(int x=50;x<54;x++)ink(x,y);
  RestorationMask mask;mask.bounds={50,55,54,61};mask.pixels.assign(24,1);mask.count=24;std::map<int,RestorationMask> accepted{{2,mask}};
  auto precise=[&](){return restoration_isolated_components(image,source,row,views,ds,rs,&r,false,true,true,&accepted);};
  assert(!restoration_isolated_components(image,source,row,views,ds,rs,&r,false,true,true).mask.accepted());checks++;
  auto ok=precise();assert(ok.mask.accepted()&&ok.mask.segmentedNeighbors.size()==1&&ok.mask.segmentedNeighbors[0]["geometry"]["width"]==512);checks++;
  rs[1]["manual"]=true;assert(!precise().mask.accepted());rs[1].erase("manual");checks++;
  ds[1].mask[0]=1;assert(!precise().mask.accepted());ds[1]=peer;checks++;
  accepted[2].bounds={44,50,48,56};assert(!precise().mask.accepted());checks++;
  image=saved;
 }
 views[0].agreement=.89;assert(!run().mask.accepted());views[0].agreement=1;checks++;
 views.pop_back();assert(!run().mask.accepted());checks++;
 std::cout<<"PASS "<<checks<<" joined glyph guards\n";
}
