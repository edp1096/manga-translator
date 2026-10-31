#include "../../../native/name_dictionary.hpp"
#include <cassert>
int main(){
 auto make=[](std::string full,std::string family,std::string given,std::string translated,std::string ft,std::string gt){return checked_dictionary(json{{"target","Korean"},{"entries",json::array({{{"source",full},{"translation",translated},{"familySource",family},{"familyTranslation",ft},{"givenSource",given},{"givenTranslation",gt}}})}},"Korean");};
 auto jp=make("本郷姫奈","本郷","姫奈","혼고 히나","혼고","히나");size_t checks=0;
 for(const auto&s:{"本郷姫奈","本郷 姫奈","本郷　姫奈","本郷\t姫奈","本郷\n姫奈","本郷   姫奈"}){assert(consistent_names(s,"혼고 히나",jp));checks++;}
 for(const auto&s:{"姫奈","本郷","本郷と姫奈","本郷さん 姫奈","本郷、姫奈","姫奈 本郷","本郷\xE2\x80\x8B姫奈"}){assert(!consistent_names(s,"혼고 히나",jp));checks++;}
 assert(!consistent_names("本郷 姫奈","혼고 히메나",jp));checks++;assert(consistent_names("姫奈","히나",jp));checks++;
 auto honor=jp;honor["honorifics"]=json::array({{{"source","ちゃん"},{"translation","짱"},{"position","suffix"}},{{"source","Mr."},{"sourcePosition","prefix"},{"sourceGap",true},{"translation","씨"},{"gap",true}}});
 assert(consistent_names("本郷 姫奈ちゃん","혼고 히나짱",honor));checks++;
 assert(consistent_names("Mr. 本郷 姫奈","혼고 히나 씨",honor));checks++;
 assert(!consistent_names("本郷ちゃん 姫奈","혼고짱 히나 (혼고 히나)",honor));checks++;
 for(const auto&d:std::vector<json>{make("John Smith","Smith","John","존 스미스","스미스","존"),make("张三","张","三","장 산","장","산"),make("José Silva","Silva","José","조제 실바","실바","조제"),make("João Costa","Costa","João","주앙 코스타","코스타","주앙")}){
  const auto&e=d["entries"][0];const std::string full=e["source"],target=e["translation"],family=e["familySource"],given=e["givenSource"];const bool givenFirst=full.find(given)==0;const auto first=givenFirst?given:family,second=givenFirst?family:given;
  assert(consistent_names(first+"  "+second,target,d));checks++;
  assert(!consistent_names(first+" met "+second,target,d));checks++;
  assert(!consistent_names(given,target,d));checks++;
 }
 auto hope=make("天馬希望","天馬","希望","텐마 노조미","텐마","노조미");hope["_excludedMentions"]=json::array({9});assert(!consistent_names("天馬の希望","텐마 노조미",hope));checks++;
 auto shared=jp;shared["entries"].push_back(make("本郷陽","本郷","陽","혼고 요","혼고","요")["entries"][0]);assert(consistent_names("本郷 陽","혼고 요",shared));checks++;
 auto single=make("Ann","","","앤","","");assert(mentioned_names("A nn",single).empty());checks++;
 assert(expected_names("本郷 姫奈",jp).size()==1&&expected_names("本郷 姫奈",jp)[0]["required"]=="혼고 히나");checks++;
 std::cout<<"PASS spaced explicit full names "<<checks<<" checks\n";
}
