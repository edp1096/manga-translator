#include "../../../native/support_geometry.hpp"
#include <cassert>
int main(){Region r{0,0,.9f,{20,20,50,50},std::vector<uint8_t>(100,1)};r.mask_side=10;auto m=support_geometry(r,100,100);assert(m.at("pixels")==9);assert(m.at("runs")==json::array({22,3,32,3,42,3}));assert(m.at("sourceBox")==json(r.box));r.mask.resize(99);assert(support_geometry(r,100,100).is_null());r.mask.resize(100);r.box={50,20,20,50};assert(support_geometry(r,100,100).is_null());std::cout<<"PASS support mask bbox clipping and invalid input\n";}
