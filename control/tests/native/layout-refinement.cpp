#include "../../../native/layout_refinement.hpp"
#include <cassert>

int main(){
 PageImage image{720,1020,{}};
 LayoutRaw raw;raw.boxes={.45f,.4f,.1f,.08f};raw.logits={-5,-5,-1,-5,-5};
 const auto candidates=detail_candidates(raw,image,{});assert(candidates.size()==1);
 Region recognized{0,0,.8f,{315,395,335,420},{},192};
 assert(detail_candidates(raw,image,{recognized}).empty());
 recognized.box={0,0,720,1020};
 assert(detail_candidates(raw,image,{recognized}).size()==1);
 raw.logits[2]=2;
 assert(detail_candidates(raw,image,{}).empty());
 raw.logits[2]=-3;
 assert(detail_candidates(raw,image,{}).empty());
 raw.logits[2]=-1;raw.boxes[2]=.8;raw.boxes[3]=.8;
 assert(detail_candidates(raw,image,{}).empty());
 Region local{0,0,.9f,{25,25,75,75},std::vector<uint8_t>(100,1),10};
 const auto projected=project_region(local,{100,200,200,300},400,400,40);
 assert((projected.box==Box{125,225,175,275}));
 assert(projected.mask_side==40);
 for(int row=0;row<40;++row)for(int column=0;column<40;++column)assert(projected.mask[row*40+column]==(column>=10&&column<20&&row>=20&&row<30));
 assert(box_similarity({10,10,30,30},{10,10,30,30})==1);
 assert(box_similarity({10,10,30,30},{40,40,60,60})==0);
}
