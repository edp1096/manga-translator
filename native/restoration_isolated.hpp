#pragma once
#include "restoration_source.hpp"
#include "restoration_revalidation.hpp"

struct IsolatedGlyphView { Box crop; Region text; double agreement=0; };
struct IsolatedGlyphCandidate {
 RestorationMask mask;
 PageImage reading;
 json proof=json::object();
};

// Connected dark components are indivisible. Background strokes connected to
// the crop edge or a large contour are never trimmed into plausible letters.
inline IsolatedGlyphCandidate restoration_isolated_components(const PageImage& image,const Region& source,const json& row,const std::vector<IsolatedGlyphView>& views,const std::vector<Region>& detected,const json& rows,const LayoutRaw* raw=nullptr,bool cross_ocr=false,bool pixel_components=false,bool joined=false,const std::map<int,RestorationMask>* acceptedNeighbors=nullptr,const std::set<int>* annotationEffects=nullptr){
 IsolatedGlyphCandidate out;auto reject=[&](const char* reason){out.mask.reason=reason;return out;};
 const bool annotation=annotationEffects!=nullptr;bool verified=false;
 const bool verifiedEffectSource=annotation&&source.cls==1&&restoration_verified_text(row)&&row.at("textVerification").value("method",std::string{})=="ocr-consensus"&&row.at("textVerification").at("sources")==json::array({row.at("bbox")})&&source.box==row.at("bbox").get<Box>()&&std::abs(source.score-row.value("detectorConfidence",0.))<.0001&&restoration_effect_matches(source,raw);

 if(cross_ocr&&views.empty()&&source.ocr_verified&&restoration_verified_text(row)&&source.score>=.5f&&source.score<=1&&restoration_effect_matches(source,raw)){
  const auto& v=row.at("textVerification");verified=v.at("sources").size()==1&&v.at("sources")[0]==source.box&&std::abs(source.score-row.value("detectorConfidence",0.))<.0001;
  for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})if(row.value(flag,false))verified=false;
 }
 if((annotation?cross_ocr||joined||!pixel_components||!views.empty()||source.score<.25f||source.score>1.f||!restoration_effect_matches(source,raw):cross_ocr?!verified:views.size()!=3||source.score<.65f)||(source.cls!=0&&!verifiedEffectSource)||source.box!=row.at("bbox").get<Box>()||!restoration_box(source.box,image))return reject("isolated-source");
 if(joined&&(!pixel_components||cross_ocr||!restoration_effect_matches(source,raw)||area(source.box)>int64_t(image.width)*image.height*.02||std::max(source.box[2]-source.box[0],source.box[3]-source.box[1])<2*std::min(source.box[2]-source.box[0],source.box[3]-source.box[1])))return reject("isolated-joined-source");
 const auto chars=codepoints(row.value("text",std::string{}));if(chars.size()<2||chars.size()>64||area(source.box)>int64_t(image.width)*image.height*.08)return reject("isolated-size");
 const double scale=std::min(image.width,image.height)/720.;const double character=std::clamp(std::sqrt(double(area(source.box))/chars.size()),8*scale,48*scale);
 const Box bounds=expand_box(source.box,int(std::ceil(character*1.5)),image.width,image.height);const int w=bounds[2]-bounds[0],h=bounds[3]-bounds[1];
 std::vector<uint8_t> seen(size_t(w)*h),chosen(seen.size()),background(seen.size());json components=json::array(),backgroundComponents=json::array();
 auto dark=[&](int p){const auto* v=image.rgb.data()+(size_t(p/w+bounds[1])*image.width+p%w+bounds[0])*3;return(int(v[0])+v[1]+v[2])/3;};
 auto support=[&](int p){if(pixel_components){const int x=p%w+bounds[0],y=p/w+bounds[1];if(x>=source.box[0]&&x<source.box[2]&&y>=source.box[1]&&y<source.box[3])return true;const auto fringe=expand_box(source.box,int(std::ceil(character*.25)),image.width,image.height);if(x<fringe[0]||x>=fringe[2]||y<fringe[1]||y>=fringe[3])return false;for(const auto& other:rows){if(other.at("id")==row.at("id")||(annotation&&other.value("type",std::string{})=="effect"&&annotationEffects->count(other.at("id").get<int>())))continue;const Box b=other.at("bbox");if(x>=b[0]&&x<b[2]&&y>=b[1]&&y<b[3])return false;}return true;}return region_pixel(source,p%w+bounds[0],p/w+bounds[1],image.width,image.height);};
 for(int start=0;start<w*h;start++){
  if(seen[start]||dark(start)>=192)continue;std::vector<int> q{start};seen[start]=1;Box b{w,h,0,0};size_t owned=0,core=0,ownedCore=0,sourceCore=0;bool edge=false;
  for(size_t k=0;k<q.size();k++){
   const int p=q[k],x=p%w,y=p/w;b={std::min(b[0],x),std::min(b[1],y),std::max(b[2],x+1),std::max(b[3],y+1)};edge|=x==0||y==0||x==w-1||y==h-1;owned+=support(p);if(dark(p)<(pixel_components?192:128)){core++;ownedCore+=support(p);sourceCore+=(x+bounds[0]>=source.box[0]&&x+bounds[0]<source.box[2]&&y+bounds[1]>=source.box[1]&&y+bounds[1]<source.box[3]);}
   for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){const int nx=x+dx,ny=y+dy,n=ny*w+nx;if(nx<0||ny<0||nx>=w||ny>=h||seen[n]||dark(n)>=192)continue;seen[n]=1;q.push_back(n);}
  }
  const bool detachedLine=annotation&&std::min(b[2]-b[0],b[3]-b[1])<=std::max(1.,character*.2)&&std::max(b[2]-b[0],b[3]-b[1])>=character*2&&(b[0]+bounds[0]<source.box[0]-character*.25||b[1]+bounds[1]<source.box[1]-character*.25||b[2]+bounds[0]>source.box[2]+character*.25||b[3]+bounds[1]>source.box[3]+character*.25);
  const bool peripheralGraphic=verifiedEffectSource&&(b[0]+bounds[0]<source.box[0]||b[1]+bounds[1]<source.box[1]||b[2]+bounds[0]>source.box[2]||b[3]+bounds[1]>source.box[3]);
  if(core<(pixel_components?1:4)||ownedCore*2<core||(annotation&&(edge||detachedLine||peripheralGraphic||sourceCore*2<core))){if(annotation){for(int p:q)background[p]=1;if(ownedCore&&edge)backgroundComponents.push_back({{"bbox",Box{b[0]+bounds[0],b[1]+bounds[1],b[2]+bounds[0],b[3]+bounds[1]}},{"pixels",q.size()},{"ownedCore",ownedCore},{"edge",edge}});}continue;}
  if(edge||b[2]-b[0]>character*((joined||annotation)?6:2)||b[3]-b[1]>character*((joined||annotation)?6:2)||owned<q.size()*.4)return reject("isolated-attached-source");
  const Box pageBox{b[0]+bounds[0],b[1]+bounds[1],b[2]+bounds[0],b[3]+bounds[1]};
  if(overlap(pageBox,expand_box(source.box,pixel_components?int(std::ceil(character*.25)):1,image.width,image.height))!=area(pageBox))return reject("isolated-source-extension");
  json fractions=json::array();int votes=0;
  for(const auto& view:views){
   if(view.text.cls!=0||view.text.score<.2f||view.agreement<.9||area(view.crop)<=0)return reject("isolated-detail");
   size_t pixels=0;for(const int p:q){const int x=p%w+bounds[0]-view.crop[0],y=p/w+bounds[1]-view.crop[1];if(x>=0&&y>=0&&x<view.crop[2]-view.crop[0]&&y<view.crop[3]-view.crop[1])pixels+=region_pixel(view.text,x,y,view.crop[2]-view.crop[0],view.crop[3]-view.crop[1]);}
   const double fraction=double(pixels)/q.size();if(!pixel_components&&fraction<.25)return reject("isolated-disputed-component");votes+=fraction>=.5;fractions.push_back(fraction);
  }
  if(!pixel_components&&!cross_ocr&&votes<2)return reject("isolated-disputed-component");
  for(const int p:q)chosen[p]=1;
  components.push_back({{"bbox",pageBox},{"pixels",q.size()},{"corePixels",core},{"sourceFraction",double(owned)/q.size()},{"coreSourceFraction",double(ownedCore)/core},{"viewFractions",fractions}});
 }
 double residual=0;
 if(pixel_components){
  std::vector<const Region*> neighbors;
  if(restoration_effect_matches(source,raw))for(const auto& other:rows){if(other.at("id")==row.at("id")||other.value("type",std::string{})!="text"||other.value("manual",false)||other.value("layoutOverride",false)||other.value("displayOverride",false)||other.value("ocrTruncated",false)||other.value("truncated",false))continue;const Region* match=nullptr;bool ambiguous=false;for(const auto& r:detected)if(r.cls==0&&r.score>=.65f&&r.box==other.at("bbox").get<Box>()&&std::abs(r.score-other.value("detectorConfidence",0.))<.0001&&restoration_effect_matches(r,raw)){if(match)ambiguous=true;match=&r;}if(match&&!ambiguous&&match->query!=source.query)neighbors.push_back(match);}
  size_t total=0,missing=0,protectedPixels=0;
  for(int y=source.box[1];y<source.box[3];y++)for(int x=source.box[0];x<source.box[2];x++){const int p=(y-bounds[1])*w+x-bounds[0];if(dark(p)>=192)continue;total++;if(chosen[p]||(annotation&&background[p]))continue;bool neighbor=false;for(const auto* r:neighbors)for(int dy=-1;dy<=1&&!neighbor;dy++)for(int dx=-1;dx<=1;dx++)if(region_pixel(*r,x+dx,y+dy,image.width,image.height)){neighbor=true;break;}if(neighbor)protectedPixels++;else missing++;}
  residual=double(missing)/std::max(size_t(1),total);out.proof["foregroundResidualFraction"]=residual;out.proof["protectedForegroundPixels"]=protectedPixels;if(!total||residual>.01)return reject("isolated-unclaimed-foreground");
 }
 const size_t glyphPixels=std::count(chosen.begin(),chosen.end(),uint8_t(1));if(glyphPixels<8||components.empty()||components.size()>(pixel_components?1024:128))return reject("isolated-empty");
 out.mask.bounds=bounds;out.mask.character_size=character;out.mask.margin=std::max(1,int(std::ceil(1.5*scale)));out.mask.pixels.resize(chosen.size());
 for(int p=0;p<w*h;p++)if(chosen[p])for(int dy=-out.mask.margin;dy<=out.mask.margin;dy++)for(int dx=-out.mask.margin;dx<=out.mask.margin;dx++){
  const int nx=p%w+dx,ny=p/w+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const int n=ny*w+nx;if(chosen[n]||dark(n)>=192)out.mask.pixels[n]=1;
 }
 // All unselected dark pixels are protected, including background hatching.
 // Preserve other strings and every detected effect even if its score is low.
 for(const auto& other:rows){
  if(other.at("id")==row.at("id")||(annotation&&other.value("type",std::string{})=="effect"&&annotationEffects->count(other.at("id").get<int>())))continue;
  Box b=expand_box(other.at("bbox").get<Box>(),1,image.width,image.height);
  if(!joined&&!overlap(b,bounds))continue;
  // Match the normal restoration path: only unchanged, page-local raw
  // detections may replace an enclosing rectangle with its actual mask.
  const Region* neighbor=nullptr;bool ambiguous=false;
  if(joined?restoration_effect_matches(source,raw):restoration_neighbor_source(source,row,raw))for(const auto& r:detected)
   if(restoration_neighbor_source(r,other,raw)){if(neighbor)ambiguous=true;neighbor=&r;}
  if(ambiguous||(neighbor&&neighbor->query==source.query))neighbor=nullptr;
  bool smallRawNeighbor=false;
  if(!neighbor&&annotation&&restoration_effect_matches(source,raw)&&other.value("type",std::string{})=="effect"){
   bool edited=false;for(const auto* flag:{"manual","layoutOverride","displayOverride","panelCandidate"})edited|=other.value(flag,false);
   if(!edited){bool multiple=false;for(const auto& r:detected)if(r.cls==1&&r.query!=source.query&&r.box==other.at("bbox").get<Box>()&&std::isfinite(r.score)&&r.score>=.2f&&r.score<=1&&std::abs(r.score-other.value("detectorConfidence",0.))<.0001&&restoration_effect_matches(r,raw)){if(neighbor)multiple=true;neighbor=&r;}if(multiple)neighbor=nullptr;smallRawNeighbor=neighbor!=nullptr;}
  }

  const RestorationMask* precise=nullptr;
  if(joined&&neighbor&&acceptedNeighbors){const auto found=acceptedNeighbors->find(other.at("id").get<int>());if(found!=acceptedNeighbors->end()&&found->second.accepted())precise=&found->second;}
  if(precise)b={std::min(b[0],precise->bounds[0]),std::min(b[1],precise->bounds[1]),std::max(b[2],precise->bounds[2]),std::max(b[3],precise->bounds[3])};
  if(!overlap(b,bounds))continue;
  auto precise_ink=[&](int x,int y){
   if(!precise||x<precise->bounds[0]||y<precise->bounds[1]||x>=precise->bounds[2]||y>=precise->bounds[3])return false;
   const int width=precise->bounds[2]-precise->bounds[0];const auto* rgb=image.rgb.data()+(size_t(y)*image.width+x)*3;
   return precise->pixels[size_t(y-precise->bounds[1])*width+x-precise->bounds[0]]&&(int(rgb[0])+rgb[1]+rgb[2])/3<192;
  };
  auto protected_pixel=[&](int x,int y){
   if(precise){for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)if(precise_ink(x+dx,y+dy))return true;return false;}
   if(!neighbor)return true;
   for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++)
    if(region_pixel(*neighbor,x+dx,y+dy,image.width,image.height))return true;
   return false;
  };
  for(int y=std::max(b[1],bounds[1]);y<std::min(b[3],bounds[3]);y++)
   for(int x=std::max(b[0],bounds[0]);x<std::min(b[2],bounds[2]);x++)
    if(out.mask.pixels[size_t(y-bounds[1])*w+x-bounds[0]]&&protected_pixel(x,y)){if(joined||annotation){out.proof["neighborId"]=other.at("id");out.proof["preciseNeighbor"]=precise!=nullptr;out.proof["collision"]=json::array({x,y});}return reject("isolated-neighbor");}
  if(neighbor){
   json runs=json::array();const int side=precise?512:neighbor->mask_side;auto bits=precise?std::vector<uint8_t>(size_t(side)*side):neighbor->mask;
   if(precise)for(int y=precise->bounds[1];y<precise->bounds[3];y++)for(int x=precise->bounds[0];x<precise->bounds[2];x++)if(precise_ink(x,y)){const int left=x*side/image.width,right=std::min(side,int(std::ceil((x+1.)*side/image.width))),top=y*side/image.height,bottom=std::min(side,int(std::ceil((y+1.)*side/image.height)));for(int py=top;py<bottom;py++)for(int px=left;px<right;px++)bits[size_t(py)*side+px]=1;}
   for(size_t i=0;i<bits.size();){if(!bits[i]){i++;continue;}const auto start=i;while(i<bits.size()&&bits[i]&&i/side==start/side)i++;runs.push_back(start);runs.push_back(i-start);}
   out.mask.segmentedNeighbors.push_back({{"id",other.at("id")},{"sourceText",other.at("text")},{"sourceBox",other.at("bbox")},{"sourceConfidence",source.score},{"smallTextRawNeighbor",smallRawNeighbor},{"geometry",{{"width",side},{"height",side},{"bbox",neighbor->box},{"runs",runs},{"confidence",neighbor->score}}}});
  }
 }
 for(const auto& r:detected)if(r.cls==1&&r.score>=.2f&&overlap(r.box,bounds)&&!(verifiedEffectSource&&r.query==source.query&&r.box==source.box&&r.mask==source.mask)&&!(annotation&&std::any_of(rows.begin(),rows.end(),[&](const json& other){return other.value("type",std::string{})=="effect"&&annotationEffects->count(other.at("id").get<int>())&&other.at("bbox")==json(r.box)&&std::abs(other.value("detectorConfidence",0.)-r.score)<.0001&&restoration_effect_matches(r,raw);})))for(int p=0;p<w*h;p++)if(out.mask.pixels[p]&&region_pixel(r,p%w+bounds[0],p/w+bounds[1],image.width,image.height)){out.proof["effectQuery"]=r.query;out.proof["effectBox"]=r.box;out.proof["collision"]=json::array({p%w+bounds[0],p/w+bounds[1]});return reject("isolated-effect");}
 out.mask.count=std::count(out.mask.pixels.begin(),out.mask.pixels.end(),uint8_t(1));if(out.mask.count>area(source.box)*1.8||out.mask.count>int64_t(image.width)*image.height*.08)return reject("isolated-mask-size");
 out.reading={w,h,std::vector<uint8_t>(size_t(w)*h*3,255)};for(int p=0;p<w*h;p++)if(chosen[p])std::copy_n(image.rgb.data()+(size_t(p/w+bounds[1])*image.width+p%w+bounds[0])*3,3,out.reading.rgb.data()+size_t(p)*3);
 out.proof={{"version",1},{"method",annotation?"isolated-verified-small-glyphs":joined?"isolated-joined-glyphs":pixel_components?"isolated-pixel-components":cross_ocr?"isolated-cross-ocr-glyphs":"isolated-multiview-glyphs"},{"sourceText",row.at("text")},{"sourceBox",row.at("bbox")},{"sourceConfidence",row.at("detectorConfidence")},{"glyphPixels",glyphPixels},{"components",components},{"protectedInkChanges",0}};
 if(pixel_components){out.proof["foregroundResidualFraction"]=residual;out.proof["sourceFringe"]=int(std::ceil(character*.25));}
 if(annotation){
  const int side=512;std::vector<uint8_t> bits(side*side);for(int p=0;p<w*h;p++)if(background[p]){const int gx=p%w+bounds[0],gy=p/w+bounds[1];for(int y=gy*side/image.height;y<std::min(side,int(std::ceil((gy+1.)*side/image.height)));y++)for(int x=gx*side/image.width;x<std::min(side,int(std::ceil((gx+1.)*side/image.width)));x++)bits[y*side+x]=1;}
  json runs=json::array();for(size_t i=0;i<bits.size();){if(!bits[i]){i++;continue;}const auto start=i;while(i<bits.size()&&bits[i])i++;runs.push_back(start);runs.push_back(i-start);}out.proof["backgroundComponents"]=backgroundComponents;out.proof["backgroundGeometry"]={{"width",side},{"height",side},{"bbox",bounds},{"runs",runs}};
 }
 if(cross_ocr)out.proof["sourceVerification"]=row.at("textVerification");
 return out;
}

