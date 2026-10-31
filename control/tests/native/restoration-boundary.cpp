#include "../../../native/restoration_boundary.hpp"
#include <cassert>
int main(){size_t checks=0;
 const std::string text="abcdefghijk?";json reads=json::array({text,text,text,"abcfghijk?"});assert(restoration_boundary_readings(reads,text));checks++;
 for(int i=0;i<3;i++){auto bad=reads;bad[i]="bad";assert(!restoration_boundary_readings(bad,text));checks++;}
 auto bad=reads;bad[3]="abcdefghijklmnop?";assert(!restoration_boundary_readings(bad,text));checks++;
 bad=reads;bad[3]=nullptr;assert(!restoration_boundary_readings(bad,text));checks++;
 Region parent{0,0,.5f,{20,20,60,60},std::vector<uint8_t>(100,1),10};auto left=parent,right=parent;left.query=1;left.box={19,20,45,60};right.query=2;right.box={35,20,60,60};std::vector<Region> found{parent,left,right};LayoutRaw raw;raw.mask_side=10;for(const auto& d:found){raw.logits.insert(raw.logits.end(),{0,-10,-10,-10,-10});for(auto v:d.mask)raw.masks.push_back(v?1:-1);}
 auto make=[&](const Region& r,std::string t){return json{{"id",r.query},{"type","text"},{"mode","tooltip"},{"bbox",r.box},{"box",r.box},{"text",t},{"translation","translated"},{"detectorConfidence",r.score}};};
 auto row=make(parent,text);json replay=json::array({row,make(left,"abcdef"),make(right,"defghijk?")});deduplicate_ocr(replay);assert(replay.size()==1);row=replay[0];assert(restoration_boundary_source(row,found,raw));checks++;
 for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){auto edited=row;edited[flag]=true;assert(!restoration_boundary_source(edited,found,raw));checks++;}
 auto edited=row;edited["ocrDuplicateGeometry"]["sourceText"]="changed";assert(!restoration_boundary_source(edited,found,raw));checks++;
 edited=row;edited["ocrDuplicateGeometry"]["fragments"][0]["bbox"][0]=18;assert(!restoration_boundary_source(edited,found,raw));checks++;
 edited=row;edited["ocrDuplicateGeometry"]["fragments"][0]["manual"]=true;assert(!restoration_boundary_source(edited,found,raw));checks++;
 found[1].mask[0]=0;assert(!restoration_boundary_source(row,found,raw));checks++;
 found[1]=left;PageImage image{200,200,std::vector<uint8_t>(200*200*3,255)};for(int y=25;y<33;y++)for(int x=30;x<34;x++)for(int c=0;c<3;c++)image.rgb[(y*200+x)*3+c]=0;
 Region balloon{3,2,.8f,{25,15,70,65},std::vector<uint8_t>(100*100),100};for(int y=8;y<32;y++)for(int x=13;x<35;x++)balloon.mask[y*100+x]=1;found.push_back(balloon);json rows=json::array({row});auto run=[&](){return restoration_boundary(image,found,rows,raw,[]{},[&](const PageImage&,Box,int,bool){return text;});};auto accepted=run();assert(accepted.masks.size()==1);checks++;
 const auto& mask=accepted.masks.begin()->second;for(int y=0;y<200;y++)for(int x=0;x<200;x++){if(x<mask.bounds[0]||y<mask.bounds[1]||x>=mask.bounds[2]||y>=mask.bounds[3])continue;const int w=mask.bounds[2]-mask.bounds[0];if(mask.pixels[(y-mask.bounds[1])*w+x-mask.bounds[0]])assert(x>=28&&x<36&&y>=23&&y<35);}checks++;
 auto neighbor=make(parent,"neighbor");neighbor["id"]=8;rows.push_back(neighbor);assert(run().masks.empty());rows.erase(1);checks++;
 found.back().score=.64;assert(run().masks.empty());found.back()=balloon;checks++;
 auto effect=balloon;effect.cls=1;effect.box={25,20,40,40};found.push_back(effect);assert(run().masks.empty());found.pop_back();checks++;
 auto nested=balloon;nested.score=.55f;nested.box={26,16,65,55};found.push_back(nested);assert(run().masks.size()==1);checks++;
 found.back().box={15,16,65,55};assert(run().masks.empty());checks++;found.back()=nested;std::fill(found.back().mask.begin(),found.back().mask.end(),1);for(int y=8;y<20;y++)for(int x=13;x<23;x++)found[3].mask[y*100+x]=0;assert(run().masks.empty());checks++;found.pop_back();found[3]=balloon;
 auto savedImage=image;std::fill(image.rgb.begin(),image.rgb.end(),0);assert(run().masks.empty());image=savedImage;checks++;
 assert(restoration_boundary(image,found,rows,raw,[]{},[](const PageImage&,Box,int,bool){return "wrong reading";}).masks.empty());checks++;
 std::cout<<"PASS "<<checks<<" boundary source/read guards\n";
}
