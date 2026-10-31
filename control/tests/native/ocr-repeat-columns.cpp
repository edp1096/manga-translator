#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "../../../native/ocr_repeat_columns.hpp"
#include <cassert>

int main(int argc,char** argv){
 const auto dir=argc>1?fs::u8path(argv[1]):fs::path("control/tests/native/fixtures");const auto fixture=read_json(dir/"repeat-columns.json"),row=fixture.at("row");const auto crop=load_page(dir/"repeat-columns.png");const int w=fixture.at("width"),h=fixture.at("height");const Box b=row.at("bbox");
 PageImage image{w,h,std::vector<uint8_t>(size_t(w)*h*3,255)};for(int y=0;y<crop.height;y++)std::copy_n(crop.rgb.data()+size_t(y)*crop.width*3,crop.width*3,image.rgb.data()+(size_t(y+b[1])*w+b[0])*3);
 const auto& hit=row.at("hitMask");Region source{3,0,row.at("detectorConfidence"),b,{},hit.at("width")};source.mask.resize(size_t(source.mask_side)*source.mask_side);const auto& runs=hit.at("runs");for(size_t i=0;i<runs.size();i+=2)for(size_t p=runs[i].get<size_t>();p<runs[i].get<size_t>()+runs[i+1].get<size_t>();p++)source.mask.at(p)=1;
 size_t calls=0,tests=0;auto read=[&](Box box,int scale,bool inverse){calls++;for(const auto& r:fixture.at("reads"))if(r.at("box")==json(box)&&r.at("scale")==scale&&r.at("inverse")==inverse)return r.at("text").get<std::string>();return std::string{};};
 const auto before=image.rgb;const auto proof=repeat_columns::correction(image,row,{source},read);
 if(proof.is_null())std::cerr<<"Actual source failed: columns="<<repeat_columns::physical_columns(image,b,row.at("text")).boxes.size()<<" maskOwned="<<repeat_columns::glyphs_owned(image,repeat_columns::physical_columns(image,b,row.at("text")),source)<<" calls="<<calls<<"\n";
 assert(!proof.is_null()&&proof.at("text")==fixture.at("expected")&&proof.at("prior")==row.at("text")&&proof.at("columns").size()==2&&proof.at("sourceBox")==row.at("bbox")&&proof.at("sourceConfidence")==row.at("detectorConfidence")&&calls==8);tests++;
 assert(proof.at("columns")[0].at("readings")[0].at("text")=="うん..."&&proof.at("columns")[1].at("readings")[0].at("text")=="うん、");tests++;
 assert(image.rgb==before);tests++;
 auto no=[&](const PageImage& im,const json& r,const std::vector<Region>& ds){calls=0;assert(repeat_columns::correction(im,r,ds,read).is_null());assert(calls==0);tests++;};
 for(const char* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){auto r=row;r[flag]=true;no(image,r,{source});}
 for(const auto type:{"effect","unknown"}){auto r=row;r["type"]=type;no(image,r,{source});}
 for(const auto text:{"", "!", "う", "abcdefgh"}){auto r=row;r["text"]=text;no(image,r,{source});}
 no(image,row,{});no(image,row,{source,source});
 for(int change=0;change<6;change++){auto s=source;if(change==0)s.cls=1;if(change==1)s.box[0]++;if(change==2)s.score=.5f;if(change==3)s.mask_side=96;if(change==4)s.mask.clear();if(change==5)std::fill(s.mask.begin(),s.mask.end(),0);no(image,row,{s});}
 for(const Box box:std::vector<Box>{{-1,b[1],b[2],b[3]},{b[0],b[1],w+1,b[3]},{b[0],b[1],b[2],h+1},{b[0],b[1],b[0],b[3]}}){auto r=row;r["bbox"]=box;no(image,r,{source});}
 {auto r=row;r["bbox"][0]=r["bbox"][0].get<int>()+1;no(image,r,{source});}
 for(const double score:{.19,1.01,std::numeric_limits<double>::quiet_NaN()}){auto r=row;r["detectorConfidence"]=score;no(image,r,{source});}
 // Missing support for either column cannot be supplied by the other column.
 for(bool left:{false,true}){auto s=source;for(size_t p=0;p<s.mask.size();p++){const double x=(p%s.mask_side+.5)*w/s.mask_side;if((x<174)==left)s.mask[p]=0;}no(image,row,{s});}
 {auto im=image;for(int y=b[1];y<b[3];y++)for(int x=b[0];x<174;x++)for(int c=0;c<3;c++)im.rgb[(size_t(y)*w+x)*3+c]=255;no(im,row,{source});}
 // Filling the physical gap must not allow an arbitrary split through a glyph.
 {auto im=image;for(int y=b[1];y<b[3];y++)for(int x=168;x<184;x++)for(int c=0;c<3;c++)im.rgb[(size_t(y)*w+x)*3+c]=0;no(im,row,{source});}
 // A faint stroke across the gap disappears only at some thresholds.
 {auto im=image;for(int x=168;x<184;x++)for(int c=0;c<3;c++)im.rgb[(size_t(950)*w+x)*3+c]=150;no(im,row,{source});}
 // A narrower annotation beside the main column is not another utterance.
 {auto im=image;for(int y=b[1];y<b[3];y++)for(int x=b[0];x<174;x++)for(int c=0;c<3;c++)im.rgb[(size_t(y)*w+x)*3+c]=255;for(int y=b[1];y<b[3];y++)for(int x=0;x<6;x++)for(int c=0;c<3;c++)im.rgb[(size_t(y)*w+b[0]+x)*3+c]=image.rgb[(size_t(y)*w+b[0]+x*3)*3+c];no(im,row,{source});}
 auto r=row;r["text"]=fixture.at("expected");assert(repeat_columns::correction(image,r,{source},read).is_null());tests++;
 for(size_t position=0;position<8;position++)for(const std::string value:{"", "はい", "うん...うん、", "うん"}){
  size_t at=0;auto altered=[&](Box box,int scale,bool inverse){const auto text=read(box,scale,inverse);return at++==position?value:text;};assert(repeat_columns::correction(image,row,{source},altered).is_null());tests++;
 }
 // Four views changing one comma to an ellipsis still cannot use a different
 // entire-string anchor. Do not invent punctuation from the old parent crop.
 {auto r=row;r["text"]="うん!";assert(repeat_columns::correction(image,r,{source},read).is_null());tests++;}
 // Equivalent white glyphs on black paper use the same physical columns.
 {auto im=image;for(auto& p:im.rgb)p=255-p;const auto p=repeat_columns::correction(im,row,{source},read);assert(!p.is_null()&&p.at("text")==fixture.at("expected")&&p.at("foreground")=="light");tests++;}
 // Validate stable source-bound evidence survives ordinary JSON serialization.
 const auto decoded=json::parse(proof.dump());assert(decoded==proof);tests++;
 {size_t n=0;bool cancelled=false;try{repeat_columns::correction(image,row,{source},[&](Box box,int scale,bool inverse){if(++n==3)throw std::runtime_error("cancelled");return read(box,scale,inverse);});}catch(const std::runtime_error& e){cancelled=std::string(e.what())=="cancelled";}assert(cancelled&&n==3&&image.rgb==before&&row==fixture.at("row"));tests++;}
 std::cout<<"PASS physical repeated columns "<<tests<<" checks\n";
}
