#include "../../../native/ocr_context.hpp"
#include <cassert>
int main(){const Box box{10,10,90,200};const json dictionary={{"entries",json::array({{{"source","青葉学院"}}})}};json context=json::array({{{"id",7},{"type","text"},{"text","青葉学院の生徒"},{"bbox",Box{200,10,300,100}},{"detectorConfidence",.95}}});
 auto run=[&](std::string a,std::string b,json d,json c){return contextual_ocr_proposal(a,b,box,d,c);};
 auto good=run("青菜学院校長。","青華学院校長。",dictionary,context);assert(!good.is_null()&&good.at("text")=="青葉学院校長。"&&good.at("method")=="dictionary-context");
 assert(run("青菜学院","青菜学院",dictionary,context).is_null());assert(run("青菜学院","赤華学院",dictionary,context).is_null());assert(run("青菜学院","青華学",dictionary,context).is_null());assert(run("青な学院","青華学院",dictionary,context).is_null());assert(run("青菜学院","青華学院",dictionary,json::array()).is_null());
 auto bad=context;bad[0]["bbox"]=box;assert(run("青菜学院","青華学院",dictionary,bad).is_null());bad=context;bad[0]["detectorConfidence"]=.8;assert(run("青菜学院","青華学院",dictionary,bad).is_null());bad=context;bad[0]["ocrTruncated"]=true;assert(run("青菜学院","青華学院",dictionary,bad).is_null());
 auto ambiguous=dictionary;ambiguous["entries"].push_back({{"source","青花学院"}});bad=context;bad[0]["text"]="青葉学院と青花学院";assert(run("青菜学院","青華学院",ambiguous,bad).is_null());
 auto shortDictionary=dictionary;shortDictionary["entries"]=json::array({{{"source","短名"}}});bad=context;bad[0]["text"]="短名";assert(run("短各","短各長",shortDictionary,bad).is_null());assert(run("短各","短明",shortDictionary,bad).is_null());
 auto prefixed=run("「青菜学院」の校長","「青華学院」の校長",dictionary,context);assert(prefixed.at("text")=="「青葉学院」の校長");
 auto mixed=contextual_ocr_proposal("青菜学院校長。","青な学院校長。",box,dictionary,context,true);assert(!mixed.is_null());
 good["bounds"]=box;good["mainBox"]=Box{10,10,65,200};good["rubyBox"]=Box{66,15,85,100};good["rubyText"]="あおば";good["polarity"]=good["first"];good["preprocessing"]="white-foreground-160";
 json verified={{"bbox",box},{"text",good.at("text")},{"textVerification",{{"version",1},{"method","ocr-context"},{"contextProofs",json::array({good})}}}};
 assert(valid_ocr_context(verified)&&ocr_context_sources_match(verified,context));
 auto stale=context;stale[0]["text"]="別の学校";assert(!ocr_context_sources_match(verified,stale));
 auto malformed=verified;malformed["textVerification"]["contextProofs"][0]["polarity"]="別の文字";assert(!valid_ocr_context(malformed));malformed=verified;malformed["textVerification"]["contextProofs"][0]["support"]["detectorConfidence"]=.2;assert(!valid_ocr_context(malformed));malformed=verified;malformed["textVerification"]["contextProofs"]=json::array();assert(!valid_ocr_context(malformed));
 std::cout<<"PASS contextual OCR proposals: unique supported term and byte preservation; consensus/multiple errors/no context/overlap/weak/truncated/ambiguity rejected\n";
}
