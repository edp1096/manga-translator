#include <optional>
#include "../../../native/ocr_horizontal_reading.hpp"
#include <cassert>
int main(){int checks=0;PageImage image{1000,1000,std::vector<uint8_t>(1000*1000*3,255)};for(const Box b:std::vector<Box>{{70,45,280,55},{70,75,280,105},{70,135,280,160}})for(int y=b[1];y<b[3];y++)for(int x=b[0];x<b[2];x++)for(int c=0;c<3;c++)image.rgb[(y*image.width+x)*3+c]=0;
 Region source{0,0,.9f,{50,40,350,200},std::vector<uint8_t>(200*200,1),200};std::vector<Region> detected{source};json row={{"id",1},{"type","text"},{"mode","replace"},{"bbox",source.box},{"detectorConfidence",source.score},{"text","カナヨミ Widget MkII 【説明】"}};
 const auto p=horizontal_reading::plan(image,row,detected);assert(p);checks++;
 auto read=[&](Box b,int,bool){return b==p->annotation?std::string("カナヨミ"):std::string("Widget MkII 【説明】");};auto good=horizontal_reading::correction(image,row,detected,read);assert(!good.is_null()&&good.at("mainText")=="Widget MkII 【説明】"&&good.at("reading")=="カナヨミ");checks++;
 for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){auto r=row;r[flag]=true;assert(!horizontal_reading::plan(image,r,detected));checks++;}
 auto r=row;r["text"]="Small heading Widget MkII";assert(!horizontal_reading::plan(image,r,detected));checks++;r=row;r["text"]="説明 Widget MkII";assert(!horizontal_reading::plan(image,r,detected));checks++;
 r=row;r["detectorConfidence"]=.91;assert(!horizontal_reading::plan(image,r,detected));checks++;
 auto wrong=[&](Box b,int,bool){return b==p->annotation?std::string("カナヨミ"):std::string("Widget MkI 【説明】");};assert(horizontal_reading::correction(image,row,detected,wrong).is_null());checks++;
 auto one=[&](Box b,int scale,bool inverse){return b==p->annotation?std::string("カナヨミ"):std::string(scale==1&&inverse?"Widget MkI 【説明】":"Widget MkII 【説明】");};assert(!horizontal_reading::correction(image,row,detected,one).is_null());checks++;
 auto two=[&](Box b,int scale,bool){return b==p->annotation?std::string("カナヨミ"):std::string(scale==1?"Widget MkI 【説明】":"Widget MkII 【説明】");};assert(horizontal_reading::correction(image,row,detected,two).is_null());checks++;
 auto disagreement=[&](Box b,int scale,bool){return b==p->annotation?std::string(scale==1?"カナヨミ":"カナヨメ"):std::string("Widget MkII 【説明】");};assert(horizontal_reading::correction(image,row,detected,disagreement).is_null());checks++;
 auto loop=row;loop["text"]="かなよみかなよみかなよみかなよみよよ";
 auto lineRead=[&](Box b,int,bool){return b==p->annotation?std::string("かなよみ"):std::string("山川次郎(35) 会社員");};
 auto fixed=horizontal_reading::correction(image,loop,detected,lineRead);assert(!fixed.is_null()&&fixed.at("mainText")=="山川次郎(35) 会社員"&&fixed.at("recoveredPronunciationLoop")==true);checks++;
 auto noKanji=[&](Box b,int,bool){return b==p->annotation?std::string("かなよみ"):std::string("かなよみ");};assert(horizontal_reading::correction(image,loop,detected,noKanji).is_null());checks++;
 auto mismatch=[&](Box b,int scale,bool){return b==p->annotation?std::string("かなよみ"):std::string(scale==1?"山川次郎":"山川三郎");};assert(horizontal_reading::correction(image,loop,detected,mismatch).is_null());checks++;
 auto wrongRuby=[&](Box b,int,bool){return b==p->annotation?std::string("よみかた"):std::string("山川次郎");};assert(horizontal_reading::correction(image,loop,detected,wrongRuby).is_null());checks++;
 loop["text"]="かなよみなかなよみなかなよみな";assert(!horizontal_reading::correction(image,loop,detected,lineRead).is_null());checks++;
 loop["text"]="かなよみかなよみ";assert(!horizontal_reading::plan(image,loop,detected));checks++;
 std::cout<<"PASS "<<checks<<" horizontal reading checks\n";
}
