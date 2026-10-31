#include "../../../native/ocr_disagreement.hpp"
int main(){using namespace ocr_disagreement;int checks=0;auto ok=[&](bool b){checks++;require(b,"Check "+std::to_string(checks));};
 const std::vector<std::string> a{"官めるダメッ!!","賞めるダメッ!!","管めるダメッ!!","管めるダメッ!!"},b(4,"嘗めるダメッ！！");auto p=consensus(a,b);ok(!p.is_null());ok(p.at("text")=="嘗めるダメッ!!");ok(p.at("index")==0);
 auto spaced=a;spaced[0]=" \n官める ダメッ!!";ok(consensus(spaced,b).at("text")==" \n嘗める ダメッ!!");
 for(int i=0;i<4;i++){auto v=b;v[i]="営めるダメッ!!";ok(!consensus(a,v).is_null());v[(i+1)%4]="営めるダメッ!!";ok(consensus(a,v).is_null());}
 {auto v=a;v[2]=v[3]=v[1];ok(consensus(v,b).is_null());}
 {auto v=a;v[1]+="?";ok(consensus(v,b).is_null());}
 {auto v=a;v[1]="賞めろダメッ!!";ok(consensus(v,b).is_null());}
 {auto v=b;for(auto& x:v)x="嘗めろダメッ!!";ok(consensus(a,v).is_null());}
 {auto v=b;for(auto& x:v)x="管めるダメッ!!";ok(consensus(a,v).is_null());}
 {auto v=a;v[0]="Aめるダメッ!!";ok(consensus(v,b).is_null());}
 ok(consensus(std::vector<std::string>(4,"今大会一番のビッグネームだ。"),std::vector<std::string>(4,"今大会二番のビッグネームだ。")).is_null());
 json row={{"type","text"},{"safe",false},{"bbox",{1,1,80,200}},{"text",a[0]},{"detectorConfidence",.8}};ok(eligible(row));
 for(auto key:{"safe","manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){auto r=row;r[key]=true;ok(!eligible(r));}
 for(auto key:{"textVerification","ocrDuplicateGeometry"}){auto r=row;r[key]=json::object();ok(!eligible(r));}
 {auto r=row;r["detectorConfidence"]=.64;ok(!eligible(r));}
 {auto r=row;r["text"]="...";ok(!eligible(r));}
 {auto r=row;r["type"]="effect";ok(!eligible(r));}
 std::cout<<"PASS "<<checks<<" single-glyph disagreement guards\n";
}
