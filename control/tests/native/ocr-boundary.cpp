#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "ocr_boundary.hpp"
int main(){
 PageImage image{960,960,std::vector<uint8_t>(960*960*3,255)};
 auto paint=[&](PageImage& im,Box b){for(int y=b[1];y<b[3];y++)for(int x=b[0];x<b[2];x++)for(int c=0;c<3;c++)im.rgb[(size_t(y)*im.width+x)*3+c]=0;};
 paint(image,{0,420,960,422});paint(image,{0,425,960,427});
 Region source{1,1,.5f,{200,400,400,450},{},192};source.mask.resize(192*192);for(int x=40;x<80;x++)source.mask[83*192+x]=1;
 Region balloon{2,2,.9f,{190,350,430,430},{},192};balloon.mask.resize(192*192);balloon.mask[83*192+40]=balloon.mask[83*192+41]=1;
 std::vector<Region> regions{source,balloon};json row={{"id",1},{"type","effect"},{"mode","tooltip"},{"text","..."},{"bbox",source.box},{"detectorConfidence",.5}};
 size_t checks=0;auto expect=[&](bool condition,const char* label){require(condition,label);checks++;};
 expect(!ocr_boundary::proof(image,row,regions).is_null(),"thin external border positive");
 for(const char* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){auto r=row;r[flag]=true;expect(ocr_boundary::proof(image,r,regions).is_null(),flag);}
 for(const char* text:{"?","!","スーッ","一",". ","...文字"}){auto r=row;r["text"]=text;expect(ocr_boundary::proof(image,r,regions).is_null(),"non-ellipsis reading retained");}
 for(const char* text:{"…","・・・","．．．","⋯"})expect(ocr_boundary::dots_only(text),"Unicode ellipsis");
 auto r=row;r["textVerification"]={{"version",1}};expect(ocr_boundary::proof(image,r,regions).is_null(),"verified text");
 r=row;r["detectorConfidence"]=.55;expect(ocr_boundary::proof(image,r,regions).is_null(),"stale confidence");
 auto ds=regions;ds.push_back(source);expect(ocr_boundary::proof(image,row,ds).is_null(),"ambiguous detector source");
 ds=regions;ds[0].mask.clear();expect(ocr_boundary::proof(image,row,ds).is_null(),"missing mask");
 ds=regions;ds[1].score=.7;expect(ocr_boundary::proof(image,row,ds).is_null(),"weak balloon");
 ds=regions;ds[1].mask=source.mask;expect(ocr_boundary::proof(image,row,ds).is_null(),"inside balloon text");
 ds=regions;std::fill(ds[1].mask.begin(),ds[1].mask.end(),0);expect(ocr_boundary::proof(image,row,ds).is_null(),"bbox overlap without mask contact");
 auto dots=image;std::fill(dots.rgb.begin(),dots.rgb.end(),255);for(int x:{230,280,330})paint(dots,{x,420,x+5,425});expect(ocr_boundary::proof(dots,row,regions).is_null(),"isolated real dots");
 auto joined=image;paint(joined,{280,405,295,430});expect(ocr_boundary::proof(joined,row,regions).is_null(),"thick glyph joined to border");
 auto mixed=image;paint(mixed,{280,435,287,442});expect(ocr_boundary::proof(mixed,row,regions).is_null(),"separate glyph beside border");
 auto black=image;std::fill(black.rgb.begin(),black.rgb.end(),0);expect(ocr_boundary::proof(black,row,regions).is_null(),"dark background");
 const auto before=row.dump();ocr_boundary::proof(image,row,regions);expect(row.dump()==before,"preserve original OCR record");
 std::cout<<"PASS boundary evidence "<<checks<<" cases\n";
}
