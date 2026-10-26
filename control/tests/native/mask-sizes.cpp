#include "image_ops.hpp"
int main(){try{for(int side:{192,288}){
 Region bubble{0,2,1.f,{0,0,side*4,side*4},{},side};bubble.mask.assign(size_t(side)*side,0);bubble.mask.back()=1;
 require(mask_coverage(bubble,{side*4-4,side*4-4,side*4,side*4},side*4,side*4)==1.,"last mask cell coverage failed");
 bubble.mask.assign(size_t(side)*side,1);require(eroded_mask_pixel(bubble,side*4-1,side*4-1,side*4,side*4),"edge mask lookup failed");
 bubble.mask.back()=0;require(!eroded_mask_pixel(bubble,side*4-1,side*4-1,side*4,side*4),"edge erosion failed");
 std::vector<Region> regions;Region a=bubble;a.cls=0;a.score=.8;regions.push_back(a);a.score=.9;regions.push_back(a);deduplicate(regions);require(regions.size()==1,"mask deduplication failed");
 }std::cout<<"PASS 192/288 mask coverage, erosion and deduplication\n";return 0;}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
