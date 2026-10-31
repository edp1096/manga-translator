#include "../../../native/ocr_punctuation.hpp"
#include <cassert>
int main(){PageImage image{480,640,std::vector<uint8_t>(480*640*3,255)};Box box{100,100,128,214};Region region{0,0,.55f,box,{},0};json row={{"id",1},{"type","text"},{"text","..."},{"bbox",box},{"detectorConfidence",.55}};
 auto black=[&](int x0,int y0,int x1,int y1){for(int y=y0;y<y1;y++)for(int x=x0;x<x1;x++)for(int c=0;c<3;c++)image.rgb[(y*480+x)*3+c]=0;};
 black(105,104,120,209);auto p=ocr_punctuation::proof(image,row,{region});assert(!p.is_null());size_t tests=1;
 auto tagged=row;tagged["punctuationMismatch"]=p;assert(ocr_punctuation::matches(tagged,480,640));tests++;
 for(const char* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){auto r=row;r[flag]=true;assert(ocr_punctuation::proof(image,r,{region}).is_null());tests++;}
 for(const std::string text:{"?","!","Hello",".","ー"}){auto r=row;r["text"]=text;assert(ocr_punctuation::proof(image,r,{region}).is_null());tests++;}
 assert(ocr_punctuation::proof(image,row,{}).is_null());assert(ocr_punctuation::proof(image,row,{region,region}).is_null());tests+=2;
 auto edited=tagged;edited["text"]="Corrected";assert(!ocr_punctuation::matches(edited,480,640));assert(!ocr_punctuation::matches(tagged,481,640));tests+=2;
 std::fill(image.rgb.begin(),image.rgb.end(),255);for(int y:{110,150,190})black(108,y,118,y+10);assert(ocr_punctuation::proof(image,row,{region}).is_null());tests++;
 // Even elongated isolated dots must not be confused with one continuous glyph.
 std::fill(image.rgb.begin(),image.rgb.end(),255);for(int y:{105,145,185})black(110,y,115,y+20);assert(ocr_punctuation::proof(image,row,{region}).is_null());tests++;
 std::fill(image.rgb.begin(),image.rgb.end(),255);black(105,70,120,240);assert(ocr_punctuation::proof(image,row,{region}).is_null());tests++;
 // A gray connection occurring at only one threshold is insufficient evidence.
 std::fill(image.rgb.begin(),image.rgb.end(),255);for(int y=104;y<209;y++)for(int x=105;x<120;x++)for(int c=0;c<3;c++)image.rgb[(y*480+x)*3+c]=150;assert(ocr_punctuation::proof(image,row,{region}).is_null());tests++;
 std::cout<<"PASS punctuation mismatch "<<tests<<" checks\n";
}
