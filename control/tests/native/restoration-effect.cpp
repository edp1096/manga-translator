#include "../../../native/restoration_effect.hpp"
#include <cassert>
int main(){
 LayoutRaw raw;raw.mask_side=4;raw.logits={3,-8,-8,-8,-8,-8,-1.3f,-8,-8,-8};raw.masks.assign(32,-8);raw.masks[5]=8;raw.masks[16+5]=1.2f;
 Region text{0,0,1/(1+std::exp(-3.f)),{0,0,40,40},std::vector<uint8_t>(16),4};text.mask[5]=1;
 Region effect{1,1,1/(1+std::exp(1.3f)),{0,0,40,40},std::vector<uint8_t>(16),4};effect.mask[5]=1;
 PageImage image{40,40,std::vector<uint8_t>(4800,255)};
 assert(restoration_effect_matches(text,&raw));assert(restoration_effect_matches(effect,&raw));
 assert(restoration_effect_owned(text,effect,15,15,image,&raw));
 auto strong=raw;strong.masks[16+5]=8;assert(!restoration_effect_owned(text,effect,15,15,image,&strong));
 auto weak=raw;weak.masks[5]=1;assert(!restoration_effect_owned(text,effect,15,15,image,&weak));
 auto mask=text;mask.mask[4]=1;assert(!restoration_effect_matches(mask,&raw));
 auto score=text;score.score=.91;assert(!restoration_effect_matches(score,&raw));
 auto cls=text;cls.cls=1;assert(!restoration_effect_matches(cls,&raw));
 auto query=text;query.query=2;assert(!restoration_effect_matches(query,&raw));
 auto shortRaw=raw;shortRaw.masks.resize(4);assert(!restoration_effect_matches(text,&shortRaw));
 auto grid=text;grid.mask_side=3;assert(!restoration_effect_matches(grid,&raw));
 assert(!restoration_effect_matches(text,nullptr));assert(!restoration_effect_owned(text,effect,-1,15,image,&raw));
 auto separate=raw;separate.masks[5]=-8;assert(!restoration_effect_owned(text,effect,15,15,image,&separate));
 assert(restoration_effect_owned(text,effect,15,15,image,&raw)); // Other page did not alter this page's evidence.
 std::cout<<"PASS effect ownership: provenance, strong effect, weak source, malformed buffers, bounds, independent page evidence\n";
}
