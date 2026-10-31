#include "../../../native/restoration_cross_ocr.hpp"
#include <cassert>
int main(){
 PageImage image{100,200,std::vector<uint8_t>(60000,255)};Region source{0,0,.55f,{40,50,48,80},std::vector<uint8_t>(40000),200};source.ocr_verified=true;
 for(int y=50;y<80;y++)for(int x=40;x<48;x++)source.mask[y*200+x*2]=source.mask[y*200+x*2+1]=1;
 auto ink=[&](int x,int y){for(int c=0;c<3;c++)image.rgb[(y*100+x)*3+c]=0;};for(int y:{54,68})for(int dy=0;dy<6;dy++)for(int x=42;x<46;x++)ink(x,y+dy);
 auto bubble=source;bubble.cls=2;bubble.query=1;bubble.score=.3f;bubble.box={30,40,60,90};std::fill(bubble.mask.begin(),bubble.mask.end(),1);
 json row={{"id",1},{"type","text"},{"mode","tooltip"},{"bbox",source.box},{"box",source.box},{"detectorConfidence",source.score},{"text","AB"},{"translation","번역"},{"textVerification",{{"version",1},{"method","ocr-consensus"},{"role","LABEL"},{"sources",json::array({source.box})}}}};
 json rows=json::array({row});std::vector<Region> detected{source,bubble};LayoutRaw raw;raw.mask_side=200;raw.logits={std::log(.55f/.45f),-10,-10,-10,-10};for(auto p:source.mask)raw.masks.push_back(p?1:-1);
 size_t checks=0,calls=0;auto read=[&](const PageImage&,Box,int,bool){calls++;return std::string("AB");};
 auto run=[&](){return restoration_cross_ocr(image,detected,rows,raw,[](){},read,read);};
 assert(run().masks.size()==1&&calls==16);checks++;
 for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){rows[0][flag]=true;assert(run().masks.empty());rows[0].erase(flag);checks++;}
 auto badRead=[](const PageImage&,Box,int,bool){return std::string("AC");};assert(restoration_cross_ocr(image,detected,rows,raw,[](){},read,badRead).masks.empty());checks++;
 assert(restoration_cross_ocr(image,detected,rows,raw,[](){},badRead,read).masks.empty());checks++;
 detected[1].score=.65;assert(run().masks.empty());detected[1]=bubble;checks++;
 detected[0].mask[0]=1;assert(run().masks.empty());detected[0]=source;checks++;
 rows[0]["textVerification"]["sources"].push_back(source.box);assert(run().masks.empty());rows[0]=row;checks++;
 rows[0]["textVerification"]["sources"][0][0]=39;assert(run().masks.empty());rows[0]=row;checks++;
 rows[0]["detectorConfidence"]=.6;assert(run().masks.empty());rows[0]=row;checks++;
 detected.push_back(source);assert(run().masks.empty());detected.pop_back();checks++;
 auto effect=source;effect.cls=1;effect.score=.21;detected.push_back(effect);assert(run().masks.empty());detected.pop_back();checks++;
 assert(restoration_cross_ocr(image,detected,rows,raw,[](){},read,read,{1}).masks.empty());checks++;
 auto saved=image;for(int y=20;y<55;y++)ink(42,y);assert(run().masks.empty());image=saved;checks++;
 ink(40,53);auto good=run();assert(good.masks.size()==1);auto& m=good.masks.at(1);assert(!m.pixels[(53-m.bounds[1])*(m.bounds[2]-m.bounds[0])+40-m.bounds[0]]);checks++;
 std::cout<<"PASS "<<checks<<" cross OCR glyph guards\n";
}
