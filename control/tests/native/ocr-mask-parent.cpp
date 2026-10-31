#include "../../../native/ocr_mask_parent.hpp"
#include <cassert>
int main(){
 const int side=192;std::vector<Region> found{{0,0,.3f,{10,10,100,100},std::vector<uint8_t>(side*side),side},{1,0,.4f,{10,10,50,100},std::vector<uint8_t>(side*side),side},{2,0,.4f,{60,10,100,100},std::vector<uint8_t>(side*side),side}};
 for(int y=30;y<60;y++)for(int x=20;x<30;x++)found[0].mask[y*side+x]=found[1].mask[y*side+x]=1;for(int y=30;y<60;y++)for(int x=70;x<80;x++)found[0].mask[y*side+x]=found[2].mask[y*side+x]=1;
 json rows=json::array();for(size_t i=0;i<found.size();i++)rows.push_back({{"id",i},{"type","text"},{"mode","tooltip"},{"text",i==0?"Caption and label":i==1?"Caption":"Label"},{"bbox",found[i].box},{"detectorConfidence",found[i].score}});rows[1]["textVerification"]={{"version",1},{"method","ocr-consensus"},{"role","LABEL"},{"sources",json::array({found[1].box})}};
 auto test=[&](json r,std::vector<Region> d,bool expected){const auto before=r,proof=suppress_mask_parents(r,d,side,side);assert((proof.size()==1)==expected);if(expected){assert(r.size()==2);assert(r[0]==before[1]&&r[1]==before[2]);}else assert(r==before);};test(rows,found,true);
 {auto d=found;d[0].mask[90*side+55]=1;test(rows,d,false);}
 {auto d=found;d[0].mask[30*side+19]=1;test(rows,d,true);}
 {auto d=found;std::fill(d[2].mask.begin(),d[2].mask.end(),0);test(rows,d,false);}
 {auto d=found;d[2].mask_side=64;test(rows,d,false);}
 {auto r=rows;r[1].erase("textVerification");test(r,found,false);}
 {auto r=rows;r[1]["manual"]=true;test(r,found,false);}
 {auto r=rows;r[1]["ocrTruncated"]=true;test(r,found,false);}
 {auto r=rows;r[0]["detectorConfidence"]=.9;test(r,found,false);}
 {auto r=rows;r[1]["bbox"][0]=11;test(r,found,false);}
 {auto r=rows;r[1]["detectorConfidence"]=.41;test(r,found,false);}
 {auto d=found;d.push_back(d[1]);test(rows,d,false);}
 {auto r=rows;r[1].erase("textVerification");r[0]["mode"]="replace";r[0]["text"]="abcdefGXijklmnop";r[1]["text"]="abcdefgh";r[2]["text"]="ijklmnop";
  auto read=[](const json& row)->json{const auto t=row.at("text");return json::array({t,t,t,t});};auto copy=r;auto proof=suppress_mask_parents(copy,found,side,side,read);assert(copy.size()==2&&proof[0]["method"]=="verified-mask-owners");
  auto bad=[](const json&)->json{return json::array({"bad","bad","bad","bad"});};copy=r;assert(suppress_mask_parents(copy,found,side,side,bad).empty()&&copy==r);
  auto d=found;d[0].mask[90*side+55]=1;copy=r;assert(suppress_mask_parents(copy,d,side,side,read).empty());
  r[0]["text"]="XbcdefGXijklmnop";copy=r;assert(suppress_mask_parents(copy,found,side,side,read).empty());
 }
 {auto r=rows;r[1].erase("textVerification");r[0]["mode"]="replace";r[0]["text"]="abcdefghijklmnop";r[1]["text"]="abcdefgh";r[2]["text"]="ijklmnop";
  auto read=[](const json& row)->json{const auto t=row.at("text");return json::array({t,t,t,t});};auto d=found;
  for(int y=70;y<75;y++)for(int x=50;x<60;x++)d[0].mask[y*side+x]=1;
  PageImage image{side,side,std::vector<uint8_t>(side*side*3,255)};for(int y=35;y<55;y++)for(int x=22;x<28;x++)for(int c=0;c<3;c++)image.rgb[(y*side+x)*3+c]=0;
  auto copy=r;auto proof=suppress_mask_parents(copy,d,side,side,read,&image);assert(proof.size()==1&&proof[0]["pixelOwnership"]==true&&proof[0]["checkedInk"]==120);
  copy=r;assert(suppress_mask_parents(copy,d,side,side,read).empty());
  for(int c=0;c<3;c++)image.rgb[(72*side+55)*3+c]=0;copy=r;assert(suppress_mask_parents(copy,d,side,side,read,&image).empty());
  auto bad=[](const json&)->json{return json::array({"bad","bad","bad","bad"});};for(auto&v:image.rgb)v=255;copy=r;assert(suppress_mask_parents(copy,d,side,side,bad,&image).empty());
 }
 std::cout<<"PASS aggregate mask ownership:20 cases\n";
}
