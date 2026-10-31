#include "../../../native/restoration_mask.hpp"
#include <cassert>
int main(){
 PageImage image{720,1020,{}};Region original{0,0,.4f,{100,100,250,500},std::vector<uint8_t>(192*192),192};original.ocr_verified=true;
 for(int y=0;y<192;++y)for(int x=0;x<192;++x){int px=int((x+.5)*720/192),py=int((y+.5)*1020/192);original.mask[y*192+x]=px>=230&&px<250&&py>=300&&py<370;}
 Region refined{0,0,.4f,{100,100,220,500},std::vector<uint8_t>(512*512),512};
 json row={{"bbox",original.box},{"textVerification",{{"version",1},{"method","ocr-consensus"},{"role","LABEL"},{"sources",json::array({original.box})},{"rubyAnnotations",json::array({{{"bbox",Box{230,300,250,370}},{"text","よみ"}}})}}}};
 assert(restoration_keep_annotations(refined,original,row,image));assert(refined.box==original.box);assert(region_pixel(refined,240,330,720,1020));assert(!region_pixel(refined,400,330,720,1020));
 auto bad=row;bad["textVerification"]["rubyAnnotations"][0]["bbox"]=Box{400,300,450,370};assert(!restoration_keep_annotations(refined,original,bad,image));
 original.ocr_verified=false;assert(!restoration_keep_annotations(refined,original,row,image));
 std::cout<<"PASS annotation mask retained through crop refinement; outside annotations and unverified sources rejected\n";
}