inline RestorationRevalidation restoration_isolated_glyphs(const PageImage& image,LayoutEngine& detector,const std::vector<Region>& detected,const json& rows,const LayoutRaw& raw,const std::function<void()>& check,const std::function<std::string(const PageImage&,Box,int,bool)>& read,const std::set<int>& excluded={}){
 RestorationRevalidation result;
 for(bool allowJoined:{false,true})for(const auto& row:rows){
  const int id=row.value("id",-1);if(result.masks.count(id))continue;if(allowJoined){const auto previous=result.evidence.find(std::to_string(id));if(previous==result.evidence.end()||previous->value("rejected",std::string{})!="isolated-attached-source")continue;}if(id<0||excluded.count(id)||row.value("translation",std::string{}).empty()||row.value("translation",std::string{})==row.value("text",std::string{}))continue;
  const auto source=restoration_original_source(row,detected,raw);if(!source||source->score<.65f||source->score>1||restoration_mask(image,*source,row,detected,rows).reason!="near-bubble")continue;
  const Region* owner=nullptr;bool strong=false;
  for(const auto& r:detected)if(r.cls==2&&(mask_coverage(r,source->box,image.width,image.height)>.05||double(overlap(r.box,source->box))/area(source->box)>.25)){if(r.score>=.5f)strong=true;if(!owner||r.score>owner->score)owner=&r;}
  if(strong||!owner||owner->score<.25f||double(overlap(owner->box,source->box))/area(source->box)<.98)continue;
  const auto crops=restoration_revalidation_crops(image,owner->box);if(crops.size()!=3)continue;
  std::vector<IsolatedGlyphView> views;
  for(const auto& crop:crops){
   check();const int w=crop[2]-crop[0],h=crop[3]-crop[1];PageImage local{w,h,std::vector<uint8_t>(size_t(w)*h*3)};for(int y=0;y<h;y++)std::copy_n(image.rgb.data()+(size_t(y+crop[1])*image.width+crop[0])*3,w*3,local.rgb.data()+size_t(y)*w*3);
   auto input=layout_input(local,false,false,detector.input_side());const auto detail=detector.run(input);result.passes++;const auto found=decode_regions(detail,w,h);const Region* best=nullptr;double agreement=.9;
   for(const auto& r:found)if(r.cls==0){const Box pageBox{r.box[0]+crop[0],r.box[1]+crop[1],r.box[2]+crop[0],r.box[3]+crop[1]};const double match=box_similarity(pageBox,source->box);if(match>=agreement){best=&r;agreement=match;}}
   if(!best)break;views.push_back({crop,*best,agreement});
  }
  if(views.size()!=3)continue;auto candidate=restoration_isolated_components(image,*source,row,views,detected,rows,&raw);if(candidate.mask.reason=="isolated-disputed-component"||candidate.mask.reason=="isolated-source-extension")candidate=restoration_isolated_components(image,*source,row,views,detected,rows,&raw,false,true);if(allowJoined&&candidate.mask.reason=="isolated-attached-source")candidate=restoration_isolated_components(image,*source,row,views,detected,rows,&raw,false,true,true,&result.masks);if(!candidate.mask.accepted()){result.evidence[std::to_string(id)]={{"rejected",candidate.mask.reason},{"details",candidate.proof}};continue;}
  json original=json::array(),isolated=json::array();bool exact=true;const auto expected=ocr_characters(row.at("text"),false);
  for(int scale:{1,2})for(bool inverse:{false,true}){
   check();const auto a=read(image,source->box,scale,inverse);const auto b=read(candidate.reading,{0,0,candidate.reading.width,candidate.reading.height},scale,inverse);original.push_back(a);isolated.push_back(b);exact=exact&&ocr_characters(a,false)==expected&&ocr_characters(b,false)==expected;
  }
  if(!exact){result.evidence[std::to_string(id)]={{"rejected","isolated-reading-disagreement"},{"originalReadings",original},{"isolatedReadings",isolated}};continue;}candidate.proof["originalReadings"]=original;candidate.proof["isolatedReadings"]=isolated;candidate.proof["views"]=json::array();for(const auto& v:views)candidate.proof["views"].push_back({{"crop",v.crop},{"confidence",v.text.score},{"agreement",v.agreement}});
  result.masks.emplace(id,std::move(candidate.mask));result.evidence[std::to_string(id)]=std::move(candidate.proof);
 }
 return result;
}
