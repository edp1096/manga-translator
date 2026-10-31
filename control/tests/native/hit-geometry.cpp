#include "hit_geometry.hpp"
#include <cassert>
#include <iostream>
struct Detection{int cls;float score;std::array<int,4> box;std::vector<uint8_t> mask;int mask_side;};
using nlohmann::json;
int main(){
 Detection d{1,.8f,{20,20,80,80},std::vector<uint8_t>(100),10};
 d.mask[22]=1;d.mask[23]=1;d.mask[55]=1;d.mask[99]=1;
 const json original={{"id",1},{"type","effect"},{"text","sound"},{"translation","Sound"},{"mode","tooltip"},{"bbox",d.box}};
 json rows=json::array({original});assert(attach_hit_geometry(rows,std::vector{d},100,100)==1);
 const auto mask=rows[0]["hitMask"];assert(mask["runs"]==json::array({22,2,55,1}));assert(mask["pixels"]==3);rows[0].erase("hitMask");assert(rows[0]==original);
 for(const auto& changed:std::vector<json>{json::array({20,20,81,80}),json::array({-1,20,80,80}),json::array({20,20,20,80}),json::array({20,20,80}),json::array({20.,20,80,80})}){rows=json::array({original});rows[0]["bbox"]=changed;rows[0]["hitMask"]=mask;assert(!attach_hit_geometry(rows,std::vector{d},100,100));assert(!rows[0].contains("hitMask"));}
 rows=json::array({original});rows[0]["type"]="text";assert(!attach_hit_geometry(rows,std::vector{d},100,100));
 for(int side:{0,2,513}){auto bad=d;bad.mask_side=side;rows=json::array({original});assert(!attach_hit_geometry(rows,std::vector{bad},100,100));}
 auto empty=d;std::fill(empty.mask.begin(),empty.mask.end(),0);rows=json::array({original});assert(!attach_hit_geometry(rows,std::vector{empty},100,100));
 auto malformed=d;malformed.mask.pop_back();assert(!attach_hit_geometry(rows,std::vector{malformed},100,100));
 std::cout<<"PASS hit geometry: exact source ownership, clipping, row runs, stale metadata removal, malformed masks, unchanged result fields\n";
}
