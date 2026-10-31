#include "../../../native/restoration_manual.hpp"
#include <cassert>
int main(){int checks=0;json good={{"width",100},{"height",100},{"bounds",{10,20,20,30}},{"runs",{0,3,12,4,95,5}}};auto m=checked_manual_mask(good,100,100);assert(m.accepted()&&m.count==12&&m.pixels[11]==0&&m.pixels[12]==1);checks++;
 auto bad=[&](json j){try{checked_manual_mask(j,100,100);assert(false);}catch(const std::exception&){}checks++;};
 for(const auto& runs:std::vector<json>{json::array(),json::array({0}),json::array({-1,1}),json::array({0,0}),json::array({0,5,4,2}),json::array({99,2}),json::array({1.1,2}),json::array({0,100000000000LL})}){auto j=good;j["runs"]=runs;bad(j);}
 for(const auto& b:std::vector<json>{json::array({-1,0,5,5}),json::array({0,0,101,10}),json::array({10,20,10,30}),json::array({0,0,5}),json::array({4294967296LL,0,4294967306LL,10})}){auto j=good;j["bounds"]=b;bad(j);}auto j=good;j["width"]=99;bad(j);std::cout<<"PASS "<<checks<<" manual mask checks\n";}
