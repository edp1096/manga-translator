#include "../../../native/name_dictionary.hpp"

int main(){try{
 const auto dictionary=checked_dictionary({{"target","Korean"},{"entries",json::array({{{"kind","place"},{"source","チチハル"},{"translation","치치하얼"}},{{"kind","place"},{"source","北京"},{"translation","베이징"}}})}},"Korean");
 const std::string source="チチハルの平和を統治するための・・・・",before="치치하ルの 평화를 통치하기 위한...",after="치치하얼의 평화를 통치하기 위한...";
 require(consistent_names(source,after,dictionary),"Approved place name should match");require(only_names_changed(before,after,source,dictionary),"Valid minimal place+genitive correction was rejected");
 for(const auto& particle:{"의","에","에서","에게","께","한테","부터","까지","보다","처럼","만","도","조차","마저","밖에"})require(only_names_changed("ベイジンの 다음.","베이징"+std::string(particle)+" 다음.","北京",dictionary),"Attached Korean particle correction was rejected");
 for(const auto& invalid:{"치치하얼의 평화를 유지하기 위한...","치치하얼의 평화를 통치하려고...","치치하얼의 평화를 통치하기 위한!","치치하얼의  평화를 통치하기 위한...","치치하얼의 평화를 통치하기 위한 설명..."})require(!only_names_changed(before,invalid,source,dictionary),"Unrelated dialogue change was accepted");
 require(!only_names_changed(before,after,"平和",dictionary),"Term absent from source must not be inserted");
 require(!only_names_changed("치치하ルの 평화를 통치하기 위한...","치치하얼 평화를 통치하기 위한...","平和",dictionary),"Unknown terms must not be repaired");
 auto english=dictionary;english["target"]="English";english["entries"]=json::array({{{"kind","place"},{"source","チチハル"},{"translation","Qiqihar"}}});require(!only_names_changed("Tsitsihar peace.","Qiqihar의 peace.",source,english),"Korean particles leaked into English correction");require(only_names_changed("Tsitsihar peace.","Qiqihar peace.",source,english),"English spelling correction rejected");
 std::cout<<"PASS actual mixed-script place+genitive, 15 attached particles, unchanged dialogue/punctuation/whitespace, source scope and target-language isolation\n";
 }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}}
