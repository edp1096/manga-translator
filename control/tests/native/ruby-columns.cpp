#include "../../../native/ruby_columns.hpp"
#include <cassert>
int main(){
 const Box parent{716,131,867,581},main{717,131,829,583};Region core{0,0,.35f,main,{},192};
 const json ruby={{"bbox",Box{828,169,863,316}},{"text","ヴァルキュリア"}};
 const json lower={{"bbox",Box{818,401,848,519}},{"text","せいとうし"}};
 json rows=json::array({ruby,lower});auto found=detected_ruby_main(parent,{core},rows);assert(found&&*found==main);
 auto bad=ruby;bad["text"]="別の台詞";assert(!detected_ruby_main(parent,{core},json::array({bad,lower})));
 bad=ruby;bad["ocrTruncated"]=true;assert(!detected_ruby_main(parent,{core},json::array({bad})));
 bad=ruby;bad["bbox"]=Box{800,140,865,575};assert(!detected_ruby_main(parent,{core},json::array({bad})));
 bad=ruby;bad["bbox"]=Box{828,600,863,740};assert(!detected_ruby_main(parent,{core},json::array({bad})));
 auto weak=core;weak.score=.19f;assert(!detected_ruby_main(parent,{weak},rows));
 auto short_core=core;short_core.box[3]=400;assert(!detected_ruby_main(parent,{short_core},rows));
 assert(!detected_ruby_main(parent,{core},json::array()));
 auto other=core;other.box={740,131,850,583};assert(!detected_ruby_main(parent,{other},rows));
 assert(!detected_ruby_main({0,0,200,100},{core},rows));
 std::cout<<"PASS ruby column geometry, kana-only side readings, extra dialogue, truncation, confidence and separation guards\n";
}
