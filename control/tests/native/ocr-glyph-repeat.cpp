#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "../../../native/platform.hpp"
#include "../../../native/ocr_glyph_repeat.hpp"
#include <cassert>
int main(int argc,char**argv){const auto dir=argc>1?fs::u8path(argv[1]):fs::path("control/tests/native/fixtures");const auto fixture=read_json(dir/"glyph-repeat.json");const auto row=fixture.at("row");const auto crop=load_page(dir/"glyph-repeat.png");const int w=fixture.at("width"),h=fixture.at("height");const Box bounds=fixture.at("cropBox"),box=row.at("bbox");PageImage image{w,h,std::vector<uint8_t>(size_t(w)*h*3,255)};for(int y=0;y<crop.height;y++)std::copy_n(crop.rgb.data()+size_t(y)*crop.width*3,crop.width*3,image.rgb.data()+(size_t(y+bounds[1])*w+bounds[0])*3);const auto& hit=row.at("hitMask");const int side=hit.at("width");Region source{4,0,row.at("detectorConfidence"),box,{},side};source.mask.resize(size_t(side)*side);const auto runs=hit.at("runs").get<std::vector<int>>();for(size_t i=0;i+1<runs.size();i+=2)for(int n=0;n<runs[i+1];n++)source.mask.at(runs[i]+n)=1;
 size_t calls=0,tests=0;auto read=[&](Box b,int scale,bool inverse){calls++;for(const auto&r:fixture.at("reads"))if(r.at("bbox")==json(b)&&r.at("scale")==scale&&r.at("inverse")==inverse&&r.at("stopped")==true)return r.at("text").get<std::string>();return std::string{};};const auto original=image.rgb;const auto proof=glyph_repeat::correction(image,row,{source},read);if(proof.is_null())std::cerr<<"actualproof failed candidate="<<bool(glyph_repeat::plan(image,row,{source}))<<" calls="<<calls<<"\n";assert(!proof.is_null()&&proof.at("text")==fixture.at("expected")&&proof.at("prior")==row.at("text")&&calls==18);tests++;assert(proof.at("glyphBoxes").size()==3&&proof.at("addedGlyphs")==1&&proof.at("sourceBox")==row.at("bbox"));tests++;assert(image.rgb==original&&row==fixture.at("row"));tests++;
 auto no=[&](const PageImage& im,const json&r,const std::vector<Region>&ds){calls=0;assert(glyph_repeat::correction(im,r,ds,read).is_null());assert(calls==0);tests++;};
 for(const char* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){auto r=row;r[flag]=true;no(image,r,{source});}
 for(const char* type:{"effect","unknown"}){auto r=row;r["type"]=type;no(image,r,{source});}
 no(image,row,{});no(image,row,{source,source});for(int n=0;n<6;n++){auto s=source;if(n==0)s.cls=1;if(n==1)s.box[0]++;if(n==2)s.score=.1;if(n==3)s.mask_side=96;if(n==4)s.mask.clear();if(n==5)std::fill(s.mask.begin(),s.mask.end(),0);no(image,row,{s});}
 for(const std::string text:{"", "ッッ", "上等ッ!!", "上等ッッッ!!", "上等ッッッッ!!", "上等!!", "上等ッッ♥"}){auto r=row;r["text"]=text;no(image,r,{source});}
 for(const Box b:std::vector<Box>{{-1,box[1],box[2],box[3]},{box[0],box[1],w+1,box[3]},{box[0],box[1],box[0],box[3]}}){auto r=row;r["bbox"]=b;no(image,r,{source});}
 {auto im=image;const Box extra=proof.at("glyphBoxes").back();for(int y=extra[1];y<extra[3];y++)for(int x=extra[0];x<extra[2];x++)for(int c=0;c<3;c++)im.rgb[(size_t(y)*w+x)*3+c]=255;no(im,row,{source});}
 {auto s=source;for(size_t i=0;i<s.mask.size();i++){const double y=(i/side+.5)*h/side;if(y>415)s.mask[i]=0;}no(image,row,{s});}
 {auto im=image;im.rgb.resize(3);no(im,row,{source});}
 // Every independent OCR view is necessary; disagreement must retain the prior.
 for(size_t pos=0;pos<18;pos++)for(const std::string wrong:{"", "ア", "ッッ", "ツツツツ"}){size_t n=0;auto altered=[&](Box b,int scale,bool inverse){auto v=read(b,scale,inverse);return n++==pos?wrong:v;};assert(glyph_repeat::correction(image,row,{source},altered).is_null());tests++;}
 // Small/large identity normalization is confined to the full repeat strip.
 const auto first=proof.at("glyphBoxes").front().get<Box>(),last=proof.at("glyphBoxes").back().get<Box>();const Box strip{bounds[0],first[1],bounds[2],last[3]};{auto large=[&](Box b,int scale,bool inverse){return b==strip?std::string("ツツツ"):read(b,scale,inverse);};const auto p=glyph_repeat::correction(image,row,{source},large);assert(!p.is_null()&&p.at("text")==fixture.at("expected"));tests++;}
 {auto wrong=[&](Box b,int scale,bool inverse){return b==strip?std::string("ツシツ"):read(b,scale,inverse);};assert(glyph_repeat::correction(image,row,{source},wrong).is_null());tests++;}
 {size_t n=0;bool cancelled=false;try{glyph_repeat::correction(image,row,{source},[&](Box b,int scale,bool inverse){if(++n==4)throw std::runtime_error("cancelled");return read(b,scale,inverse);});}catch(const std::runtime_error&e){cancelled=std::string(e.what())=="cancelled";}assert(cancelled&&n==4&&image.rgb==original);tests++;}
 assert(json::parse(proof.dump())==proof);tests++;for(const auto pair:std::vector<std::pair<uint32_t,uint32_t>>{{U'ぁ',U'あ'},{U'ッ',U'ツ'},{U'ヵ',U'カ'},{U'り',U'り'}}){assert(glyph_repeat::family(pair.first)==pair.second);tests++;}
 for(const std::string text:std::vector<std::string>{"AA", "ッッ", "ABC", "!!", "上等ッ", "上等ッッッッッッ",std::string(300,'a')}){assert(!glyph_repeat::span(text));tests++;}
 std::cout<<"PASS physical glyph repeat "<<tests<<" checks\n";
}
