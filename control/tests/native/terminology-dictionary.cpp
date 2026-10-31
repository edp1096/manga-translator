#include "../../../native/name_dictionary.hpp"
#include <cassert>

int main(){
 json input={{"id","terms"},{"target","Korean"},{"entries",json::array({
  {{"kind","term"},{"source","戦乙女"},{"translation","발큐리아"},{"reading","ヴァルキュリア"},{"matchReading",true}},
  {{"kind","place"},{"source","北京"},{"translation","베이징"}},
  {{"kind","place"},{"source","São Tomé"},{"translation","상투메"}},
  {{"kind","person"},{"source","Ann"},{"translation","앤"}},
  {{"kind","person"},{"source","Niño"},{"translation","니뇨"}},
  {{"kind","organization"},{"source","Ação"},{"translation","아상"}}
 })},{"honorifics",json::array({{{"source","Mr."},{"sourcePosition","prefix"},{"sourceGap",true},{"translation","씨"},{"gap",true}}})}};
 const auto dictionary=checked_dictionary(input,"Korean");
 assert(expected_names("戦乙女とヴァルキュリア",dictionary).size()==2);
 assert(expected_names("戦乙女",dictionary).at(0).at("confirmedReading")=="ヴァルキュリア");
 assert(expected_names("北京欢迎你",dictionary).at(0).at("required")=="베이징");
 assert(expected_names("Mr. Ann visits São Tomé.",dictionary).at(0).at("required")=="앤 씨");
 assert(mentioned_names("Anna and Annette visit São Tomés with Niños and Ações.",dictionary).empty());
 assert(mentioned_names("Ann, Niño, Ação!",dictionary).size()==3);
 assert(mentioned_names("xAnn Ann2 _Ann Ann_",dictionary).empty());
 assert(mentioned_names("Niñoé",dictionary).empty());
 assert(correct_name_particles("아상가 왔다.","Ação chegou.",dictionary)=="아상이 왔다.");
 assert(correct_name_particles("상투메으로 간다.","São Tomé",dictionary)=="상투메로 간다.");
 assert(correct_name_particles("앤가 웃는다.","Ann",dictionary)=="앤이 웃는다.");
 assert(correct_name_particles("앤이기 때문에.","Ann",dictionary)=="앤이기 때문에.");
 assert(correct_name_particles("앤가 왔다.","Anna",dictionary)=="앤가 왔다.");
 assert(only_names_changed("전쟁의 여신이 왔다.","발큐리아가 왔다.","戦乙女が来た。",dictionary));
 assert(only_names_changed("여전사가 왔다.","발큐리아가 왔다.","戦乙女が来た。",dictionary));
 assert(!only_names_changed("여전사가 왔다.","발큐리아가 떠났다.","戦乙女が来た。",dictionary));
 assert(mentioned_names("戦乙女Mr.",dictionary).size()==1);
 auto english=input;english["target"]="English";english["entries"]=json::array({{{"kind","term"},{"source","戦乙女"},{"translation","Valkyrie"}},{{"kind","person"},{"source","アン"},{"translation","Ann"}}});english["honorifics"]=json::array({{{"source","ちゃん"},{"translation",""}}});
 const auto english_dictionary=checked_dictionary(english,"English");
 assert(consistent_names("アンちゃん","Ann",english_dictionary));
 assert(!consistent_names("アンちゃん","Anna",english_dictionary));
 assert(only_names_changed("The warrior arrived.","The Valkyrie arrived.","戦乙女が来た。",english_dictionary));
 assert(!only_names_changed("The warrior arrived.","The Valkyrie left.","戦乙女が来た。",english_dictionary));
 assert(dictionary_instructions(english_dictionary).find("Adjust Korean")==std::string::npos);
 auto titled=english_dictionary;titled["entries"]=json::array({{{"kind","person"},{"source","ジョン"},{"translation","Mr. John"}}});
 assert(only_names_changed("Mr. Jon arrived.","Mr. John arrived.","ジョン",titled));
 assert(!only_names_changed("Jon. Go away.","Mr. John arrived.","ジョン",titled));
 auto chinese=english;chinese["target"]="Chinese";chinese["entries"][1]["translation"]="安";chinese["honorifics"][0]={{"source","ちゃん"},{"translation","小"},{"position","prefix"}};
 assert(consistent_names("アンちゃん","小安",checked_dictionary(chinese,"Chinese")));
 auto no_reading=input;no_reading["entries"][0]["matchReading"]=false;assert(mentioned_names("ヴァルキュリア",checked_dictionary(no_reading,"Korean")).empty());
 auto invalid=input;invalid["entries"].push_back({{"source","ヴァルキュリア"},{"translation","다른 명칭"}});bool rejected=false;try{checked_dictionary(invalid,"Korean");}catch(...){rejected=true;}assert(rejected);
 std::cout<<"PASS terms/readings, Chinese/English/Spanish/Portuguese sources, word boundaries, prefix/suffix/omitted honorifics, output languages and correction limits\n";
}
