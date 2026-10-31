#include "../../../native/name_dictionary.hpp"
#include <cassert>

int main(){
 json input={{"id","work-one"},{"title","Test work"},{"target","Korean"},{"revision","one"},{"entries",json::array({{{"source","佐々木チロル"},{"translation","사사키 티롤"},{"familySource","佐々木"},{"familyTranslation","사사키"},{"givenSource","チロル"},{"givenTranslation","티롤"},{"aliases",json::array({{{"source","チロちゃん"},{"translation","티롤짱"}}})}},{{"source","天馬希望"},{"translation","텐마 노조미"},{"givenSource","希望"},{"givenTranslation","노조미"}}})},{"honorifics",json::array({{{"source","ちゃん"},{"translation","짱"}}})}};
 const auto dictionary=checked_dictionary(input,"Korean");
 assert(mentioned_names("佐々木チロル",dictionary).size()==1);
 assert(mentioned_names("チロルちゃん",dictionary).size()==1);
 assert(consistent_names("佐々木チロル","사사키 티롤",dictionary));
 assert(!consistent_names("チロルちゃん","사사키 티롤",dictionary));
 assert(consistent_names("チロルちゃん","티롤짱",dictionary));
 assert(consistent_names("チロちゃん","티롤짱",dictionary));
 assert(!consistent_names("チロル、チロル","티롤",dictionary));
 assert(consistent_names("チロル、チロル","티롤, 티롤",dictionary));
 assert(only_names_changed("사사키 치로루","사사키 티롤","佐々木チロル",dictionary));
 assert(only_names_changed("이 목소리, 치로루네.","이 목소리, 티롤이네.","この声、チロルだな。",dictionary));
 assert(only_names_changed("히메나가 치로루를 쓰러뜨렸나.","히메나가 티롤을 쓰러뜨렸나.","姫奈がチロルを降したか。",dictionary));
 assert(only_names_changed("있잖아, 치로루?","있잖아, 티롤짱?","ねえ、チロルちゃん?",dictionary));
 assert(only_names_changed("텐마 키보우","텐마 노조미","天馬希望",dictionary));
 assert(!only_names_changed("텐마 키보우","텐마 노조미 텐마 노조미","天馬希望",dictionary));
 assert(only_names_changed("텐마 키보우, 텐마 키보우","텐마 노조미, 텐마 노조미","天馬希望、天馬希望",dictionary));
 assert(!only_names_changed("틀어버렸네, 티롤쨩.","실수했네, 티롤짱.","間違えちゃったねチロルちゃん。",dictionary));
 assert(!only_names_changed("치로루를 기다려.","티롤을 공격해.","チロルを待て。",dictionary));
 assert(!only_names_changed("치로루 친구를 기다려.","티롤을 기다려.","チロルを待て。",dictionary));
 auto mixed=dictionary;mixed["_excludedMentions"]=json::array({std::string("希望は最後の").size()});assert(mentioned_names("希望は最後の希望だ。",mixed).size()==1);assert(expected_names("希望は最後の希望だ。",mixed).at(0).contains("context"));
 assert(!only_names_changed("그 사람.","티롤.","彼女。",dictionary));
 assert(dictionary_for_rows(dictionary,json::array({{{"text","チロルちゃん"}}})).at("entries").size()==1);
 auto invalid=input;invalid["entries"].push_back({{"source","チロル"},{"translation","다른 이름"}});bool rejected=false;try{checked_dictionary(invalid,"Korean");}catch(...){rejected=true;}assert(rejected);
 rejected=false;try{checked_dictionary(input,"English");}catch(...){rejected=true;}assert(rejected);
 std::cout<<"PASS character forms, honorifics, particles, correction boundaries, dictionary isolation and validation\n";
}
