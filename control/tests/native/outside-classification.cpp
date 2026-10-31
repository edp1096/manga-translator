#include "../../../native/outside_classification.hpp"
#include <cassert>

int main(){
 const json effects=json::array({{{"type","effect"}},{{"type","effect"}}});
 int checks=0;
 for(const auto& text:{"ビキ","キャー","ギィ!","BO!","咚咚","쾅!"})for(const auto& role:{"LABEL","DIALOGUE"}){
  assert(!outside_classification_supported(effects,{0},text,role));checks++;
 }
 assert(!outside_classification_supported(effects,{0,1},"ビキ", "LABEL"));checks++;
 for(const auto& text:{"本郷姫奈","天羽シーナ","一番星 天星","少しでもリラックスしてくれるといいんやけど...","Maria","圣地亚哥"}){
  assert(outside_classification_supported(effects,{0},text,"LABEL"));checks++;
 }
 const json text=json::array({{{"type","text"}}});
 assert(outside_classification_supported(text,{0},"李白","LABEL"));checks++;
 assert(outside_classification_supported(text,{0},"ああ","DIALOGUE"));checks++;
 assert(!outside_classification_supported(effects,{0},"ビキビキ","EFFECT"));checks++;
 assert(!outside_classification_supported(effects,{0},"不明な文字","UNCERTAIN"));checks++;
 assert(!outside_classification_supported(effects,{},"本郷姫奈","LABEL"));checks++;
 assert(!outside_classification_supported(effects,{9},"本郷姫奈","LABEL"));checks++;
 std::cout<<"PASS "<<checks<<" outside classification guards\n";
}
