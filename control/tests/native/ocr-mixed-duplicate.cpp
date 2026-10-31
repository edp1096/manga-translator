#include "../../../native/ocr_mixed_duplicate.hpp"
#include <cassert>
int main(int argc,char**argv){
 require(argc==2,"fixture required");const auto fixture=read_json(fs::u8path(argv[1]));auto rows=fixture.at("regions");std::vector<Region> masks;const int w=fixture.at("width"),h=fixture.at("height");
 for(const auto& row:rows){Region r{};r.cls=row.at("type")=="text"?0:1;r.box=row.at("bbox").get<Box>();r.score=row.at("detectorConfidence");const auto m=row.at("hitMask");r.mask_side=m.at("width");r.mask.resize(size_t(r.mask_side)*r.mask_side);for(size_t i=0;i<m.at("runs").size();i+=2){const size_t start=m["runs"][i],n=m["runs"][i+1];std::fill(r.mask.begin()+start,r.mask.begin()+start+n,1);}masks.push_back(std::move(r));}
 size_t parent=0,child=0,effect=0;for(size_t i=0;i<rows.size();i++){if(rows[i]["id"]==6)parent=i;else if(rows[i]["id"]==9)child=i;else effect=i;}
 int checks=0;auto check=[&](json r,std::vector<Region> d,bool expected){checks++;const auto before=r;const auto proof=suppress_mixed_duplicates(r,d,w,h);require((proof.size()==1)==expected,"Unexpected proof at test"+std::to_string(checks));if(expected){require(r.size()==2,"Lost independent owner");for(const auto& item:r){auto it=std::find_if(before.begin(),before.end(),[&](const json& old){return old.at("id")==item.at("id");});require(it!=before.end()&&*it==item,"Owner changed");}}else require(r==before,"Rejected input mutated");};
 check(rows,masks,true);
 for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})for(size_t i=0;i<rows.size();i++){auto r=rows;r[i][flag]=true;check(r,masks,false);}
 for(size_t i=0;i<rows.size();i++){auto r=rows;r[i]["textVerification"]={{"version",1}};check(r,masks,false);r=rows;r[i]["detectorConfidence"]=.77;check(r,masks,false);r=rows;r[i]["bbox"][0]=r[i]["bbox"][0].get<int>()+1;check(r,masks,false);auto d=masks;d.push_back(d[i]);check(rows,d,false);}
 {auto r=rows;r[child]["text"]="Different text";check(r,masks,false);}
 {auto r=rows;r[child]["text"]=r[child]["text"].get<std::string>()+"?";check(r,masks,false);}
 {auto r=rows;r[effect]["text"]="Bang";check(r,masks,false);}
 {auto r=rows;r[effect]["type"]="text";check(r,masks,false);}
 {auto d=masks;std::fill(d[child].mask.begin(),d[child].mask.end(),0);check(rows,d,false);}
 {auto d=masks;std::fill(d[effect].mask.begin(),d[effect].mask.end(),0);check(rows,d,false);}
 {auto d=masks;d[parent].mask[10059]=1;check(rows,d,false);}
 {auto r=rows;auto d=masks;r[child]["detectorConfidence"]=.6;d[child].score=.6;check(r,d,false);}
 {auto r=rows;auto d=masks;r[parent]["detectorConfidence"]=.7;d[parent].score=.7;check(r,d,false);}
 {auto r=rows;auto d=masks;r[effect]["detectorConfidence"]=.39;d[effect].score=.39;check(r,d,false);}
 {auto r=rows;for(auto i:{parent,child})r[i]["text"]="Another repeated sentence!";check(r,masks,true);}
 {auto r=rows;for(auto i:{parent,child})r[i]["text"]="另一段完全相同的文本！";check(r,masks,true);}
 std::cout<<"PASS "<<checks<<" mixed duplicate checks\n";
}
