#pragma once
#include "ocr_glyph_repeat.hpp"
namespace missing_kana {
struct Plan {std::vector<Box> bands; std::vector<uint32_t> prior;};
inline std::vector<Box> bands(const PageImage& image,Box b,int threshold){
 std::vector<Box> out;Box ink{b[2],b[3],b[0],b[1]};int begin=-1;
 for(int y=b[1];y<=b[3];y++){
  int pixels=0,left=b[2],right=b[0];if(y<b[3])for(int x=b[0];x<b[2];x++)if(repeat_columns::foreground(image,x,y,threshold,false)){pixels++;left=std::min(left,x);right=std::max(right,x+1);}
  if(pixels>=2){if(begin<0){begin=y;ink={left,y,right,y+1};}else ink={std::min(ink[0],left),ink[1],std::max(ink[2],right),y+1};}
  else if(begin>=0){out.push_back(ink);begin=-1;}
 }return out;
}
inline std::optional<Plan> physical_plan(const PageImage& image,const json& row){
 if(image.width<=0||image.height<=0||int64_t(image.width)*image.height>40000000||image.rgb.size()!=size_t(image.width)*image.height*3)return {};
 if(!repeat_columns::eligible(row,image))return {};const Box b=row.at("bbox");const int w=b[2]-b[0],h=b[3]-b[1];
 if(w<24||w>128||h<w*2.5||h>1024)return {};
 const auto prior=codepoints(row.value("text",std::string{}));if(prior.size()<4||prior.size()>16)return {};
 for(auto c:prior)if(c<0x3000||c>0x9fff)return {};
 auto base=bands(image,b,100);if(base.size()!=prior.size()+1)return {};
 for(int t:{60,128}){const auto next=bands(image,b,t);if(next.size()!=base.size())return {};for(size_t i=0;i<base.size();i++)for(int k:{1,3})if(std::abs(base[i][k]-next[i][k])>2)return {};}
 for(const auto& band:base)if(band[2]-band[0]<4||band[3]-band[1]<5)return {};
 return Plan{base,prior};
}
inline std::optional<Plan> plan(const PageImage& image,const json& row,const std::vector<Region>& detected){
 const auto physical=physical_plan(image,row);if(!physical)return {};const auto* source=repeat_columns::source(row,detected);if(!source)return {};const auto& base=physical->bands;
 // A complete detached source glyph, not merely a changed decoder vote.
 repeat_columns::Columns columns{base,false};if(!repeat_columns::glyphs_owned(image,columns,*source))return {};
 return physical;
}
inline std::optional<size_t> insertion(const std::vector<uint32_t>& prior,const std::vector<uint32_t>& candidate){
 if(candidate.size()!=prior.size()+1)return {};std::optional<size_t> found;
 for(size_t i=1;i+1<candidate.size();i++){
  if(glyph_repeat::family(candidate[i])==candidate[i])continue;
  auto copy=candidate;copy.erase(copy.begin()+i);if(copy!=prior)continue;if(found)return {};found=i;
 }return found;
}
template<class Read> inline json correction(const PageImage& image,const json& row,const std::vector<Region>& detected,Read read){
 const auto p=plan(image,row,detected);if(!p)return nullptr;const Box source=row.at("bbox");
 const auto candidate=read(source,1,false,24);const auto chars=codepoints(candidate);const auto at=insertion(p->prior,chars);if(!at||chars.size()!=p->bands.size())return nullptr;
 const auto glyph=p->bands[*at];const int height=glyph[3]-glyph[1];std::vector<int> sizes;for(size_t i=0;i<p->bands.size();i++)if(i!=*at&&i+1<p->bands.size())sizes.push_back(p->bands[i][3]-p->bands[i][1]);std::sort(sizes.begin(),sizes.end());if(sizes.empty())return nullptr;const int median=sizes[sizes.size()/2];
 if(height<median*.3||height>median*.78||glyph[1]-p->bands[*at-1][3]<3||p->bands[*at+1][1]-glyph[3]<3)return nullptr;
 json readings=json::array();readings.push_back({{"bbox",source},{"scale",1},{"inverse",false},{"padding",24},{"text",candidate}});
 for(int view=1;view<4;view++){const auto value=read(source,view%2?2:1,view>=2,24);if(codepoints(value)!=chars)return nullptr;readings.push_back({{"bbox",source},{"scale",view%2?2:1},{"inverse",view>=2},{"padding",24},{"text",value}});}
 // Preserve the original punctuation and all prefix/suffix characters, and
 // independently recognize the isolated physical small-kana family.
 const Box prefix{source[0],source[1],source[2],glyph[1]-2},suffix{source[0],glyph[3]+2,source[2],source[3]},single{source[0],glyph[1]-2,source[2],glyph[3]+2};
 auto encode=[](const std::vector<uint32_t>& code,size_t first,size_t last){std::string out;for(size_t i=first;i<last;i++){const auto c=code[i];if(c<128)out+=char(c);else if(c<2048){out+=char(0xc0|(c>>6));out+=char(0x80|(c&63));}else{out+=char(0xe0|(c>>12));out+=char(0x80|((c>>6)&63));out+=char(0x80|(c&63));}}return out;};
 for(int view=0;view<4;view++)for(int part=0;part<3;part++){
  const auto b=part==0?prefix:part==1?suffix:single;const auto value=read(b,view%2?2:1,view>=2,12);const auto current=codepoints(value);
  if(part==2){if(current.size()!=1||glyph_repeat::family(current[0])!=glyph_repeat::family(chars[*at]))return nullptr;}
  else if(value!=encode(chars,part==0?0:*at+1,part==0?*at:chars.size()))return nullptr;
  readings.push_back({{"bbox",b},{"scale",view%2?2:1},{"inverse",view>=2},{"padding",12},{"text",value}});
 }
 return {{"version",1},{"method","physical-missing-small-kana"},{"prior",row.at("text")},{"text",candidate},{"sourceBox",source},{"sourceConfidence",row.at("detectorConfidence")},{"sourceQuery",repeat_columns::source(row,detected)->query},{"glyphBoxes",p->bands},{"addedGlyphBox",glyph},{"insertAt",*at},{"readings",readings}};
}
}
