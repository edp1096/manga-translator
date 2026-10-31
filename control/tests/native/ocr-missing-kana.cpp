#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "../../../native/platform.hpp"
#include "../../../native/ocr_missing_kana.hpp"
#include <cassert>
int main(int argc,char**argv){
 const auto dir=argc>1?fs::u8path(argv[1]):fs::path("control/tests/native/fixtures");const auto fixture=read_json(dir/"missing-kana.json"),row=fixture.at("row"),raw=fixture.at("source");const auto crop=load_page(dir/"missing-kana.png");const int w=fixture.at("width"),h=fixture.at("height");const Box bounds=fixture.at("cropBox"),box=row.at("bbox");PageImage image{w,h,std::vector<uint8_t>(size_t(w)*h*3,255)};for(int y=0;y<crop.height;y++)std::copy_n(crop.rgb.data()+size_t(y)*crop.width*3,crop.width*3,image.rgb.data()+(size_t(y+bounds[1])*w+bounds[0])*3);
 Region source;source.cls=raw.at("class_id");source.box=raw.at("bbox");source.score=raw.at("score");source.query=raw.at("query");source.mask_side=raw.at("mask").at("width");source.mask.resize(size_t(source.mask_side)*source.mask_side);const auto runs=raw.at("mask").at("runs").get<std::vector<int>>();for(size_t i=0;i<runs.size();i+=2)std::fill_n(source.mask.begin()+runs[i],runs[i+1],1);
 size_t calls=0,tests=0;auto read=[&](Box b,int scale,bool inverse,int padding){calls++;for(const auto&r:fixture.at("reads"))if(r.at("bbox")==json(b)&&r.at("scale")==scale&&r.at("inverse")==inverse&&r.at("padding")==padding)return r.at("text").get<std::string>();return std::string{};};
 const auto original=image.rgb;const auto proof=missing_kana::correction(image,row,{source},read);assert(!proof.is_null()&&proof.at("text")==fixture.at("expected")&&proof.at("prior")==row.at("text")&&calls==16);tests++;
 assert(proof.at("sourceBox")==row.at("bbox")&&proof.at("sourceQuery")==202&&proof.at("glyphBoxes").size()==8&&proof.at("insertAt")==1);tests++;assert(image.rgb==original&&row==fixture.at("row"));tests++;
 auto no=[&](const PageImage& im,const json&r,const std::vector<Region>&ds){calls=0;assert(missing_kana::correction(im,r,ds,read).is_null());assert(calls==0);tests++;};
 for(const char* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){auto r=row;r[flag]=true;no(image,r,{source});}
 for(const char* type:{"effect","unknown"}){auto r=row;r["type"]=type;no(image,r,{source});}
 no(image,row,{});no(image,row,{source,source});
 for(int n=0;n<6;n++){auto s=source;if(n==0)s.cls=1;if(n==1)s.box[0]++;if(n==2)s.score=.1;if(n==3)s.mask_side=96;if(n==4)s.mask.clear();if(n==5)std::fill(s.mask.begin(),s.mask.end(),0);no(image,row,{s});}
 for(const std::string text:{"", "歯ァ食い縛りな。", "歯食い縛り", "Grind your teeth.", "歯歯歯歯歯歯歯歯歯歯歯歯歯歯歯歯歯"}){auto r=row;r["text"]=text;no(image,r,{source});}
 for(const Box b:std::vector<Box>{{-1,box[1],box[2],box[3]},{box[0],box[1],w+1,box[3]},{box[0],box[1],box[0],box[3]}}){auto r=row;r["bbox"]=b;no(image,r,{source});}
 {auto im=image;const Box extra=proof.at("addedGlyphBox");for(int y=extra[1];y<extra[3];y++)for(int x=extra[0];x<extra[2];x++)for(int c=0;c<3;c++)im.rgb[(size_t(y)*w+x)*3+c]=255;no(im,row,{source});}
 {auto im=image;im.rgb.resize(3);no(im,row,{source});}
 // A single inconsistent view, lost punctuation or changed anchor blocks correction.
 for(size_t pos=0;pos<16;pos++)for(const std::string wrong:{"", "イ", "歯ァ食い縛りな", "歯ア食い縛りな。"}){size_t n=0;auto altered=[&](Box b,int scale,bool inverse,int padding){auto v=read(b,scale,inverse,padding);return n++==pos?wrong:v;};assert(missing_kana::correction(image,row,{source},altered).is_null());tests++;}
 for(const std::pair<std::string,std::string> p:std::vector<std::pair<std::string,std::string>>{{"あいうえ","あきいうえ"},{"あいうえ","ぁあいうえ"},{"あいうえ","あいうえぁ"},{"あいうえ","あゃいおえ"},{"あいうえ","あっいうえ"},{"あいうえ","あィいうえ"}}){const auto found=missing_kana::insertion(codepoints(p.first),codepoints(p.second));assert(bool(found)==(p.second=="あっいうえ"||p.second=="あィいうえ"));tests++;}
 {size_t n=0;bool cancelled=false;try{missing_kana::correction(image,row,{source},[&](Box b,int scale,bool inverse,int padding){if(++n==4)throw std::runtime_error("cancelled");return read(b,scale,inverse,padding);});}catch(const std::runtime_error&e){cancelled=std::string(e.what())=="cancelled";}assert(cancelled&&n==4&&image.rgb==original);tests++;}
 assert(json::parse(proof.dump())==proof);tests++;std::cout<<"PASS physical missing small kana "<<tests<<" checks\n";
}
