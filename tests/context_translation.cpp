#include "../native/context_translation.hpp"
#include <cassert>

int main() {
 using namespace context_translation;
 assert(polarity("いやおまえが強いんじゃいっ")=="affirmative");
 assert(reversed("affirmative","아니, 네가 강한 게 아니야."));
 assert(!reversed("affirmative","아니, 네가 강한 거라고!"));
 assert(polarity("ねっ寝てまひぇんシスター")=="negative");
 assert(spoken_reading("ねっ寝てまひぇんシスター")=="ねっ寝てませんシスター");
 assert(!reversed("negative","아, 안 잤어요, 수녀님!"));
 assert(polarity("一緒に勝負しませんか").empty());
 assert(polarity("行けないんじゃい")=="negative");
 assert(ending_only("오, 두 배로 대답하는군.","오, 두 배로 대답하는 건가."));
 assert(added_latin_note("寸勁", "촌경(Inch Power)", json::array()));
 assert(!added_latin_note("銃（SIG）", "총(SIG)", json::array()));
 const json a={{"id","a"},{"text","私が先に事情を説明します"}};
 const json b={{"id","b"},{"text","その提案は受け入れられません"}};
 const json same={{"id","same"},{"text","私が先に事情を説明します！"}};
 const json short_line={{"id","short"},{"text","はい"}};
 const json neighbor_line={{"id","outside"},{"text","誰でもいいから聞いてくれ"}};
 const json repeated={{"a","먼저 사정을 설명하겠습니다."},{"b","먼저 사정을 설명하겠습니다！"},{"same","먼저 사정을 설명하겠습니다."},{"short","네."}};
 const auto conflicts=repeated_dialogue({a,b,same,short_line},repeated);
 assert(conflicts==std::set<std::string>({"a","b","same"}));
 assert(repeated_dialogue({a,same,short_line},repeated).empty());
 assert(reference_lines({neighbor_line,a,b},json::array({a,b}))==json::array({neighbor_line.at("text")}));
 assert(reference_lines({a,b},json::array({a,b})).empty());
 auto row=[](int id,std::string translation){return json{{"id",id},{"text","テスト"},{"translation",translation},{"box",{0,1,2,3}}};};
 json base={{"regions",json::array({row(1,"첫 원문"),row(2,"둘째 원문"),row(3,"셋째 원문"),row(4,"넷째 원문")})}};
 json view=base;view["regions"][1]["translation"]="직접 편집한 둘째";view["regions"][2]["textEdited"]=true;view["regions"][3]["manual"]=true;
 auto change=[](int id,const char* before){return json{{"id",id},{"text","テスト"},{"before",before},{"translation","새 번역"}};};
 auto result=apply(base,view,json::array({change(1,"첫 원문"),change(2,"직접 편집한 둘째"),change(3,"셋째 원문"),change(4,"넷째 원문")}));
 assert(result["applied"]==1&&result["conflicts"]==3);
 assert(view["regions"][0]["translation"]=="새 번역"&&view["regions"][0]["box"]==base["regions"][0]["box"]);
 assert(base["regions"][0]["translation"]=="첫 원문");
 assert(view["regions"][1]["translation"]=="직접 편집한 둘째");
 assert(apply(base,view,json::array({change(1,"첫 원문")}))["conflicts"]==1);
}
