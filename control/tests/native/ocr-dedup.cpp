#include "../../../native/ocr_dedup.hpp"
#include <cassert>

json region(int identifier,const std::string& text,Box bounds,double confidence=.7,const std::string& type="text"){
 return {{"id",identifier},{"text",text},{"bbox",bounds},{"detectorConfidence",confidence},{"type",type},{"ocrTruncated",false}};
}
int main(int count,char** arguments){
 { const auto tight=region(1,"What?!",{40,20,60,120},.65),wide=region(2,"What?!",{22,18,65,122},.3);
 json nested={tight,wide};assert(deduplicate_ocr(nested)==1&&nested[0]["id"]==1);assert((nested[0]["bbox"].get<Box>()==Box{22,18,65,122}));
 auto distant=wide;distant["bbox"]=Box{0,18,65,122};nested={tight,distant};assert(deduplicate_ocr(nested)==0);
 auto uncertain=tight;uncertain["detectorConfidence"]=.45;nested={uncertain,wide};assert(deduplicate_ocr(nested)==0);
 auto different=wide;different["text"]="Why?!";nested={tight,different};assert(deduplicate_ocr(nested)==0);
 auto clipped=tight;clipped["ocrTruncated"]=true;nested={clipped,wide};assert(deduplicate_ocr(nested)==0);
 }

 const auto full=region(7,"出ました! 東條といえばこの構え。 お馴染みの デトロイトスタイルです。",{667,864,853,1026},.51);
 const auto partial=region(5,"山ました!東條といえばこの構え。",{766,868,854,1008},.29);
 json rows={partial,full};assert(deduplicate_ocr(rows)==1&&rows.at(0).at("id")==7);
 rows={region(4,"出ました!",{832,853,853,962},.57),partial,region(6,"お馴染みのデトロイトスタイルです。",{667,893,757,1022},.45),full};assert(deduplicate_ocr(rows)==3&&rows.at(0).at("id")==7);assert((rows.at(0).at("bbox").get<Box>()==Box{667,853,854,1026}));
 rows={region(1,"同じ言葉です。",{0,0,30,100}),region(2,"同じ言葉です。",{60,0,90,100})};assert(deduplicate_ocr(rows)==0);
 rows={region(1,"山田",{10,10,30,80},.3),region(2,"山本",{10,10,30,80},.9)};assert(deduplicate_ocr(rows)==0);
 rows={region(4,"戦と女正闘士",{717,131,829,583},.363),region(5,"戦と女正関士",{716,131,867,581},.328)};assert(deduplicate_ocr(rows)==1&&rows[0]["id"]==4);assert((rows[0]["bbox"].get<Box>()==Box{716,131,867,583}));
 rows={region(4,"戦と女正闘士",{717,131,829,583},.363),region(5,"戦と女正関士",{600,131,750,581},.328)};assert(deduplicate_ocr(rows)==0);
 rows={region(1,"山ました!東條といえばこの構え。",{766,868,854,1008},.9),full};assert(deduplicate_ocr(rows)==0);
 rows={region(1,"ガードが低いな...総合か?",{766,868,854,1008},.29),full};assert(deduplicate_ocr(rows)==0);
 auto truncated=full;truncated["ocrTruncated"]=true;rows={partial,truncated};assert(deduplicate_ocr(rows)==0);
 auto low_overlap=partial;low_overlap["bbox"]=Box{800,868,900,1008};rows={low_overlap,full};assert(deduplicate_ocr(rows)==0);
 rows={region(1,"カン",{10,10,60,50},.3,"effect"),region(2,"バン",{0,0,100,100},.9,"effect")};assert(deduplicate_ocr(rows)==0);
 rows={region(1,"?!",{10,10,60,50}),region(2,"...",{0,0,100,100})};assert(deduplicate_ocr(rows)==0);
 const json dictionary={{"entries",json::array({{{"source","本郷姫奈"},{"translation","혼고 히나"}}})}};
 rows={region(1,"本郷姫奈",{0,0,100,300}),region(2,"本郷",{5,5,90,100},.8,"effect"),region(3,"奈",{5,210,90,290},.8,"effect"),region(4,"奈",{120,210,190,290},.8,"effect"),region(5,"ド",{5,5,90,100},.8,"effect")};auto unregistered=rows;assert(deduplicate_ocr(unregistered)==0);assert(deduplicate_ocr(rows,dictionary)==2&&rows.size()==3);assert(rows[0]["id"]==1&&rows[1]["id"]==4&&rows[2]["id"]==5);
 rows={region(1,"“戦慄の女豹”",{20,20,60,60},.3),region(2,"戦慄の女豹\"束條蘭",{0,0,100,100},.5)};assert(deduplicate_ocr(rows)==1);
 rows={region(8,"“戦慄の女豹”",{806,407,841,534},.31),region(9,"戦慄の女豹\" 束條蘭",{736,409,843,671},.51),region(10,"東條蘭",{736,485,803,675},.29)};assert(deduplicate_ocr(rows)==1&&rows.size()==2&&rows[0]["id"]==8&&rows[1]["id"]==10);
 rows={region(8,"“戦慄の女豹”",{806,407,841,534},.31),region(9,"戦慄の女豹\" 束條蘭はとても強い",{736,409,843,671},.51),region(10,"東條蘭",{736,485,803,675},.29)};deduplicate_ocr(rows);assert(std::any_of(rows.begin(),rows.end(),[](const json& value){return value.at("id")==9;}));
 auto rank=region(4,"一番星天星",{180,266,268,591},.34),name=region(7,"天羽シーナ",{76,376,193,733},.33),parent=region(5,"一番星天日生天羽ミーナ",{80,267,268,733},.3);
 for(auto* child:{&rank,&name})(*child)["textVerification"]={{"version",1},{"method","ocr-consensus"},{"role","LABEL"},{"sources",json::array({child->at("bbox")})}};
 rows={rank,parent,name};assert(deduplicate_ocr(rows)==1&&rows.size()==2&&rows[0]["id"]==4&&rows[1]["id"]==7);
 auto unconfirmed=name;unconfirmed.erase("textVerification");rows={rank,parent,unconfirmed};assert(deduplicate_ocr(rows)==0);
 auto distinct=parent;distinct["text"]="一番星天日生天羽ミーナ登場";rows={rank,distinct,name};deduplicate_ocr(rows);assert(std::any_of(rows.begin(),rows.end(),[](const json& r){return r.at("id")==5;}));
 const auto paragraph1=region(9,"KEEP SENDING YOUR PRISONERS TO FIGHT AT VALKYRIA, PLEEEASE?♡",{790,749,934,895},.466),paragraph2=region(12,"THEY'RE PRETTY STRONG AND ALWAYS LOTS OF FUN. ☆",{778,954,885,1109},.480),looping=region(10,"KEEP SENDING YOUR PRISONERS TO FIGHT AT VALKYRIA, PLEEEEEEEEEEEEEEEEEP RETY STRONG AND ALWAYS LOTS OF FUN. ☆",{786,743,934,1112},.433);
 rows={paragraph1,looping,paragraph2};assert(deduplicate_ocr(rows)==1&&rows.size()==2&&rows[0]["id"]==9&&rows[1]["id"]==12);
 auto extra=looping;extra["text"]=looping.at("text").get<std::string>()+" THERE IS ANOTHER IMPORTANT THING YOU MUST REMEMBER.";rows={paragraph1,extra,paragraph2};deduplicate_ocr(rows);assert(std::any_of(rows.begin(),rows.end(),[](const json& r){return r.at("id")==10;}));
 auto uncertain=paragraph2;uncertain["detectorConfidence"]=.42;rows={paragraph1,looping,uncertain};assert(deduplicate_ocr(rows)==0);
 extra["text"]=looping.at("text").get<std::string>()+" GO!";rows={paragraph1,extra,paragraph2};deduplicate_ocr(rows);assert(std::any_of(rows.begin(),rows.end(),[](const json& r){return r.at("id")==10;}));
 auto separate=paragraph2;separate["bbox"]=Box{600,954,700,1109};rows={paragraph1,looping,separate};assert(deduplicate_ocr(rows)==0);
 auto incomplete=paragraph2;incomplete["ocrTruncated"]=true;rows={paragraph1,looping,incomplete};assert(deduplicate_ocr(rows)==0);
 std::cout<<"PASS OCR containment, repeated-letter parent, extra dialogue, confidence, separate bubbles, names, effects and truncation safeguards\n";
 json fixture_dictionary=json::object();int first_fixture=1;if(count>=3&&std::string(arguments[1])=="--dictionary"){fixture_dictionary=read_json(arguments[2]).at("work");first_fixture=3;}
 for(int argument=first_fixture;argument<count;++argument){
  const auto cache=read_json(arguments[argument]);const auto& pages=cache.is_array()?cache:cache.at("items");
  for(size_t page=0;page<pages.size();++page){auto regions=pages.at(page).at("result").at("regions");const auto before=regions;deduplicate_ocr(regions,fixture_dictionary);
   for(const auto& removed:before)if(std::none_of(regions.begin(),regions.end(),[&](const json& retained){return removed.at("id")==retained.at("id");}))std::cout<<json({{"fixture",arguments[argument]},{"page",page+1},{"removed",removed}}).dump()<<'\n';
  }
 }
}
