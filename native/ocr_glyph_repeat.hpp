#pragma once
#include "styled_ocr.hpp"
#include "ocr_repeat_columns.hpp"
#include <optional>
#include <string_view>

// Isolated OCR normalizes the size of a kana glyph. Preserve the original
// whole-string spelling; use its small/large family only as corroboration.
// Count comes from separate source components, never from OCR voting.
namespace glyph_repeat {
inline uint32_t family(uint32_t c){
 constexpr std::u32string_view small=U"ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ";
 constexpr std::u32string_view large=U"あいうえおつやゆよわかけアイウエオツヤユヨワカケ";
 const auto at=small.find(c);return at==small.npos?c:large[at];
}
inline bool punctuation(uint32_t c){return c<=0x20||c==0x3000||(c<128&&std::ispunct(static_cast<unsigned char>(c)))||(c>=0x2000&&c<=0x206f)||(c>=0x3001&&c<=0x301f)||(c>=0xff01&&c<=0xff65);}
struct Span {std::string prefix,glyph,suffix;size_t count=0,prefix_count=0;uint32_t character=0;};
inline std::optional<Span> span(const std::string& text){
 if(text.size()>256)return {};const auto chars=codepoints(text);std::vector<size_t> offsets{0};
 for(auto c:chars)offsets.push_back(offsets.back()+(c<128?1:c<0x800?2:c<0x10000?3:4));
 if(offsets.back()!=text.size())return {};size_t end=chars.size();while(end&&punctuation(chars[end-1]))end--;
 if(!end)return {};const auto last=chars[end-1];if(last<0x3041||last>0x30fa)return {};
 size_t start=end-1;while(start&&chars[start-1]==last)start--;const auto count=end-start;
 const auto prefix=text.substr(0,offsets[start]);const auto n=ocr_characters(prefix).size();
 if(count<2||count>5||!n||n>8||n+count>12)return {};
 return Span{prefix,text.substr(offsets[end-1],offsets[end]-offsets[end-1]),text.substr(offsets[end]),count,n,last};
}
struct Plan {Span word;Box bounds,prefix,run,suffix;std::vector<Box> glyphs;};
inline std::optional<Plan> plan(const PageImage& image,const json& row,const std::vector<Region>& detected){
 if(image.width<=0||image.height<=0||int64_t(image.width)*image.height>40000000||image.rgb.size()!=size_t(image.width)*image.height*3||!repeat_columns::eligible(row,image))return {};
 const auto word=span(row.value("text",std::string{}));if(!word)return {};
 const Box box=row.at("bbox");const int w=box[2]-box[0],h=box[3]-box[1];if(w<24||w>512||h<w*2||h>2048)return {};
 const auto* source=repeat_columns::source(row,detected);if(!source)return {};
 const auto bounds=expand_box(box,5,image.width,image.height);const auto shapes=styled_glyphs(image,bounds);
 if(shapes.size()!=word->prefix_count+word->count+1)return {};
 Plan out;out.word=*word;out.bounds=bounds;int min_h=2048,max_h=0,min_x=image.width,max_x=0;std::vector<double> steps;
 for(size_t i=word->prefix_count;i<shapes.size();i++){
  const auto& g=shapes[i];const Box b{g.box[0]+bounds[0],g.box[1]+bounds[1],g.box[2]+bounds[0],g.box[3]+bounds[1]};
  const int gh=b[3]-b[1];if(gh<8||b[2]-b[0]<6||b[1]<=bounds[1]||b[3]>=bounds[3])return {};
  if(i+1==shapes.size()&&(b[0]<=bounds[0]||b[2]>=bounds[2]))return {};
  if(!out.glyphs.empty()){const auto p=out.glyphs.back();if(b[1]<p[3]+2)return {};steps.push_back((b[1]+b[3]-p[1]-p[3])/2.);}
  min_h=std::min(min_h,gh);max_h=std::max(max_h,gh);min_x=std::min(min_x,(b[0]+b[2])/2);max_x=std::max(max_x,(b[0]+b[2])/2);out.glyphs.push_back(b);
 }
 if(max_h>min_h*1.2||max_x-min_x>w*.25)return {};
 const auto range=std::minmax_element(steps.begin(),steps.end());if(steps.empty()||*range.first<=0||*range.second>*range.first*1.2)return {};
 // The added character must already belong to this detector source. Earlier
 // characters retain their prior OCR; this evidence cannot expand an erase mask.
 const auto& extra=shapes.back();size_t covered=0;
 for(int p:extra.pixels){const int x=p%(bounds[2]-bounds[0])+bounds[0],y=p/(bounds[2]-bounds[0])+bounds[1];const int sx=int((x+.5)*source->mask_side/image.width),sy=int((y+.5)*source->mask_side/image.height);bool hit=false;
  for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){const int xx=sx+dx,yy=sy+dy;if(xx<0||yy<0||xx>=source->mask_side||yy>=source->mask_side)continue;const double gx=(xx+.5)*image.width/source->mask_side,gy=(yy+.5)*image.height/source->mask_side;if(gx>=box[0]&&gx<box[2]&&gy>=box[1]&&gy<box[3]&&source->mask[size_t(yy)*source->mask_side+xx])hit=true;}
  covered+=hit;
 }
 if(extra.pixels.size()<24||covered<extra.pixels.size()*.98)return {};
 out.prefix={bounds[0],bounds[1],bounds[2],out.glyphs.front()[1]-1};out.run={bounds[0],out.glyphs.front()[1],bounds[2],out.glyphs.back()[3]};out.suffix={bounds[0],out.glyphs.back()[3]+1,bounds[2],bounds[3]};
 if(out.prefix[3]<=out.prefix[1]||(!word->suffix.empty()&&out.suffix[3]<=out.suffix[1]))return {};return out;
}
template<class Read> inline json correction(const PageImage& image,const json& row,const std::vector<Region>& detected,Read read){
 const auto p=plan(image,row,detected);if(!p)return nullptr;json evidence=json::array();
 auto exact=[&](const Box& b,const std::string& expected){for(int scale:{1,2})for(bool inverse:{false,true}){const auto value=read(b,scale,inverse);if(value.empty()||ocr_characters(value,false)!=ocr_characters(expected,false))return false;evidence.push_back({{"bbox",b},{"scale",scale},{"inverse",inverse},{"text",value}});}return true;};
 if(!exact(p->prefix,p->word.prefix)||(!p->word.suffix.empty()&&!exact(p->suffix,p->word.suffix)))return nullptr;
 // Normal source views must retain the exact small/large spelling individually.
 for(const auto& b:p->glyphs)for(int scale:{1,2}){const auto value=read(b,scale,false);if(ocr_characters(value,false)!=std::vector<uint32_t>{p->word.character})return nullptr;evidence.push_back({{"bbox",b},{"scale",scale},{"inverse",false},{"text",value}});}
 // The entire repeat strip must independently contain every physical glyph.
 // Inversion may normalize small kana to large kana, but cannot change identity.
 for(int scale:{1,2})for(bool inverse:{false,true}){const auto value=read(p->run,scale,inverse);const auto chars=ocr_characters(value,false);if(chars.size()!=p->glyphs.size()||std::any_of(chars.begin(),chars.end(),[&](uint32_t c){return family(c)!=family(p->word.character);}))return nullptr;evidence.push_back({{"bbox",p->run},{"scale",scale},{"inverse",inverse},{"text",value}});}
 std::string text=p->word.prefix;for(size_t i=0;i<p->glyphs.size();i++)text+=p->word.glyph;text+=p->word.suffix;
 return {{"version",1},{"method","physical-repeat-glyph-count"},{"prior",row.at("text")},{"text",text},{"sourceBox",row.at("bbox")},{"sourceConfidence",row.at("detectorConfidence")},{"sourceQuery",repeat_columns::source(row,detected)->query},{"glyphBoxes",p->glyphs},{"addedGlyphs",1},{"readings",evidence}};
}
}
