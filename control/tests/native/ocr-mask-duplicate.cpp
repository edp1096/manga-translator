#include "../../../native/ocr_mask_duplicate.hpp"
#include <cassert>
int main(int argc,char** argv){
 const int side=192;std::vector<Region> found{{0,0,.53f,{20,20,100,180},std::vector<uint8_t>(side*side),side},{1,0,.57f,{20,25,70,175},std::vector<uint8_t>(side*side),side}};
 for(int y=30;y<170;y++)for(int x=30;x<60;x++)found[0].mask[y*side+x]=found[1].mask[y*side+x]=1;
 json rows=json::array();for(size_t i=0;i<found.size();i++)rows.push_back({{"id",i},{"type","text"},{"mode","replace"},{"text","A repeated sentence!"},{"bbox",found[i].box},{"detectorConfidence",found[i].score}});
 int tests=0;auto check=[&](json r,std::vector<Region> d,bool expected){tests++;const auto before=r,proof=suppress_mask_duplicates(r,d,side,side);assert((proof.size()==1)==expected);if(expected){assert(r.size()==1&&r[0]==before[1]);}else assert(r==before);};check(rows,found,true);
 for(const auto flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated"})for(int i=0;i<2;i++){auto r=rows;r[i][flag]=true;check(r,found,false);}
 {auto r=rows;r[1]["text"]="Another distinct sentence!";check(r,found,false);}
 {auto r=rows;r[1]["text"]="A repeated sentence?";check(r,found,true);}
 {auto r=rows;r[0]["text"]=r[1]["text"]="Yes";check(r,found,false);}
 {auto r=rows;r[1]["type"]="effect";check(r,found,false);}
 {auto r=rows;r[1]["textVerification"]={{"version",1}};check(r,found,false);}
 {auto r=rows;r[1]["bbox"][0]=21;check(r,found,false);}
 {auto r=rows;r[1]["detectorConfidence"]=.58;check(r,found,false);}
 {auto d=found;d.push_back(d[1]);check(rows,d,false);}
 {auto d=found;d[1].mask_side=64;check(rows,d,false);}
 {auto d=found;std::fill(d[0].mask.begin(),d[0].mask.end(),0);check(rows,d,false);}
 {auto d=found;for(int y=30;y<60;y++)for(int x=30;x<60;x++)d[0].mask[y*side+x]=0;check(rows,d,false);}
 {auto r=rows;r[1]["detectorConfidence"]=.54;auto d=found;d[1].score=.54;check(r,d,false);}
 {auto r=rows;r[1]["bbox"]=Box{110,25,160,175};auto d=found;d[1].box=r[1]["bbox"].get<Box>();check(r,d,false);}
 // Partial crop has one OCR substitution; a stronger whole crop owns its ink.
 auto partialRows=rows;auto partialFound=found;
 std::swap(partialRows[0]["bbox"],partialRows[1]["bbox"]);std::swap(partialFound[0].box,partialFound[1].box);
 partialRows[0]["text"]="repeated sentencx";partialRows[1]["text"]="Here is a repeated sentence!";
 check(partialRows,partialFound,true);
 for(const auto flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated"})for(int i=0;i<2;i++){auto r=partialRows;r[i][flag]=true;check(r,partialFound,false);}
 {auto r=partialRows;r[0]["text"]="repeated sentexcx";check(r,partialFound,false);}
 {auto r=partialRows;r[0]["text"]="sentencx";check(r,partialFound,false);}
 {auto r=partialRows;r[1]["text"]="repeated sentence";check(r,partialFound,false);}
 {auto d=partialFound;d[0].mask[100*side+65]=1;check(partialRows,d,false);}
 {auto d=partialFound;d[0].mask[100*side+60]=1;check(partialRows,d,true);}
 {auto d=partialFound;d[0].mask[100*side+61]=1;check(partialRows,d,true);}
 {auto d=partialFound;d[0].mask[100*side+62]=1;check(partialRows,d,false);}
 {auto d=partialFound;for(int y=30;y<60;y++)for(int x=30;x<60;x++)d[1].mask[y*side+x]=0;check(partialRows,d,false);}
 {auto r=partialRows;r[1]["detectorConfidence"]=.54;auto d=partialFound;d[1].score=.54;check(r,d,false);}
 {auto d=partialFound;d.push_back(d[1]);check(partialRows,d,false);}
 {auto r=partialRows;r[1]["textVerification"]={{"version",1}};check(r,partialFound,false);}
 {auto r=partialRows;r[0]["type"]="effect";check(r,partialFound,false);}
 std::cout<<"PASS "<<tests<<" nested mask duplicate controls\n";
 for(int i=1;i<argc;i++){
  const auto cached=read_json(argv[i]);auto result=cached.contains("result")?cached.at("result"):cached;auto r=result.at("regions");std::vector<Region> d;
  for(const auto& row:r){if(!row.contains("hitMask"))continue;const auto m=row.at("hitMask");Region item{};item.cls=row.at("type")=="text"?0:1;item.score=row.value("detectorConfidence",0.);item.box=row.at("bbox").get<Box>();item.mask_side=m.at("width");item.mask.resize(size_t(item.mask_side)*item.mask_side);const auto runs=m.at("runs");for(size_t k=0;k<runs.size();k+=2)for(size_t p=runs[k];p<runs[k].get<size_t>()+runs[k+1].get<size_t>();p++)item.mask.at(p)=1;d.push_back(item);}
  const auto proof=suppress_mask_duplicates(r,d,result.at("width"),result.at("height"));if(!proof.empty())std::cout<<json({{"fixture",argv[i]},{"proof",proof}}).dump()<<'\n';
 }
}
