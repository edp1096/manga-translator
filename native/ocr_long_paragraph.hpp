#pragma once
#include "ocr_repeat_columns.hpp"

namespace long_paragraph {
inline std::vector<std::array<int,2>> main_bands(const PageImage& image,Box box,int threshold){
 std::vector<std::array<int,2>> bands;int start=-1;
 for(int x=box[0];x<=box[2];x++){
  int count=0;if(x<box[2])for(int y=box[1];y<box[3];y++)count+=repeat_columns::foreground(image,x,y,threshold,false);
  if(count>=(box[3]-box[1])*.06){if(start<0)start=x;}
  else if(start>=0){if(x-start>=6)bands.push_back({start,x});start=-1;}
 }
 return bands;
}
inline std::vector<Box> columns(const PageImage& image,const json& row,const std::vector<Region>& detected){
 if(!row.value("ocrTruncated",false)||row.value("type",std::string{})!="text"||ocr_characters(row.value("text",std::string{})).size()<20)return {};
 auto eligible=row;eligible["ocrTruncated"]=false;if(!repeat_columns::eligible(eligible,image)||row.value("detectorConfidence",0.)<.5||!repeat_columns::source(row,detected))return {};
 const Box b=row.at("bbox");const int w=b[2]-b[0],h=b[3]-b[1];
 if(h<160||h>2048||w<48||w>1024||h<w||area(b)>int64_t(image.width)*image.height*.4)return {};
 const auto bands=main_bands(image,b,128);if(bands.size()<3||bands.size()>12)return {};
 for(int threshold:{80,176}){const auto other=main_bands(image,b,threshold);if(other.size()!=bands.size())return {};for(size_t i=0;i<bands.size();i++)for(int k:{0,1})if(std::abs(other[i][k]-bands[i][k])>2)return {};}
 // Columns may contain a large title beside smaller dialogue. Uniform
 // widths/spacing are not evidence of reading order; stable physical gutters
 // are. Retain the tall-column guard and all pixels in adjacent tiled crops.
 int maximum=0;for(const auto& band:bands)maximum=std::max(maximum,band[1]-band[0]);
 if(h<maximum*8)return {};
 std::vector<int> cuts{b[0]};
 for(size_t i=1;i<bands.size();i++){
  int cut=-1,best=h+1;
  const int strokeLimit=std::max(2,std::min(bands[i-1][1]-bands[i-1][0],bands[i][1]-bands[i][0])/3);
  // Ruby belongs to the main column on its left. Prefer the rightmost
  // lowest-ink gutter. Sparse short crossings (e.g. a speed line) are allowed,
  // but a glyph-sized vertical stroke or a dense bridge is not.
  for(int x=bands[i-1][1];x<bands[i][0];x++){
   int count=0,run=0,longest=0;
   for(int y=b[1];y<b[3];y++){if(repeat_columns::foreground(image,x,y,176,false)){count++;longest=std::max(longest,++run);}else run=0;}
   if(count<=std::max(2,int(h*.015))&&longest<=strokeLimit&&count<=best){best=count;cut=x;}
  }
  if(cut<0)return {};cuts.push_back(cut);
 }
 cuts.push_back(b[2]);std::vector<Box> out;
 for(size_t i=1;i<cuts.size();i++)out.push_back({cuts[i-1],b[1],cuts[i],b[3]});
 std::reverse(out.begin(),out.end());return out;
}
template<class Read> inline json recovery(const PageImage& image,const json& row,const std::vector<Region>& detected,Read read){
 const auto cols=columns(image,row,detected);if(cols.empty())return nullptr;
 json evidence=json::array();std::string recovered;
 for(const auto& b:cols){
  std::string first;json readings=json::array();
  for(const auto view:std::array<std::array<int,2>,3>{{{1,12},{2,12},{2,24}}}){const auto value=read(b,view[0],view[1]);const auto chars=ocr_characters(value,false);if(chars.size()<4||chars.size()>100)return nullptr;if(first.empty())first=value;else if(chars!=ocr_characters(first,false))return nullptr;readings.push_back(value);}
  recovered+=first;evidence.push_back({{"bbox",b},{"readings",readings}});
 }
 const auto before=ocr_characters(row.at("text")),after=ocr_characters(recovered);
 if(after.size()<=before.size()||after.size()>768||before.size()<8||!std::equal(before.begin(),before.begin()+8,after.begin()))return nullptr;
 return {{"version",1},{"method","physical-vertical-paragraph-columns"},{"prior",row.at("text")},{"text",recovered},{"sourceBox",row.at("bbox")},{"sourceConfidence",row.at("detectorConfidence")},{"columns",evidence}};
}
}
