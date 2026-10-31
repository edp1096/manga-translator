#include "../../../native/ruby_annotations.hpp"
#include <cassert>
json label(int id,std::string text,Box b){return {{"id",id},{"type","text"},{"text",text},{"bbox",b},{"textVerification",{{"version",1},{"method","ocr-consensus"},{"role","LABEL"},{"sources",json::array({b})}}}};}
int main(int argc,char** argv){
 const json dict={{"entries",json::array({{{"source","山田花子"},{"reading","やまだ はなこ"},{"kind","person"},{"matchReading",false}}})}};
 auto owner=label(1,"山田花子",{100,100,200,500}),ruby=label(2,"はなこ",{195,300,220,370});
 auto run=[&](json r,std::vector<Region> detected=std::vector<Region>{}){auto n=associate_name_ruby(r,dict,detected,1000,1000);return std::make_pair(n,r);};
 auto [n,merged]=run(json::array({owner,ruby}));assert(n==1&&merged.size()==1&&merged[0]["text"]=="山田花子"&&merged[0]["textVerification"]["sources"].size()==2);
 for(int test=0;test<8;++test){auto r=ruby;auto o=owner;switch(test){case 0:r["text"]="よしこ";break;case 1:r["textVerification"]["role"]="DIALOGUE";break;case 2:r["ocrTruncated"]=true;break;case 3:o.erase("textVerification");break;case 4:r["bbox"]=Box{250,300,275,370};break;case 5:r["bbox"]=Box{180,300,230,370};break;case 6:r["bbox"]=Box{195,520,220,590};break;case 7:o["text"]="別人";break;}assert(run(json::array({o,r})).first==0);}
 auto duplicate=owner;duplicate["id"]=3;assert(run(json::array({owner,ruby,duplicate})).first==0);
 Region bubble{0,2,.9f,Box{190,290,230,380},{},192};assert(run(json::array({owner,ruby}),{bubble}).first==0);
 auto small=json::array({owner,ruby});assert(associate_name_ruby(small,dict,{},400,500)==0);
 if(argc==4){std::ifstream rf(argv[1]),df(argv[2]);json result,request;rf>>result;df>>request;auto rows=result.at("regions");auto dictionary=request.at("dictionary");auto count=associate_name_ruby(rows,dictionary,{},result.at("width"),result.at("height"));assert(count==1);for(const auto& r:rows){assert(r.at("id")!=10);if(r.at("id")==1)assert(r.at("textVerification").at("sources").size()==7);}std::ofstream(argv[3])<<rows.dump(2);}
 std::cout<<"PASS name ruby ownership, alias-disabled reading, dialogue/bubble/ambiguity/geometry/truncation/area guards\n";
}
