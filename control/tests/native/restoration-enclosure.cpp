#include "../../../native/restoration_enclosure.hpp"
#include <cassert>

int main(){
 PageImage image{720,1020,std::vector<uint8_t>(720*1020*3,180)};const Box box{300,450,360,600};
 Region text{0,0,.95f,box,std::vector<uint8_t>(192*192),192},balloon{1,2,.3f,{280,420,390,630},std::vector<uint8_t>(192*192),192};
 for(int y=0;y<192;y++)for(int x=0;x<192;x++){const double px=(x+.5)*720/192,py=(y+.5)*1020/192;text.mask[y*192+x]=px>=305&&px<355&&py>=460&&py<590;balloon.mask[y*192+x]=px>=280&&px<390&&py>=420&&py<630;}
 json row={{"id",1},{"type","text"},{"mode","tooltip"},{"bbox",box},{"box",box},{"detectorConfidence",text.score},{"text","本文です"},{"translation","본문입니다"}};
 std::vector<Region> found{text,balloon};LayoutRaw raw;int checks=0;
 auto call=[&](const json& rows){return restoration_enclosures(image,found,rows,raw,[]{});};
 auto good=call(json::array({row}));assert(good.masks.size()==1&&good.masks.at(1).accepted());assert(good.evidence.at("1").at("reading")=="high-confidence-text");assert(found[1].score==.3f);checks++;
 const auto& mask=good.masks.at(1);assert(mask.enclosures.size()==1&&mask.bubble==&found[1]);
 for(int y=mask.bounds[1];y<mask.bounds[3];++y)for(int x=mask.bounds[0];x<mask.bounds[2];++x)if(mask.pixels[size_t(y-mask.bounds[1])*(mask.bounds[2]-mask.bounds[0])+x-mask.bounds[0]])assert(restoration_interior(found[1],x,y,image));checks++;
 // Two nested uncertain outlines constrain their intersection, not their union.
 auto inner=balloon;inner.score=.55f;inner.box={285,425,385,625};for(int y=0;y<192;y++)for(int x=0;x<192;x++)inner.mask[y*192+x]=inner.mask[y*192+x]&&((x+.5)*720/192>=285)&&((x+.5)*720/192<385)&&((y+.5)*1020/192>=425)&&((y+.5)*1020/192<625);found.push_back(inner);
 good=call(json::array({row}));assert(good.masks.size()==1&&good.masks.at(1).enclosures.size()==2);auto clip=restoration_enclosure_geometry(good.masks.at(1));assert(clip.box==inner.box&&clip.score==.3f);for(size_t i=0;i<clip.mask.size();i++)assert(!clip.mask[i]||(found[1].mask[i]&&found[2].mask[i]));checks++;
 // A partial competing outline remains a veto; it is not merged into ownership.
 found[2].box={329,440,385,610};assert(call(json::array({row})).masks.empty());checks++;found.pop_back();
 auto other=row;other["id"]=2;other["bbox"]=Box{330,450,370,600};assert(call(json::array({row,other})).masks.empty());checks++;
 found[1].score=.8f;assert(call(json::array({row})).masks.empty());checks++;found[1].score=.3f;
 found[1].box={0,0,720,1020};assert(call(json::array({row})).masks.empty());checks++;found[1]=balloon;
 found[1].mask.clear();assert(call(json::array({row})).masks.empty());checks++;found[1]=balloon;
 for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){auto edited=row;edited[flag]=true;assert(call(json::array({edited})).masks.empty());checks++;}
 auto edited=row;edited["type"]="effect";assert(call(json::array({edited})).masks.empty());checks++;
 edited=row;edited["detectorConfidence"]=.8;assert(call(json::array({edited})).masks.empty());checks++;
 edited=row;edited["translation"]=edited["text"];assert(call(json::array({edited})).masks.empty());checks++;
 found[0].score=.825f;row["detectorConfidence"]=found[0].score;int reads=0;
 auto medium=restoration_enclosures(image,found,json::array({row}),raw,[]{},[&](const json& r){reads++;assert(r.at("text")==row.at("text"));return false;});assert(medium.masks.empty()&&reads==1);checks++;
 medium=restoration_enclosures(image,found,json::array({row}),raw,[]{},[](const json&){return true;});assert(medium.masks.size()==1&&medium.evidence.at("1").at("reading")=="original-ocr-consensus");checks++;
 found[0].score=.4f;row["detectorConfidence"]=found[0].score;found[0].ocr_verified=true;row["textVerification"]={{"version",1},{"method","ocr-consensus"},{"role","LABEL"},{"sources",json::array({box})}};good=call(json::array({row}));assert(good.masks.size()==1&&good.evidence.at("1").at("reading")=="verified-ocr");checks++;
 row["textVerification"]["sources"]=json::array({Box{0,0,20,20}});assert(call(json::array({row})).masks.empty());checks++;
 found[0]=text;row.erase("textVerification");row["detectorConfidence"]=text.score;assert(restoration_enclosures(image,found,json::array({row}),raw,[]{},{},{1}).masks.empty());checks++;
 // Detector glyphs touching the uncertain boundary cannot be shaved away.
 found[1].box[0]=300;for(int y=0;y<192;y++)for(int x=0;x<192;x++)if((x+.5)*720/192>=300&&(x+.5)*720/192<305&&(y+.5)*1020/192>=460&&(y+.5)*1020/192<480)found[0].mask[y*192+x]=1;assert(call(json::array({row})).masks.empty());checks++;
 std::cout<<"PASS "<<checks<<" bounded-enclosure geometry, source, neighbor and reading controls\n";
}
