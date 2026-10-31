#include "../../../native/restoration_joint.hpp"
#include <cassert>
int main(){
 PageImage image{300,300,std::vector<uint8_t>(300*300*3,255)};std::vector<Region> found{{0,0,.4f,{20,20,90,120},std::vector<uint8_t>(300*300),300},{1,0,.4f,{80,20,150,120},std::vector<uint8_t>(300*300),300}};
 for(size_t i=0;i<found.size();i++){found[i].ocr_verified=true;for(int y=30;y<60;y++)for(int x=78+int(i)*6;x<84+int(i)*6;x++)found[i].mask[y*300+x]=1;}
 json rows=json::array();for(size_t i=0;i<found.size();i++)rows.push_back({{"id",i},{"type","text"},{"mode","tooltip"},{"text","ABCD"},{"translation","Label"},{"bbox",found[i].box},{"textVerification",{{"version",1},{"method","ocr-consensus"},{"role","LABEL"},{"sources",json::array({found[i].box})}}}});
 auto check=[&](const json& r,const std::vector<Region>& d,bool expected){const auto result=joint_restoration(image,d,r);assert((result.groups.size()==1&&result.masks.size()==2)==expected);if(!expected)assert(result.masks.empty());for(const auto& m:result.masks)assert(m.second.accepted()&&!m.second.bubble);};
 check(rows,found,true);
 for(auto key:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated"}){auto r=rows;r[0][key]=true;check(r,found,false);}
 {auto r=rows;r[0].erase("textVerification");check(r,found,false);}
 {auto r=rows;r[0]["translation"]="";check(r,found,false);}
 {auto r=rows;r.push_back({{"id",5},{"type","text"},{"mode","tooltip"},{"text","Foreign"},{"bbox",Box{78,30,82,60}}});check(r,found,false);}
 {auto d=found;auto effect=d[0];effect.cls=1;effect.score=.99f;effect.ocr_verified=false;d.push_back(effect);check(rows,d,false);}
 {auto d=found;d[1].mask=d[0].mask;check(rows,d,false);}
 {auto d=found;std::fill(d[1].mask.begin(),d[1].mask.end(),0);for(int y=30;y<60;y++)for(int x=100;x<106;x++)d[1].mask[y*300+x]=1;check(rows,d,false);assert(joint_restoration(image,found,rows,&d).masks.empty());}
 {auto d=found;Region b{2,2,.99f,{0,0,170,150},std::vector<uint8_t>(300*300),300};for(int y=0;y<150;y++)for(int x=0;x<170;x++)b.mask[y*300+x]=1;d.push_back(b);check(rows,d,false);}
 std::cout<<"PASS joint restoration:14 cases, atomic rejection and unchanged independent labels\n";
}
