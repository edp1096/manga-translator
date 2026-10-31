#include "../../../native/restoration_mask.hpp"
#include <cassert>
int main(){
 PageImage image{720,1020,{}};const float score=1/(1+std::exp(-.5f));
 Region a{0,0,score,{200,300,320,450},std::vector<uint8_t>(192*192),192},b{1,1,score,{300,400,400,550},std::vector<uint8_t>(192*192),192};
 for(int y=0;y<192;y++)for(int x=0;x<192;x++){double px=(x+.5)*720/192,py=(y+.5)*1020/192;a.mask[y*192+x]=px>=275&&px<310&&py>=315&&py<430;b.mask[y*192+x]=px>=360&&px<385&&py>=420&&py<535;}
 LayoutRaw raw;raw.mask_side=192;raw.logits={.5,-8,-8,-8,-8,-8,.5,-8,-8,-8};for(const auto&r:{a,b})for(auto v:r.mask)raw.masks.push_back(v?8:-8);
 json one={{"id",1},{"type","text"},{"mode","tooltip"},{"bbox",a.box},{"text","First narration"},{"translation","첫 독백"},{"detectorConfidence",score}},two=one;two["id"]=2;two["bbox"]=b.box;two["text"]="Neighbor narration";
 a.ocr_verified=true;one["textVerification"]={{"version",1},{"method","ocr-consensus"},{"role","DIALOGUE"},{"sources",json::array({a.box})}};two["type"]="effect";
 const std::vector<Region> regions{a,b};const auto rows=json::array({one,two});size_t checks=0;
 auto safe=restoration_mask(image,a,one,regions,rows,&raw);assert(safe.accepted()&&safe.segmentedNeighbors.size()==1);checks++;
 for(int y=safe.bounds[1];y<safe.bounds[3];y++)for(int x=safe.bounds[0];x<safe.bounds[2];x++){auto v=safe.pixels[(y-safe.bounds[1])*(safe.bounds[2]-safe.bounds[0])+x-safe.bounds[0]];if(region_pixel(a,x,y,720,1020))assert(v);if(region_pixel(b,x,y,720,1020))assert(!v);}checks++;
 assert(restoration_mask(image,a,one,regions,rows).reason=="neighbor-text");checks++;
 for(int member:{0,1})for(const char* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated"}){auto changed=rows;changed[member][flag]=true;assert(!restoration_mask(image,a,changed[0],regions,changed,&raw).accepted());checks++;}
 for(int member:{0,1})for(const char* field:{"detectorConfidence","bbox"}){auto changed=rows;if(std::string(field)=="bbox")changed[member][field][0]=changed[member][field][0].get<int>()+1;else changed[member][field]=.89;assert(!restoration_mask(image,a,changed[0],regions,changed,&raw).accepted());checks++;}
 {auto changed=rows;changed[0].erase("textVerification");assert(!restoration_mask(image,a,changed[0],regions,changed,&raw).accepted());checks++;}
 {auto changed=rows;changed[0]["textVerification"]["sources"].push_back(b.box);assert(!restoration_mask(image,a,changed[0],regions,changed,&raw).accepted());checks++;}
 {auto changed=rows;changed[0]["textVerification"]["sources"][0][0]=199;assert(!restoration_mask(image,a,changed[0],regions,changed,&raw).accepted());checks++;}
 assert(safe.segmentedNeighbors[0].at("sourceVerification")==one.at("textVerification"));checks++;
 auto missing=raw;missing.masks.resize(4);assert(!restoration_mask(image,a,one,regions,rows,&missing).accepted());checks++;
 auto changedRaw=raw;changedRaw.masks[0]=8;assert(!restoration_mask(image,a,one,regions,rows,&changedRaw).accepted());checks++;
 auto duplicate=regions;duplicate.push_back(b);assert(!restoration_mask(image,a,one,duplicate,rows,&raw).accepted());checks++;
 auto overlapRegions=regions;overlapRegions[1].mask=a.mask;auto overlapRaw=raw;std::copy(overlapRaw.masks.begin(),overlapRaw.masks.begin()+a.mask.size(),overlapRaw.masks.begin()+a.mask.size());assert(restoration_mask(image,a,one,overlapRegions,rows,&overlapRaw).reason=="neighbor-text");checks++;
 auto foreign=rows;auto third=two;third["id"]=3;third["bbox"]=Box{280,350,300,380};foreign.push_back(third);assert(restoration_mask(image,a,one,regions,foreign,&raw).reason=="neighbor-text");checks++;
 std::cout<<"PASS verified text/effect neighbor "<<checks<<" checks\n";
}
