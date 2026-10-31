#pragma once
#include "ocr_dedup.hpp"
#include "name_reading.hpp"
#include <array>
#include <functional>

namespace numeric_repeat {
struct Span {size_t begin,end;std::string digits,last;};
inline int digit(uint32_t c){return c>='0'&&c<='9'?int(c-'0'):c>=0xff10&&c<=0xff19?int(c-0xff10):-1;}
inline std::vector<Span> spans(const std::string& text){
 std::vector<Span> out;size_t at=0;for(auto c:codepoints(text)){size_t size=c<128?1:c<0x800?2:c<0x10000?3:4;int n=digit(c);if(n>=0){if(out.empty()||out.back().end!=at)out.push_back({at,at,{},{}});auto& s=out.back();s.end=at+size;s.digits+=char('0'+n);s.last=text.substr(at,size);}at+=size;}return out;
}
inline bool dark(const PageImage& im,int x,int y,int threshold){auto p=im.rgb.data()+(size_t(y)*im.width+x)*3;return (int(p[0])+p[1]+p[2])/3<threshold;}
inline std::vector<Box> columns(const PageImage& im,const Box& b){
 const int w=b[2]-b[0],h=b[3]-b[1];if(w<24||h<48||h<w*.8||w>1024||b[0]<0||b[1]<0||b[2]>im.width||b[3]>im.height)return {};
 std::vector<int> cuts{b[0]};int start=-1;for(int x=b[0];x<=b[2];x++){bool empty=x<b[2];if(empty)for(int y=b[1];y<b[3];y++)if(dark(im,x,y,128)){empty=false;break;}if(empty){if(start<0)start=x;continue;}if(start>=0){if(start>b[0]&&x<b[2]&&x-start>=2)cuts.push_back((start+x)/2);start=-1;}}
 cuts.push_back(b[2]);if(cuts.size()<3||cuts.size()>9)return {};std::vector<Box> out;for(size_t i=1;i<cuts.size();i++){const int width=cuts[i]-cuts[i-1];if(width<6||h<width*2)return {};out.push_back({cuts[i-1],b[1],cuts[i],b[3]});}std::reverse(out.begin(),out.end());return out;
}
inline std::vector<Box> bands(const PageImage& im,const Box& b,int threshold){
 std::vector<Box> out;int start=-1;for(int y=b[1];y<=b[3];y++){bool ink=false;if(y<b[3])for(int x=b[0];x<b[2];x++)if(dark(im,x,y,threshold)){ink=true;break;}if(ink){if(start<0)start=y;continue;}if(start<0)continue;Box g{b[2],start,b[0],y};for(int yy=start;yy<y;yy++)for(int x=b[0];x<b[2];x++)if(dark(im,x,yy,threshold)){g[0]=std::min(g[0],x);g[2]=std::max(g[2],x+1);}out.push_back(g);start=-1;}return out;
}
using Glyph=std::array<uint8_t,1024>;
inline Glyph glyph(const PageImage& im,const Box& b,int threshold){Glyph out{};for(int y=0;y<32;y++)for(int x=0;x<32;x++){int xx=b[0]+std::min(b[2]-b[0]-1,int((x+.5)*(b[2]-b[0])/32)),yy=b[1]+std::min(b[3]-b[1]-1,int((y+.5)*(b[3]-b[1])/32));out[y*32+x]=dark(im,xx,yy,threshold);}return out;}
inline double support(const Glyph& a,const Glyph& b){int total=0,shared=0;for(int y=0;y<32;y++)for(int x=0;x<32;x++)if(a[y*32+x]){total++;bool hit=false;for(int dy=-2;dy<=2;dy++)for(int dx=-2;dx<=2;dx++)if(x+dx>=0&&x+dx<32&&y+dy>=0&&y+dy<32&&b[(y+dy)*32+x+dx])hit=true;shared+=hit;}return total?double(shared)/total:0;}
inline int holes(const Glyph& g){std::array<uint8_t,1024> seen{};int total=0;for(int start=0;start<1024;start++){if(g[start]||seen[start])continue;std::vector<int> q{start};seen[start]=1;bool edge=false;for(size_t i=0;i<q.size();i++){int x=q[i]%32,y=q[i]/32;edge|=x==0||y==0||x==31||y==31;for(auto d:std::array<std::array<int,2>,4>{{{{1,0}},{{-1,0}},{{0,1}},{{0,-1}}}}){int xx=x+d[0],yy=y+d[1];if(xx<0||yy<0||xx>=32||yy>=32)continue;int n=yy*32+xx;if(!g[n]&&!seen[n]){seen[n]=1;q.push_back(n);}}}total+=!edge;}return total;}
inline bool similar(const Glyph& a,const Glyph& b){return holes(a)==holes(b)&&support(a,b)>=.98&&support(b,a)>=.98;}
inline int extra(const PageImage& im,const Box& column,const std::string& number,int threshold){
 const size_t n=number.size();if(n<3||n>12)return -1;size_t repeat=1;while(repeat<n&&number[n-1-repeat]==number.back())repeat++;if(repeat<2)return 0;
 const auto rows=bands(im,column,threshold);if(rows.size()<=n)return -1;const auto ref=rows[n-1];if(ref[2]-ref[0]<3||ref[3]-ref[1]<6)return -1;
 std::vector<double> gaps;for(size_t i=0;i<n;i++){const auto b=rows[i];if(b[2]-b[0]<3||std::abs(double(b[3]-b[1])/(ref[3]-ref[1])-1)>.2)return -1;if(i)gaps.push_back((b[1]+b[3]-rows[i-1][1]-rows[i-1][3])/2.);}
 auto sorted=gaps;std::sort(sorted.begin(),sorted.end());double gap=sorted[sorted.size()/2];if(gap<=0||std::any_of(gaps.begin(),gaps.end(),[&](double d){return std::abs(d/gap-1)>.2;}))return -1;
 const auto shape=glyph(im,ref,threshold);for(size_t i=n-repeat;i+1<n;i++)if(!similar(shape,glyph(im,rows[i],threshold)))return -1;
 int count=0;for(size_t i=n;i<rows.size();i++){const auto b=rows[i];double step=(b[1]+b[3]-rows[i-1][1]-rows[i-1][3])/2.;if(b[2]<=b[0]||b[3]<=b[1]||std::abs(double(b[2]-b[0])/(ref[2]-ref[0])-1)>.2||std::abs(double(b[3]-b[1])/(ref[3]-ref[1])-1)>.2||std::abs(step/gap-1)>.2||!similar(shape,glyph(im,b,threshold)))break;count++;}return count;
}
// Independent image evidence is necessary: repeated OCR agreement can omit a digit.
// Only numeric spans are changed; layout and all nonnumeric source bytes remain intact.
inline json correction(const PageImage& im,const Box& box,const std::string& prior,const std::function<std::string(Box,int,bool)>& read){
 const auto numbers=spans(prior);if(numbers.size()<2||numbers.size()>8||std::count_if(numbers.begin(),numbers.end(),[](const Span& n){return n.digits.size()>=3;})<2)return nullptr;
 const auto cols=columns(im,box);if(cols.empty())return nullptr;size_t index=0;json proofs=json::array();std::vector<size_t> changed;
 for(const auto& col:cols){const std::string first=read(col,1,false);if(first.empty())return nullptr;auto found=spans(first);if(found.empty()||found[0].begin!=0)continue;if(index>=numbers.size()||found.size()!=1||found[0].digits!=numbers[index].digits)return nullptr;
  // Scale and polarity must corroborate the same entire numeric-column reading.
  const auto second=read(col,2,false),inverse=read(col,1,true);if(ocr_characters(first)!=ocr_characters(second)||ocr_characters(first)!=ocr_characters(inverse))return nullptr;
  json passes=json::array();bool supported=true;for(int threshold:{80,100,128}){int n=extra(im,col,found[0].digits,threshold);passes.push_back({{"threshold",threshold},{"extraGlyphs",n}});supported&=n==1;}
  if(supported){
   // A unit such as Latin O can resemble zero. Independently read the suffix
   // after the proposed extra digit so that it cannot be consumed as a digit.
   const auto expected=ocr_characters(first.substr(found[0].end));if(expected.empty())return nullptr;
   std::vector<int> tops;for(int threshold:{80,100,128}){const auto rows=bands(im,col,threshold);if(rows.size()<=found[0].digits.size()+1)return nullptr;tops.push_back(rows[found[0].digits.size()+1][1]);}
   std::sort(tops.begin(),tops.end());if(tops.back()-tops.front()>2)return nullptr;
   const Box tail{col[0],tops[1],col[2],col[3]};json tails=json::array();
   for(const auto variant:std::array<std::pair<int,bool>,3>{{{1,false},{2,false},{1,true}}}){const auto value=read(tail,variant.first,variant.second);if(ocr_characters(value)!=expected)return nullptr;tails.push_back(value);}
   changed.push_back(index);proofs.push_back({{"span",index},{"column",col},{"reading",first},{"scaled",second},{"inverse",inverse},{"passes",passes},{"suffixBox",tail},{"suffixReadings",tails}});
  }index++;
 }
 if(index!=numbers.size()||changed.empty())return nullptr;std::string text=prior;for(auto i=changed.rbegin();i!=changed.rend();++i)text.insert(numbers[*i].end,numbers[*i].last);
 return {{"version",1},{"method","numeric-repeat-glyph-count"},{"prior",prior},{"text",text},{"bbox",box},{"columns",cols},{"proofs",proofs}};
}
}
