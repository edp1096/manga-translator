#include "../../../native/restoration_mask.hpp"
#include <cassert>
int main(){
 PageImage image{1000,1000,{}};const Box bounds{100,100,500,500};
 json row={{"bbox",bounds},{"textVerification",{{"version",1},{"method","ocr-consensus"},{"role","LABEL"},{"sources",json::array({bounds})},{"columns",json::array({Box{100,100,300,500},Box{300,100,500,500}})}}}};
 RestorationMask mask;mask.bounds=bounds;mask.pixels.assign(160000,1);mask.count=160000;
 auto counts=restoration_column_pixels(image,mask,row,10);assert(counts==std::vector<size_t>({80000,80000}));assert(counts[0]+counts[1]==mask.count);
 assert(restoration_columns_covered(row,bounds));assert(!restoration_columns_covered(row,{100,100,310,500}));
 auto invalid=row;invalid["textVerification"]["columns"][1]=Box{100,100,300,500};assert(restoration_column_pixels(image,mask,invalid,10).empty());
 invalid=row;invalid["textVerification"].erase("columns");assert(restoration_column_pixels(image,mask,invalid,10).empty());
 invalid=row;invalid["textVerification"]["role"]="EFFECT";assert(restoration_column_pixels(image,mask,invalid,10).empty());
 auto unbalanced=mask;unbalanced.bounds[0]=90;unbalanced.pixels.assign(410*400,1);unbalanced.count=unbalanced.pixels.size();assert(restoration_column_pixels(image,unbalanced,row,10).empty());
 auto uncovered=mask;uncovered.bounds[0]=80;uncovered.pixels.assign(420*400,0);for(int y=0;y<400;y++)for(int x=20;x<420;x++)uncovered.pixels[y*420+x]=1;uncovered.pixels[0]=1;uncovered.count=160001;assert(restoration_column_pixels(image,uncovered,row,10).empty());
 auto margin=uncovered;std::fill(margin.pixels.begin(),margin.pixels.end(),0);margin.pixels[0]=margin.pixels[20]=margin.pixels[240]=1;margin.count=3;assert(restoration_column_pixels(image,margin,row,19).empty());assert(restoration_column_pixels(image,margin,row,20)==std::vector<size_t>({2,1}));
 auto stale=mask;stale.count--;assert(restoration_column_pixels(image,stale,row,10).empty());
 stale=mask;std::fill(stale.pixels.begin(),stale.pixels.end(),0);stale.count=0;assert(restoration_column_pixels(image,stale,row,10).empty());
 std::cout<<"PASS per-column budget, exact pixel accounting, missing-column refinement veto, malformed/overlapping/effect/oversized/uncovered rejection\n";
}
