#pragma once
#include "restoration_mask.hpp"
#include "ocr_long_paragraph.hpp"

// A recovered long paragraph has stronger source evidence than a single OCR
// crop. Revalidate its physical columns against the original image before
// reconstructing foreground in the paragraph. This does not authorize other
// low-confidence detections or whole rectangular white fills.
inline bool restoration_paragraph_source(const PageImage& image,const Region& source,const json& row){
 try{
  if(row.value("mode",std::string{})!="tooltip"||row.value("translation",std::string{}).empty()||!row.contains("paragraphCorrection"))return false;
  if(!repeat_columns::eligible(row,image)||row.value("detectorConfidence",0.)<.5||source.box!=row.at("bbox").get<Box>()||std::abs(source.score-row.at("detectorConfidence").get<double>())>.0001)return false;
  const auto& p=row.at("paragraphCorrection");if(p.value("version",0)!=1||p.value("method",std::string{})!="physical-vertical-paragraph-columns"||p.at("text")!=row.at("text")||p.at("sourceBox")!=row.at("bbox")||p.at("sourceConfidence")!=row.at("detectorConfidence"))return false;
  auto prior=row;prior["text"]=p.at("prior");prior["ocrTruncated"]=true;const auto columns=long_paragraph::columns(image,prior,{source});
  if(columns.empty()||p.at("columns").size()!=columns.size())return false;
  std::string joined;
  for(size_t i=0;i<columns.size();i++){const auto& c=p.at("columns")[i];if(c.at("bbox")!=json(columns[i])||!c.at("readings").is_array()||c.at("readings").size()!=3)return false;const std::string first=c.at("readings")[0];const auto expected=ocr_characters(first,false);if(expected.size()<4||expected.size()>100)return false;for(const auto& reading:c.at("readings"))if(ocr_characters(reading.get<std::string>(),false)!=expected)return false;joined+=first;}
  return joined==row.at("text").get<std::string>();
 }catch(const std::exception&){return false;}
}
struct ParagraphRestoration {RestorationMask mask;json proof;};
inline ParagraphRestoration restoration_paragraph(const PageImage& image,const Region& source,const json& row,const std::vector<Region>& detected,const json& rows){
 ParagraphRestoration out;auto reject=[&](const char* reason){out.mask.reason=reason;return out;};
 if(!restoration_paragraph_source(image,source,row))return reject("paragraph-source");
 const Box b=source.box;const int chars=int(ocr_characters(row.at("text")).size());
 const double scale=std::min(image.width,image.height)/720.,character=std::clamp(std::sqrt(double(area(b))/std::max(1,chars)),8*scale,48*scale);
 const int fringe=std::max(2,int(std::ceil(character*.25))),margin=std::max(1,int(std::ceil(1.5*scale)));
 const Box bounds=expand_box(b,fringe+margin,image.width,image.height);const int w=bounds[2]-bounds[0],h=bounds[3]-bounds[1];
 std::vector<uint8_t> ink(size_t(w)*h),seen(ink.size());size_t paper=0;
 auto gray=[&](int x,int y){const auto* p=image.rgb.data()+(size_t(y)*image.width+x)*3;return std::min({p[0],p[1],p[2]});};
 for(int y=b[1];y<b[3];y++)for(int x=b[0];x<b[2];x++){paper+=gray(x,y)>=224;if(gray(x,y)<224)ink[size_t(y-bounds[1])*w+x-bounds[0]]=1;}
 if(paper<area(b)*.65)return reject("paragraph-complex-background");
 // Include complete small marks in the narrow annotation fringe. Large frame
 // and drawing components outside the original source remain untouched.
 for(int start=0;start<w*h;start++){
  if(seen[start]||gray(start%w+bounds[0],start/w+bounds[1])>=224)continue;
  std::vector<int> q{start};seen[start]=1;Box box{w,h,0,0};bool edge=false;
  for(size_t k=0;k<q.size();k++){const int x=q[k]%w,y=q[k]/w;box={std::min(box[0],x),std::min(box[1],y),std::max(box[2],x+1),std::max(box[3],y+1)};edge|=x==0||y==0||x==w-1||y==h-1;
   for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){const int nx=x+dx,ny=y+dy,n=ny*w+nx;if(nx<0||ny<0||nx>=w||ny>=h||seen[n]||gray(nx+bounds[0],ny+bounds[1])>=224)continue;seen[n]=1;q.push_back(n);}}
  const Box pageBox{box[0]+bounds[0],box[1]+bounds[1],box[2]+bounds[0],box[3]+bounds[1]};
  if(!edge&&box[2]-box[0]<=character*2&&box[3]-box[1]<=character*2&&overlap(pageBox,expand_box(b,fringe,image.width,image.height))==area(pageBox))for(int p:q)ink[p]=1;
 }
 out.mask.bounds=bounds;out.mask.margin=margin;out.mask.character_size=character;out.mask.pixels.resize(ink.size());
 for(int p=0;p<w*h;p++)if(ink[p])for(int dy=-margin;dy<=margin;dy++)for(int dx=-margin;dx<=margin;dx++){const int x=p%w+dx,y=p/w+dy;if(x<0||y<0||x>=w||y>=h)continue;const int n=y*w+x;if(ink[n]||gray(x+bounds[0],y+bounds[1])>=224)out.mask.pixels[n]=1;}
 for(const auto& other:rows){if(other.at("id")==row.at("id"))continue;const Box otherBox=expand_box(other.at("bbox").get<Box>(),1,image.width,image.height);for(int y=std::max(bounds[1],otherBox[1]);y<std::min(bounds[3],otherBox[3]);y++)for(int x=std::max(bounds[0],otherBox[0]);x<std::min(bounds[2],otherBox[2]);x++)if(out.mask.pixels[size_t(y-bounds[1])*w+x-bounds[0]])return reject("paragraph-neighbor");}
 for(const auto& other:detected)if((other.cls==1&&other.score>=.2f||other.cls==2&&other.score>=.65f)&&overlap(bounds,other.box))for(int p=0;p<w*h;p++)if(out.mask.pixels[p]&&region_pixel(other,p%w+bounds[0],p/w+bounds[1],image.width,image.height))return reject("paragraph-protected-region");
 out.mask.count=std::count(out.mask.pixels.begin(),out.mask.pixels.end(),uint8_t(1));if(out.mask.count<8||out.mask.count>area(b)*.9||out.mask.count>int64_t(image.width)*image.height*.2)return reject("paragraph-mask-size");
 out.proof={{"version",1},{"method","verified-paragraph-foreground"},{"sourceText",row.at("text")},{"sourceBox",row.at("bbox")},{"sourceConfidence",row.at("detectorConfidence")},{"columnProof",row.at("paragraphCorrection")},{"paperFraction",double(paper)/area(b)},{"fringe",fringe},{"maskPixels",out.mask.count}};
 return out;
}
