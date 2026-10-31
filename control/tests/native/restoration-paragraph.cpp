#include "../../../native/restoration_paragraph.hpp"
#include <cassert>
int main(){PageImage image{300,500,std::vector<uint8_t>(300*500*3,255)};auto ink=[&](int x,int y){for(int c=0;c<3;c++)image.rgb[(y*300+x)*3+c]=0;};for(int x0:{40,80,120})for(int y0=40;y0<350;y0+=20)for(int y=y0;y<y0+12;y++)for(int x=x0;x<x0+12;x++)ink(x,y);
 Region source{0,0,.8f,{35,20,155,380},std::vector<uint8_t>(64*64,1),64};std::vector<Region> found{source};std::string part="これは長い文章です。続きを最後まで読みます。";json row={{"id",1},{"type","text"},{"bbox",source.box},{"detectorConfidence",source.score},{"ocrTruncated",true},{"text",part},{"translation","Long translated paragraph"},{"mode","tooltip"}};auto proof=long_paragraph::recovery(image,row,found,[&](Box,int,int){return part;});assert(!proof.is_null());row["text"]=proof.at("text");row["paragraphCorrection"]=proof;row["ocrTruncated"]=false;size_t checks=0;auto call=[&](){return restoration_paragraph(image,source,row,found,json::array({row}));};auto good=call();assert(good.mask.accepted()&&good.mask.count>0);checks++;
 for(auto flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){row[flag]=true;assert(!call().mask.accepted());row.erase(flag);checks++;}row["ocrTruncated"]=false;
 auto saved=row;row["text"]="changed";assert(!call().mask.accepted());row=saved;checks++;
 row["paragraphCorrection"]["columns"][0]["readings"][1]="different";assert(!call().mask.accepted());row=saved;checks++;
 row["paragraphCorrection"]["columns"][0]["bbox"][0]=100;assert(!call().mask.accepted());row=saved;checks++;
 row["detectorConfidence"]=.4;assert(!call().mask.accepted());row=saved;checks++;
 auto neighbor=row;neighbor["id"]=2;neighbor["bbox"]=Box{40,40,52,52};assert(!restoration_paragraph(image,source,row,found,json::array({row,neighbor})).mask.accepted());checks++;
 auto effect=source;effect.cls=1;found.push_back(effect);assert(!call().mask.accepted());found.pop_back();checks++;
 // Narrow source fringe never erases a connected frame outside the source.
 for(int y=0;y<500;y++)ink(158,y);good=call();assert(good.mask.accepted());for(int y=good.mask.bounds[1];y<good.mask.bounds[3];y++)assert(!good.mask.pixels[(y-good.mask.bounds[1])*(good.mask.bounds[2]-good.mask.bounds[0])+158-good.mask.bounds[0]]);checks++;
 std::cout<<"PASS "<<checks<<" paragraph restoration checks\n";}
