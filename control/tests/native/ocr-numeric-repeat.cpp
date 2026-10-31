#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "../../../native/ocr_numeric_repeat.hpp"
#include <cassert>
int main(int argc,char**argv){
 const auto dir=argc>1?fs::u8path(argv[1]):fs::path("control/tests/native/fixtures");
 const auto image=load_page(dir/"numeric-repeat.png"),original=image;const auto fixture=read_json(dir/"numeric-repeat.json");
 const Box box{0,0,image.width,image.height};const std::string prior=fixture.at("text"),expected=fixture.at("expected");size_t calls=0,checks=0;
 auto read=[&](Box b,int scale,bool inverse){calls++;for(const auto&r:fixture.at("reads"))if(r.at("box").get<Box>()==b&&r.at("scale")==scale&&r.at("inverse")==inverse)return r.at("text").get<std::string>();return std::string{};};
 auto corrected=numeric_repeat::correction(image,box,prior,read);assert(!corrected.is_null()&&corrected.at("text")==expected&&corrected.at("proofs").size()==1&&corrected.at("proofs")[0].at("span")==2);checks++;
 assert(numeric_repeat::correction(image,box,expected,read).is_null());checks++;
 calls=0;for(const auto&text:{std::string("ああああああああああああああ"),std::string("1000円です"),std::string("123,45,67")}){assert(numeric_repeat::correction(image,box,text,read).is_null());checks++;}assert(calls==0);checks++;
 auto fullwidth=[](const std::string&s){std::string out;for(unsigned char c:s){if(c>='0'&&c<='9'){out+='\xef';out+='\xbc';out+=char(0x90+c-'0');}else out+=char(c);}return out;};
 auto wide=numeric_repeat::correction(image,box,fullwidth(prior),[&](Box b,int n,bool inv){return fullwidth(read(b,n,inv));});assert(!wide.is_null()&&wide.at("text")==fullwidth(expected));checks++;
 for(int mode=0;mode<4;mode++){auto proof=numeric_repeat::correction(image,box,prior,[&](Box b,int scale,bool inv){auto s=read(b,scale,inv);if((mode==0&&inv)||(mode==1&&scale==2))return std::string{};if(mode==2&&b[0]==50&&b[1]==0)return std::string("9000円か。");if(mode==3&&b[1]>0)return std::string("か。");return s;});assert(proof.is_null());checks++;}
 auto unitPrior=prior;unitPrior.replace(unitPrior.find("1000円か"),std::string("1000円か").size(),"1000O円か");
 auto ambiguous=numeric_repeat::correction(image,box,unitPrior,[&](Box b,int n,bool inv){auto text=read(b,n,inv);if(b[1]==0&&b[0]==50){auto at=text.find("円か");if(at!=std::string::npos)text.insert(at,"O");}return text;});assert(ambiguous.is_null());checks++;
 auto paint=[](PageImage& im,Box b,uint8_t value){for(int y=b[1];y<b[3];y++)for(int x=b[0];x<b[2];x++)for(int c=0;c<3;c++)im.rgb[(size_t(y)*im.width+x)*3+c]=value;};
 // Fade only the additional zero: disagreement between thresholds must reject.
 auto faded=image;for(int y=91;y<107;y++)for(int x=59;x<71;x++)for(int c=0;c<3;c++){auto&v=faded.rgb[(size_t(y)*image.width+x)*3+c];if(v<128)v=110;}
 assert(numeric_repeat::correction(faded,box,prior,read).is_null());checks++;
 auto solid=image;paint(solid,{59,91,71,107},0);assert(numeric_repeat::correction(solid,box,prior,read).is_null());checks++;
 auto dust=image;paint(dust,{61,0,63,2},0);assert(numeric_repeat::correction(dust,box,prior,read).is_null());checks++;
 // A second extra glyph is outside this bounded, independently verified repair.
 auto two=image;paint(two,{50,112,80,132},255);for(int y=0;y<16;y++)for(int x=0;x<12;x++)for(int c=0;c<3;c++)two.rgb[(size_t(112+y)*image.width+59+x)*3+c]=image.rgb[(size_t(91+y)*image.width+59+x)*3+c];
 assert(numeric_repeat::correction(two,box,prior,read).is_null());checks++;
 for(const Box b:std::vector<Box>{{-1,0,134,161},{0,0,135,161},{0,0,134,162},{0,0,0,0}}){assert(numeric_repeat::correction(image,b,prior,read).is_null());checks++;}
 assert(image.rgb==original.rgb);checks++;
 // No dictionary, target language or fixed amount participates in the proof.
 auto changedPrior=prior;changedPrior.replace(changedPrior.find("5000"),4,"7000");
 auto other=numeric_repeat::correction(image,box,changedPrior,[&](Box b,int n,bool inv){auto text=read(b,n,inv);auto at=text.find("5000");if(at!=std::string::npos)text.replace(at,4,"7000");return text;});auto otherExpected=expected;otherExpected.replace(otherExpected.find("5000"),4,"7000");assert(!other.is_null()&&other.at("text")==otherExpected);checks++;
 std::cout<<"PASS numeric repeated glyph correction "<<checks<<" checks\n";
}
