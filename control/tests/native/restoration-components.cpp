#include "../../../native/restoration_components.hpp"
#include <cassert>
int main(){
 PageImage image{200,200,std::vector<uint8_t>(200*200*3,255)};
 auto paint=[&](PageImage& im,Box b,uint8_t color){for(int y=b[1];y<b[3];y++)for(int x=b[0];x<b[2];x++)for(int c=0;c<3;c++)im.rgb[(size_t(y)*im.width+x)*3+c]=color;};
 Region text{0,0,.8f,{40,40,80,120},std::vector<uint8_t>(200*200),200};text.ocr_verified=true;
 for(auto b:std::vector<Box>{{74,44,80,49},{50,60,56,66},{50,80,56,86},{50,100,56,106}}){paint(image,b,0);for(int y=b[1];y<b[3];y++)for(int x=b[0];x<b[2];x++)text.mask[y*200+x]=1;}
 paint(image,{82,0,84,200},0);
 Region balloon{1,2,.95f,{78,20,170,160},std::vector<uint8_t>(200*200),200};for(int y=44;y<49;y++)for(int x=78;x<170;x++)balloon.mask[y*200+x]=1;
 json row={{"id",1},{"bbox",text.box},{"type","text"},{"mode","tooltip"},{"text","ABCDEFGH"},{"translation","translated"},{"textVerification",{{"version",1},{"method","ocr-consensus"},{"role","DIALOGUE"},{"sources",json::array({text.box})}}}};json rows=json::array({row});std::vector<Region> found{text,balloon};
 auto positive=restoration_component_mask(image,text,row,found,rows);if(!positive.mask.accepted())std::cerr<<positive.proof.dump()<<std::endl;assert(positive.mask.accepted());
 auto low=image;for(auto& p:low.rgb)if(p<180)p=180;assert(!restoration_component_mask(low,text,row,found,rows).mask.accepted());
 auto gray=image;for(auto& p:gray.rgb)if(p>210)p=210;assert(!restoration_component_mask(gray,text,row,found,rows).mask.accepted());
 auto touch=image;paint(touch,{79,45,83,48},0);assert(!restoration_component_mask(touch,text,row,found,rows).mask.accepted());
 auto bridge=image;paint(bridge,{79,45,83,48},170);assert(!restoration_component_mask(bridge,text,row,found,rows).mask.accepted());
 auto busy=image;for(int y=20;y<140;y++)for(int x=20;x<100;x++)if(x%6<2||y%6<2)for(int c=0;c<3;c++)busy.rgb[(size_t(y)*busy.width+x)*3+c]=0;assert(!restoration_component_mask(busy,text,row,found,rows).mask.accepted());
 auto uncertain=text;uncertain.ocr_verified=false;assert(!restoration_component_mask(image,uncertain,row,found,rows).mask.accepted());
 auto mismatch=row;mismatch["bbox"]=Box{30,40,80,120};assert(!restoration_component_mask(image,text,mismatch,found,rows).mask.accepted());
 auto neighbor=rows;neighbor.push_back({{"id",2},{"bbox",Box{49,60,57,67}}});assert(!restoration_component_mask(image,text,row,found,neighbor).mask.accepted());
 auto effect=found;effect.push_back(Region{2,1,.8f,{48,78,58,88},std::vector<uint8_t>(200*200),200});for(int y=78;y<88;y++)for(int x=48;x<58;x++)effect.back().mask[y*200+x]=1;assert(!restoration_component_mask(image,text,row,effect,rows).mask.accepted());
 std::cout<<"PASS component restoration: isolated glyph, low contrast, gray background, attached border, threshold bridge, connected background, verification, provenance, neighbor, effect\n";
}
