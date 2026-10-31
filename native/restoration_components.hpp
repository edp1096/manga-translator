#pragma once
#include "restoration_mask.hpp"
// Recover independently verified outside glyphs beside a coarse balloon edge.
// Threshold-stable components may refine erasure; interaction masks never authorize it.
struct RestorationComponents {RestorationMask mask;json proof;};
inline RestorationComponents restoration_component_mask(const PageImage& image,const Region& source,const json& row,const std::vector<Region>& detected,const json& all){
 RestorationComponents out;auto coarse=restoration_mask(image,source,row,detected,all);out.proof={{"id",row.at("id")},{"coarse",coarse.reason}};auto reject=[&](const char* reason){out.mask.reason=reason;out.proof["reject"]=reason;return out;};
 if(coarse.reason!="bubble-mask-collision"||!source.ocr_verified||!restoration_verified_text(row)||coarse.bubble)return reject("ineligible");
 if(box_similarity(source.box,row.at("bbox").get<Box>())<.9)return reject("source-mismatch");
 bool boundary=false;for(const auto& r:detected)if(r.cls==2&&overlap(r.box,source.box)){
  const double cover=mask_coverage(r,source.box,image.width,image.height);
  if(cover>.05)return reject("balloon-interior");
  boundary|=r.score>=.65f&&cover>0;
 }
 if(!boundary)return reject("unconfirmed-boundary");
 const double scale=std::min(image.width,image.height)/720.;const double character=std::clamp(std::sqrt(double(area(source.box))/std::max(size_t(1),text_characters(row.value("text",std::string{})))),8*scale,48*scale);
 const int pad=int(std::ceil(character*1.5));const Box bounds=expand_box(source.box,pad,image.width,image.height);int w=bounds[2]-bounds[0],h=bounds[3]-bounds[1];
 std::vector<uint8_t> chosen,protectedInk,previousInk,previousProtected,core;json passes=json::array();size_t unstable=0;
 for(int threshold:{128,160,192}){
  std::vector<uint8_t> seen(size_t(w)*h),ink(seen.size()),protect(seen.size());json components=json::array();
  auto dark=[&](int x,int y){auto p=image.rgb.data()+(size_t(y+bounds[1])*image.width+x+bounds[0])*3;return(int(p[0])+p[1]+p[2])/3<threshold;};
  for(int start=0;start<w*h;start++){int sx=start%w,sy=start/w;if(seen[start]||!dark(sx,sy))continue;std::vector<int> queue{start};seen[start]=1;Box b{sx,sy,sx+1,sy+1};bool edge=false;size_t support=0;size_t boxSupport=0,unprotectedSupport=0;
   for(size_t k=0;k<queue.size();k++){int x=queue[k]%w,y=queue[k]/w;b={std::min(b[0],x),std::min(b[1],y),std::max(b[2],x+1),std::max(b[3],y+1)};edge|=x==0||y==0||x==w-1||y==h-1;const bool sourcePixel=region_pixel(source,x+bounds[0],y+bounds[1],image.width,image.height);support+=sourcePixel;
    if(sourcePixel&&std::none_of(detected.begin(),detected.end(),[&](const Region& r){if(r.cls!=2||r.mask_side<1)return false;const int collar=std::max(1,int(std::ceil(double(std::max(image.width,image.height))/r.mask_side)));
     for(int dy=-collar;dy<=collar;dy++)for(int dx=-collar;dx<=collar;dx++)if(region_pixel(r,x+bounds[0]+dx,y+bounds[1]+dy,image.width,image.height))return true;return false;}))unprotectedSupport++;boxSupport+=x+bounds[0]>=source.box[0]&&x+bounds[0]<source.box[2]&&y+bounds[1]>=source.box[1]&&y+bounds[1]<source.box[3];for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){int nx=x+dx,ny=y+dy,p=ny*w+nx;if(nx<0||ny<0||nx>=w||ny>=h||seen[p]||!dark(nx,ny))continue;seen[p]=1;queue.push_back(p);}}
   support=std::max(support,boxSupport);const bool selected=support>0&&!edge&&b[2]-b[0]<=character*2&&b[3]-b[1]<=character*2&&double(support)/queue.size()>=.15;
   for(int p:queue)(selected?ink:protect)[p]=1;
   if(support)components.push_back({{"bbox",Box{b[0]+bounds[0],b[1]+bounds[1],b[2]+bounds[0],b[3]+bounds[1]}},{"pixels",queue.size()},{"supported",support},{"selected",selected},{"edge",edge},{"unprotectedSupport",unprotectedSupport}});
  }
  if(threshold==128)core=ink;
  if(!previousInk.empty())for(size_t i=0;i<ink.size();i++)if((previousInk[i]&&protect[i])||(previousProtected[i]&&ink[i]))unstable++;
  previousInk=ink;previousProtected=protect;
  passes.push_back({{"threshold",threshold},{"components",components}});
  if(threshold==192){chosen=std::move(ink);protectedInk=std::move(protect);}
 }
 out.proof["passes"]=passes;out.proof["unstablePixels"]=unstable;
 if(unstable)return reject("unstable-component-ownership");
 size_t darkSelected=std::count(chosen.begin(),chosen.end(),uint8_t(1)),corePixels=std::count(core.begin(),core.end(),uint8_t(1));
 if(darkSelected<4||corePixels<darkSelected*.25)return reject("low-contrast-source");
 size_t bright=0,background=0;for(int y=0;y<h;y++)for(int x=0;x<w;x++){size_t i=size_t(y)*w+x;if(chosen[i]||protectedInk[i])continue;auto p=image.rgb.data()+(size_t(y+bounds[1])*image.width+x+bounds[0])*3;background++;bright+=std::min({p[0],p[1],p[2]})>=224;}
 out.proof["brightBackground"]=double(bright)/std::max(size_t(1),background);
 if(background<4||bright<background*.85)return reject("complex-background");
 // An ambiguous long component must not be silently retained as if it were a border.
 for(const auto& pass:passes)for(const auto& component:pass.at("components"))if(!component.at("selected").get<bool>()&&component.at("supported").get<size_t>()>2){
  if(component.at("unprotectedSupport").get<size_t>()>2||!component.at("edge").get<bool>()||component.at("supported").get<double>()/component.at("pixels").get<double>()>.35)return reject("ambiguous-attached-component");
 }
 out.mask.bounds=bounds;out.mask.character_size=character;out.mask.margin=std::max(2,int(std::round(3*scale)));out.mask.pixels.resize(size_t(w)*h);
 for(int y=0;y<h;y++)for(int x=0;x<w;x++)if(chosen[size_t(y)*w+x])for(int dy=-out.mask.margin;dy<=out.mask.margin;dy++)for(int dx=-out.mask.margin;dx<=out.mask.margin;dx++){int nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<w&&ny<h)if(!protectedInk[size_t(ny)*w+nx])out.mask.pixels[size_t(ny)*w+nx]=1;}
 size_t protectedCollision=0;for(size_t i=0;i<out.mask.pixels.size();i++)protectedCollision+=out.mask.pixels[i]&&protectedInk[i];out.proof["protectedCollision"]=protectedCollision;
 if(protectedCollision)return reject("touching-protected-ink");
 for(const auto& other:all){if(other.at("id")==row.at("id"))continue;auto b=expand_box(other.at("bbox").get<Box>(),1,image.width,image.height);for(int y=std::max(b[1],bounds[1]);y<std::min(b[3],bounds[3]);y++)for(int x=std::max(b[0],bounds[0]);x<std::min(b[2],bounds[2]);x++)if(out.mask.pixels[size_t(y-bounds[1])*w+x-bounds[0]])return reject("neighbor-ink");}
 for(const auto& effect:detected)if(effect.cls==1&&effect.score>=.5f&&overlap(effect.box,bounds))for(int y=0;y<h;y++)for(int x=0;x<w;x++)if(out.mask.pixels[size_t(y)*w+x]&&region_pixel(effect,x+bounds[0],y+bounds[1],image.width,image.height))return reject("effect-mask-collision");
 out.mask.count=std::count(out.mask.pixels.begin(),out.mask.pixels.end(),uint8_t(1));if(out.mask.count>area(source.box)*1.8||out.mask.count>int64_t(image.width)*image.height*.08)return reject("mask-too-large");
 out.proof["version"]=1;out.proof["method"]="threshold-stable-components";out.proof["maskPixels"]=out.mask.count;return out;
}
