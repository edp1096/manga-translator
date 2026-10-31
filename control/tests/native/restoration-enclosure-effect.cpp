#include "../../../native/restoration_enclosure.hpp"
#include <cassert>
int main(){
 PageImage image{720,1020,std::vector<uint8_t>(720*1020*3,180)};const float strong=1/(1+std::exp(-4.f)),weak=1/(1+std::exp(1.1f));
 Region source{0,0,strong,{300,450,360,600},std::vector<uint8_t>(192*192),192},effect{1,1,weak,{270,420,400,630},std::vector<uint8_t>(192*192),192},bubble{2,2,.35f,{280,430,390,620},std::vector<uint8_t>(192*192),192};
 for(int y=0;y<192;y++)for(int x=0;x<192;x++){const double px=(x+.5)*720/192,py=(y+.5)*1020/192;source.mask[y*192+x]=px>=305&&px<355&&py>=460&&py<590;effect.mask[y*192+x]=px>=270&&px<400&&py>=420&&py<630;bubble.mask[y*192+x]=px>=280&&px<390&&py>=430&&py<620;}
 LayoutRaw raw;raw.mask_side=192;raw.logits={4,-8,-8,-8,-8,-8,-1.1f,-8,-8,-8};for(auto v:source.mask)raw.masks.push_back(v?.5f:-8.f);for(auto v:effect.mask)raw.masks.push_back(v?.05f:-8.f);
 const json row={{"id",1},{"type","text"},{"mode","tooltip"},{"bbox",source.box},{"box",source.box},{"text","Source dialogue"},{"translation","원문 대사"},{"detectorConfidence",strong}},other={{"id",2},{"type","effect"},{"mode","tooltip"},{"bbox",effect.box},{"box",effect.box},{"text","Effect"},{"translation","효과음"},{"detectorConfidence",weak}};const auto rows=json::array({row,other});std::vector<Region> found{source,effect,bubble};int checks=0;
 const json proof={{"version",1},{"method","four-view-original-ocr"},{"agreement",json::array({true,true,false,true})}};
 auto run=[&](const json& inputs,const LayoutRaw& inference,const std::function<json(const json&)>& verify){return restoration_enclosures(image,found,inputs,inference,[]{},{},{},verify);};
 assert(restoration_mask(image,source,row,found,rows,&raw,{&found[2]}).reason=="neighbor-text");checks++;
 assert(run(rows,raw,{}).masks.empty());checks++;assert(run(rows,raw,[](const json&){return json(nullptr);}).masks.empty());checks++;
 auto accepted=run(rows,raw,[&](const json& r){assert(r==row);return proof;});assert(accepted.masks.size()==1&&accepted.evidence.at("1").at("reading")=="multi-view-ocr-consensus");assert(accepted.masks.at(1).effectNeighbors.at(0).at("method")=="enclosure-effect-mask");checks++;
 const auto& mask=accepted.masks.at(1);for(int y=mask.bounds[1];y<mask.bounds[3];y++)for(int x=mask.bounds[0];x<mask.bounds[2];x++)if(mask.pixels[size_t(y-mask.bounds[1])*(mask.bounds[2]-mask.bounds[0])+x-mask.bounds[0]])assert(restoration_interior(found[2],x,y,image));checks++;
 // Merely passing the reading flag cannot relax ordinary outside restoration.
 auto outside=found;outside.pop_back();assert(restoration_mask(image,source,row,outside,rows,&raw,{},true).reason=="neighbor-text");checks++;
 auto contested=raw;for(size_t i=source.mask.size();i<contested.masks.size();i++)if(contested.masks[i]>0)contested.masks[i]=8;assert(run(rows,contested,[&](const json&){return proof;}).masks.empty());checks++;
 assert(run(rows,LayoutRaw{},[&](const json&){return proof;}).masks.empty());checks++;
 auto stale=raw;stale.masks[0]=1;assert(run(rows,stale,[&](const json&){return proof;}).masks.empty());checks++;
 auto foreign=rows;auto third=row;third["id"]=3;third["bbox"]=Box{310,470,340,550};foreign.push_back(third);assert(run(foreign,raw,[&](const json&){return proof;}).masks.empty());checks++;
 for(int member:{0,1})for(const char* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated"}){auto edited=rows;edited[member][flag]=true;assert(run(edited,raw,[&](const json&){return proof;}).masks.empty());checks++;}
 for(int member:{0,1})for(const char* field:{"bbox","detectorConfidence"}){auto edited=rows;if(std::string(field)=="bbox")edited[member][field][0]=edited[member][field][0].get<int>()+1;else edited[member][field]=.8;assert(run(edited,raw,[&](const json&){return proof;}).masks.empty());checks++;}
 for(const auto& agreement:{json::array({true,true,false,false}),json::array({false,true,true,true}),json::array({true,true,true}),json::array({1,true,true,true})}){auto bad=proof;bad["agreement"]=agreement;assert(!restoration_enclosure_reading_proof(bad)&&run(rows,raw,[&](const json&){return bad;}).masks.empty());checks++;}
 auto duplicate=found;auto stronger=raw;auto strongerRows=rows;found[1].score=1/(1+std::exp(.5f));strongerRows[1]["detectorConfidence"]=found[1].score;stronger.logits[6]=-.5f;assert(run(strongerRows,stronger,[&](const json&){return proof;}).masks.empty());checks++;found=duplicate;
 found[2].box[0]=307;assert(run(rows,raw,[&](const json&){return proof;}).masks.empty());checks++;found=duplicate;
 const std::string original="Source dialogue";int calls=0;const auto reading=restoration_enclosure_reading(original,[&](int scale,bool inverse){calls++;return scale==2&&!inverse?std::string("Other reading"):original;});assert(calls==4&&restoration_enclosure_reading_proof(reading));checks++;
 assert(restoration_enclosure_reading(original,[&](int scale,bool){return scale==1?original:std::string("Other reading");}).is_null());checks++;
 assert(restoration_enclosure_reading(original,[&](int scale,bool inverse){return scale==1&&!inverse?std::string("Other reading"):original;}).is_null());checks++;
 assert(restoration_enclosure_reading("x",[&](int,bool){assert(false);return std::string{};}).is_null());checks++;
 std::cout<<"PASS "<<checks<<" enclosure/effect ownership and original OCR vote controls\n";
}
