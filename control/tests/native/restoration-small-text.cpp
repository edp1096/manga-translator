#include "../../../native/restoration_small_text.hpp"
#include <cassert>
int main(){size_t checks=0;PageImage image{200,400,std::vector<uint8_t>(200*400*3,255)};auto ink=[&](int x,int y){for(int c=0;c<3;c++)image.rgb[(size_t(y)*200+x)*3+c]=0;};for(int x:{86,96,106,114})for(int dx=0;dx<3;dx++)for(int y=105;y<113;y++)ink(x+dx,y);for(int x=75;x<80;x++)for(int y=80;y<95;y++)ink(x,y);
 Region source{0,0,.4f,{80,100,120,120},std::vector<uint8_t>(200*200),200},effect{1,1,.25f,{70,70,95,120},std::vector<uint8_t>(200*200),200};for(int y=50;y<60;y++)for(int x=80;x<120;x++)source.mask[y*200+x]=1;for(int y=35;y<60;y++)for(int x=70;x<95;x++)effect.mask[y*200+x]=1;LayoutRaw raw;raw.mask_side=200;for(const auto& r:{source,effect}){std::vector<float> logits(5,-10);logits[r.cls]=std::log(r.score/(1-r.score));raw.logits.insert(raw.logits.end(),logits.begin(),logits.end());for(auto v:r.mask)raw.masks.push_back(v?1:-1);}std::vector<Region> found{source,effect};
 json row={{"id",1},{"type","text"},{"mode","tooltip"},{"bbox",source.box},{"box",source.box},{"detectorConfidence",source.score},{"text","(ABCD)"},{"translation","translated"}},other={{"id",2},{"type","effect"},{"mode","tooltip"},{"bbox",effect.box},{"box",effect.box},{"detectorConfidence",effect.score},{"text","AB"},{"translation","partial"}};json rows=json::array({row,other});PageImage cleaned=image;auto read=[](const PageImage&,Box,int,bool){return std::string("(ABCD)");};auto verify=[](const PageImage&,Box,int,bool){return std::string("ABCD");};auto run=[&](){return restoration_small_text(image,cleaned,found,rows,raw,[]{},read,verify);};
 rows[0]["textVerification"]={{"version",1},{"method","ocr-consensus"},{"role","DIALOGUE"},{"sources",json::array({source.box})}};
 auto verified=run();assert(verified.masks.size()==1&&verified.evidence["1"].at("sourceVerification")==rows[0].at("textVerification"));checks++;
 rows[0]["textVerification"]["sources"].push_back(Box{1,1,2,2});assert(run().masks.empty());checks++;
 rows[0]["textVerification"]["method"]="forged";assert(run().masks.empty());checks++;
 rows[0]=row;
 for(float score:{.24f,.28f,.72f}){auto trial=found;trial[0].score=score;auto trialRows=rows;trialRows[0]["detectorConfidence"]=score;auto trialRaw=raw;trialRaw.logits[0]=std::log(score/(1-score));auto check=restoration_small_text(image,cleaned,trial,trialRows,trialRaw,[]{},read,verify);assert(check.masks.size()==(score>=.25f?1:0));checks++;}
 // OCR-reclassified single effect source and a broad, truncated effect
 // neighbor: protect actual neighboring mask pixels, never its empty box.
 {auto typed=row;typed["textVerification"]={{"version",1},{"method","ocr-consensus"},{"role","LABEL"},{"sources",json::array({source.box})}};
  auto neighbor=effect;neighbor.box={70,70,130,130};neighbor.score=.48f;std::fill(neighbor.mask.begin(),neighbor.mask.end(),0);for(int y=35;y<65;y++)for(int x=70;x<80;x++)neighbor.mask[y*200+x]=1;
  auto neighborRow=other;neighborRow["bbox"]=neighbor.box;neighborRow["box"]=neighbor.box;neighborRow["detectorConfidence"]=neighbor.score;neighborRow["ocrTruncated"]=true;
  auto original=source;original.cls=1;LayoutRaw complete;complete.mask_side=200;complete.logits.assign(1500,-30);complete.boxes.assign(1200,0);complete.masks.assign(300*200*200,-1);
  for(const auto& r:{original,neighbor}){complete.logits[r.query*5+r.cls]=std::log(r.score/(1-r.score));const auto b=r.box;complete.boxes[r.query*4]=(b[0]+b[2]-.5f)/2/image.width;complete.boxes[r.query*4+1]=(b[1]+b[3]-.5f)/2/image.height;complete.boxes[r.query*4+2]=(b[2]-b[0]-1.f)/image.width;complete.boxes[r.query*4+3]=(b[3]-b[1]-1.f)/image.height;for(size_t i=0;i<r.mask.size();i++)complete.masks[size_t(r.query)*r.mask.size()+i]=r.mask[i]?1:-1;}
  auto cases=json::array({typed,neighborRow});std::vector<Region> guards{source,neighbor};auto success=restoration_small_text(image,cleaned,guards,cases,complete,[]{},read,verify);assert(success.masks.size()==1&&success.evidence["1"]["originalSourceClass"]==1&&success.evidence["1"]["effects"].at(0)["verifiedLabelOverlap"]==true);checks++;
  cases[0].erase("textVerification");assert(restoration_small_text(image,cleaned,guards,cases,complete,[]{},read,verify).masks.empty());checks++;
  cases[0]=typed;cases[1]["manual"]=true;assert(restoration_small_text(image,cleaned,guards,cases,complete,[]{},read,verify).masks.empty());checks++;
  cases[1]=neighborRow;std::fill(guards[1].mask.begin(),guards[1].mask.end(),0);for(int y=52;y<57;y++)for(int x=86;x<117;x++)guards[1].mask[y*200+x]=1;for(size_t i=0;i<guards[1].mask.size();i++)complete.masks[40000+i]=guards[1].mask[i]?1:-1;assert(restoration_small_text(image,cleaned,guards,cases,complete,[]{},read,verify).masks.empty());checks++;
 }
 auto good=run();assert(good.masks.size()==1);checks++;const auto& mask=good.masks.at(1);for(int y=80;y<95;y++)for(int x=75;x<80;x++)if(x>=mask.bounds[0]&&y>=mask.bounds[1]&&x<mask.bounds[2]&&y<mask.bounds[3])assert(!mask.pixels[(y-mask.bounds[1])*(mask.bounds[2]-mask.bounds[0])+x-mask.bounds[0]]);checks++;
 assert(good.evidence["1"]["effects"].size()==1&&good.evidence["1"]["effects"][0]["claimedFraction"].get<double>()<=.5);checks++;
 for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){rows[0][flag]=true;assert(run().masks.empty());rows[0].erase(flag);checks++;}
 rows[0]["detectorConfidence"]=.34;assert(run().masks.empty());rows[0]=row;checks++;
 rows[1]["text"]="ZZ";assert(run().masks.empty());rows[1]=other;checks++;
 rows[1]["manual"]=true;assert(run().masks.empty());rows[1]=other;checks++;
 found[1].mask[0]=1;assert(run().masks.empty());found[1]=effect;checks++;
 auto wrong=[](const PageImage&,Box,int,bool){return std::string("WRONG");};assert(restoration_small_text(image,cleaned,found,rows,raw,[]{},wrong,verify).masks.empty());checks++;assert(restoration_small_text(image,cleaned,found,rows,raw,[]{},read,wrong).masks.empty());checks++;
 auto scaled=[](const PageImage&,Box,int scale,bool){return std::string(scale==1?"WRONG":"ABCD");};auto retry=restoration_small_text(image,cleaned,found,rows,raw,[]{},read,scaled);assert(retry.masks.size()==1&&retry.evidence["1"].contains("verifierCrop"));checks++;
 rows[0]["mode"]="replace";assert(run().masks.size()==1);checks++;std::fill(cleaned.rgb.begin(),cleaned.rgb.end(),255);assert(run().masks.empty());checks++;
 assert(small_text_body("（ABCD）")==small_text_body("ABCD"));checks++;assert(small_text_body("神技！！")==small_text_body("神技!!"));checks++;
 rows=json::array({row,other});rows[1]["text"]="♪";auto symbol=run();assert(symbol.masks.size()==1&&!symbol.evidence["1"]["effects"][0]["duplicateText"].get<bool>());checks++;
 auto fringeImage=image;for(int y=110;y<122;y++)ink(87,y);auto fringe=run();assert(fringe.masks.size()==1);assert(fringe.evidence["1"]["components"][0]["coreSourceFraction"].get<double>()>=.98);checks++;image=fringeImage;
 auto saved=image;for(int x=75;x<80;x++)for(int y=80;y<95;y++)for(int c=0;c<3;c++)image.rgb[(y*200+x)*3+c]=255;assert(run().masks.empty());image=saved;checks++;
 auto terminal=row;terminal["text"]="ABCDー";auto terminalRows=json::array({terminal});std::vector<Region> onlySource{source};auto letters=[](const PageImage&,Box,int,bool){return std::string("ABCD");};
 for(int x=118;x<146;x++)ink(x,110);auto retained=restoration_small_text(image,cleaned,onlySource,terminalRows,raw,[]{},letters,letters);assert(retained.masks.size()==1&&retained.evidence["1"].contains("terminalStroke"));checks++;
 const auto& keep=retained.masks.at(1);for(int x=118;x<146;x++)if(x<keep.bounds[2])assert(!keep.pixels[(110-keep.bounds[1])*(keep.bounds[2]-keep.bounds[0])+x-keep.bounds[0]]);checks++;
 image=saved;for(int x=118;x<125;x++)ink(x,110);assert(restoration_small_text(image,cleaned,onlySource,terminalRows,raw,[]{},letters,letters).masks.empty());checks++;
 // A separate border can have most of its pixels inside the source box.
 // Keep the entire edge-connected stroke; only complete independent readings
 // of the remaining glyphs can authorize their removal.
 image=saved;rows=json::array({row});for(int y=102;y<148;y++)ink(119,y);auto border=restoration_small_text(image,cleaned,onlySource,rows,raw,[]{},read,verify);assert(border.masks.size()==1);checks++;
 const auto& borderMask=border.masks.at(1);for(int y=102;y<std::min(148,borderMask.bounds[3]);y++)assert(!borderMask.pixels[(y-borderMask.bounds[1])*(borderMask.bounds[2]-borderMask.bounds[0])+119-borderMask.bounds[0]]);checks++;
 auto missing=[&](const PageImage& p,Box,int,bool){return p.width==image.width?std::string("(ABCD)"):std::string("(ABC)");};assert(restoration_small_text(image,cleaned,onlySource,rows,raw,[]{},missing,verify).masks.empty());checks++;
 auto readings=[](const std::string& t){return json::array({t,t,t,t});};const auto expectedLetters=ocr_characters("abcdefghij",false);
 assert(!small_text_paired_reading(readings("abCdefghij"),readings("abCdefghij"),expectedLetters).is_null());checks++;
 assert(!small_text_paired_reading(readings("abCdefgHij"),readings("abCdefgHij"),expectedLetters).is_null());checks++;
 for(const auto& bad:{std::string("abCdeFgHij"),std::string("abcdefgh"),std::string("ab!defghij"),std::string("WRONGxxxxx")}){assert(small_text_paired_reading(readings(bad),readings(bad),expectedLetters).is_null());checks++;}
 assert(small_text_paired_reading(readings("abCdefghij"),readings("abcdefghij"),expectedLetters).is_null());checks++;
 auto variant=readings("abCdefghij");variant[3]="abDdefghij";assert(small_text_paired_reading(readings("abCdefghij"),variant,expectedLetters).at("method")=="bounded-secondary-readings");checks++;
 auto paired=readings("ABCD");paired[3]="ABED";assert(small_text_paired_reading(paired,paired,ocr_characters("ABCD",false)).at("method")=="majority-secondary-readings");checks++;
 paired[2]="ABED";assert(small_text_paired_reading(paired,paired,ocr_characters("ABCD",false)).is_null());checks++;
 auto brackets=readings("(ABCD)");brackets[3]="ABCD】";assert(!small_text_primary_brackets(brackets,readings("(ABCD)"),"(ABCD)").is_null());checks++;
 brackets[2]="ABCD】";assert(small_text_primary_brackets(brackets,readings("(ABCD)"),"(ABCD)").is_null());checks++;
 auto punct=readings("ABCD!");punct[3]="ABCD!!";assert(!small_text_primary_terminal(punct,readings("ABCD!"),"ABCD!").is_null());checks++;
 punct[2]="ABCD!!";assert(small_text_primary_terminal(punct,readings("ABCD!"),"ABCD!").is_null());checks++;
 auto wrappers=json::array({"(ABCD)","ABCD】","ABCD】","【ABCD】"});assert(!small_text_wrapper_consensus(wrappers,readings("ABCD)"),"(ABCD)").is_null());checks++;
 wrappers[0]="ABCD】";assert(small_text_wrapper_consensus(wrappers,readings("ABCD)"),"(ABCD)").is_null());checks++;
 wrappers[0]="(ABCD)";wrappers[1]="ABC】";assert(small_text_wrapper_consensus(wrappers,readings("ABCD)"),"(ABCD)").is_null());checks++;
 // Paired segmentation is preservation evidence, not a replacement source.
 auto segmented=json::array({"ン充電仅","充電仅","充電仅","充電仅"});auto originalLabel=ocr_characters("充電イス",false);
 assert(small_text_paired_segmentation(segmented,segmented,originalLabel).at("position")==2);checks++;
 auto mismatched=segmented;mismatched[0]="充電仅";assert(small_text_paired_segmentation(segmented,mismatched,originalLabel).is_null());checks++;
 for(const auto& bad:std::vector<json>{readings("充電イ"),readings("充電"),readings("充電!"),json::array({"ン充電仅","ン充電仅","充電仅","充電仅"}),readings("借電仅")}){assert(small_text_paired_segmentation(bad,bad,originalLabel).is_null());checks++;}
 auto lettersMerged=readings("abXef");assert(!small_text_paired_segmentation(lettersMerged,lettersMerged,ocr_characters("abcdef",false)).is_null());checks++;
 assert(small_text_terminal_punctuation(readings("physical"),readings("physical"),ocr_characters("physical,",false)));checks++;
 for(const auto& bad:std::vector<std::string>{"physical!","physical?","physica,","physicall,","abc,"}){assert(!small_text_terminal_punctuation(readings("physical"),readings("physical"),ocr_characters(bad,false)));checks++;}
 auto missingComma=readings("physical");missingComma[0]="physical,";assert(!small_text_terminal_punctuation(missingComma,readings("physical"),ocr_characters("physical,",false)));checks++;
 auto frameOriginal=json::array({"この施設には","......この施設だ","この施設には","この施設には"});auto frameIsolated=readings("......この施設には");const auto frameExpected=ocr_characters("この施設には",false);
 assert(small_text_ellipsis_consensus(frameOriginal,frameIsolated,frameExpected));checks++;
 frameOriginal[0]="この施設だ";assert(!small_text_ellipsis_consensus(frameOriginal,frameIsolated,frameExpected));checks++;
 frameOriginal[0]="この施設には";frameIsolated[0]="この施設だ";assert(!small_text_ellipsis_consensus(frameOriginal,frameIsolated,frameExpected));checks++;
 assert(!small_text_ellipsis_consensus(readings("この施設だ"),readings("......この施設だ"),frameExpected));checks++;
 std::cout<<"PASS "<<checks<<" small text guards\n";
}
