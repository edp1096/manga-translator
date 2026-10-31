#include "../../../native/panel_refinement.hpp"
#include "../../../native/outside_classification.hpp"
#include <cassert>
int main(){
 const Box frame{10,10,210,110};std::vector<Region> known;
 assert(panel_text_bounds_allowed({30,70,90,90},frame,known));
 assert(!panel_text_bounds_allowed({30,90,90,111},frame,known));
 assert(!panel_text_bounds_allowed({9,20,50,40},frame,known));
 assert(!panel_text_bounds_allowed({20,20,200,100},frame,known));
 known.push_back(Region{0,0,.8f,{30,70,90,90},{}});
 assert(!panel_text_bounds_allowed({35,75,95,95},frame,known));
 assert(panel_text_bounds_allowed({120,70,180,90},frame,known));
 const json candidates=json::array({{{"type","text"},{"panelCandidate",true}}});
 for(const auto& text:{"トン","VS","李白","ああ"})for(const auto& role:{"LABEL","DIALOGUE"})assert(!outside_classification_supported(candidates,{0},text,role));
 for(const auto& text:{"フリッカー","通常ジャブ","Normal jab","説明文です"})assert(outside_classification_supported(candidates,{0},text,"LABEL"));
 assert(!outside_classification_supported(candidates,{0},"フリッカー","EFFECT"));
 const json prior=json::array({{{"type","text"}}});assert(outside_classification_supported(prior,{0},"李白","LABEL"));
 json context=json::array();for(int i=0;i<6;i++)context.push_back({{"type","text"},{"text",std::to_string(i)},{"bbox",Box{i*20,0,i*20+10,10}}});
 context[1]["panelCandidate"]=true;context[2]["ocrTruncated"]=true;context[3]["type"]="effect";
 assert(outside_nearby_text(context,{0,0,10,10},{0})==json::array({"4","5"}));
 context[1]["panelCandidate"]=false;context[2]["ocrTruncated"]=false;context[3]["type"]="text";
 assert(outside_nearby_text(context,{0,0,10,10},{0})==json::array({"1","2","3"}));
 std::cout<<"PASS panel containment/overlap and provisional classification guards\n";
}
