#include "../../../native/restoration_mask.hpp"
#include <cassert>
int main(){
 Region source{1,0,.9f,{10,10,40,100},std::vector<uint8_t>(192*192,1),192};std::vector<Region> found{source};
 json row={{"type","text"},{"mode","tooltip"},{"bbox",source.box},{"text","An explanatory note"},{"translation","번역된 주석"},{"detectorConfidence",source.score}};
 RestorationMask mask;mask.reason="bubble-mask-collision";int tests=0;
 auto check=[&](json r,Region s,RestorationMask m,std::vector<Region> d,bool expected){tests++;assert(restoration_ordinary_refinement(r,s,m,d)==expected);};check(row,source,mask,found,true);
 for(const auto flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated"}){auto r=row;r[flag]=true;check(r,source,mask,found,false);}
 for(const auto field:{"text","translation"}){auto r=row;r[field]="";check(r,source,mask,found,false);}
 for(const auto reason:{"near-bubble","neighbor-text","effect-mask-collision","incomplete-text",""}){auto m=mask;m.reason=reason;check(row,source,m,found,false);}
 {auto m=mask;m.bubble=&source;check(row,source,m,found,false);}
 {auto r=row;r["textVerification"]={{"version",1}};check(r,source,mask,found,false);}
 {auto r=row;r["detectorConfidence"]=.8;check(r,source,mask,found,false);}
 {auto r=row;r["detectorConfidence"]=.91;check(r,source,mask,found,false);}
 {auto r=row;r["bbox"][0]=11;check(r,source,mask,found,false);}
 {auto r=row;r["type"]="effect";check(r,source,mask,found,false);}
 {auto r=row;r["mode"]="replace";check(r,source,mask,found,false);}
 {auto d=found;d.push_back(source);check(row,source,mask,d,false);}
 {auto s=source;s.mask_side=64;check(row,s,mask,found,false);}
 {auto s=source;s.cls=1;check(row,s,mask,found,false);}
 {auto s=source;s.score=.8;check(row,s,mask,found,false);}
 std::cout<<"PASS "<<tests<<" ordinary refinement eligibility cases\n";
}
