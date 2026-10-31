#include "../../../native/ocr_rotated_latin.hpp"
#include <cassert>
int main(){
 assert(rotated_latin::bounded("VGCALOTD","VOCALOID"));assert(!rotated_latin::bounded("VGCALOTD","VOCALOIDS"));assert(!rotated_latin::bounded("VGCALOTD","ABCALOID"));assert(!rotated_latin::bounded("VGCALOTD","VOCA123D"));
 PageImage image{1000,1000,std::vector<uint8_t>(3000000,255)};Box box{100,100,240,600};
 auto ink=[&](Box b){for(int y=b[1];y<b[3];y++)for(int x=b[0];x<b[2];x++)for(int c=0;c<3;c++)image.rgb[(y*1000+x)*3+c]=0;};
 ink({200,110,230,590});for(int y=110;y<590;y+=40)ink({100,y,130,y+28});
 Region source{0,0,.9f,box,std::vector<uint8_t>(192*192,1),192};json row={{"bbox",box},{"type","text"},{"detectorConfidence",source.score},{"text","これは試験です「VGCALOTD」"}};std::vector<Region> found{source};
 auto p=rotated_latin::plan(image,row,found);assert(p);
 auto read=[](const PageImage&,Box,int,bool){return std::string("VOCALOID");};auto good=rotated_latin::correction(image,row,found,read);assert(!good.is_null()&&good.at("text")=="これは試験です「VOCALOID」");
 int count=0;auto inconsistent=[&](const PageImage&,Box,int,bool){return ++count==2?std::string("VOCALOTD"):std::string("VOCALOID");};assert(rotated_latin::correction(image,row,found,inconsistent).is_null());
 count=0;auto noAnchor=[&](const PageImage&,Box,int,bool){return ++count<=4?std::string("VOCALOID"):std::string("VOCALOTD");};assert(rotated_latin::correction(image,row,found,noAnchor).is_null());
 auto r=row;r["text"]="これは試験です「VGCALOTD」追加";assert(!rotated_latin::plan(image,r,found));r=row;r["manual"]=true;assert(!rotated_latin::plan(image,r,found));assert(!rotated_latin::plan(image,row,{}));
 std::cout<<"PASS 11 rotated Latin checks\n";
}
