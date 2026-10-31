#pragma once
#include <optional>
#include "ocr_repeat_columns.hpp"

namespace horizontal_reading {
inline std::string trim(std::string s){const auto first=s.find_first_not_of(" \r\n\t"),last=s.find_last_not_of(" \r\n\t");return first==std::string::npos?std::string{}:s.substr(first,last-first+1);}
struct Plan {Box annotation,main;std::string priorReading,mainText;bool repeated=false;};
inline std::vector<Box> lines(const PageImage& image,Box box,int threshold){
 std::vector<Box> out;int start=-1,last=-1;const int gap=std::max(2,(box[3]-box[1])/100);
 for(int y=box[1];y<=box[3]+gap;y++){bool ink=false;if(y<box[3])for(int x=box[0];x<box[2];x++){const auto p=(size_t(y)*image.width+x)*3;if((int(image.rgb[p])+image.rgb[p+1]+image.rgb[p+2])/3<threshold){ink=true;break;}}
  if(ink){if(start<0)start=y;last=y;}else if(start>=0&&y-last>=gap){if(last-start+1<5)return {};out.push_back({box[0],start,box[2],last+1});start=-1;}
 }return out;
}
inline std::optional<Plan> plan(const PageImage& image,const json& row,const std::vector<Region>& detected){
 if(!repeat_columns::eligible(row,image)||row.value("detectorConfidence",0.)<.65||!repeat_columns::source(row,detected))return {};
 const Box box=row.at("bbox");const int w=box[2]-box[0],h=box[3]-box[1];if(w<h*1.5||h<48||area(box)>int64_t(image.width)*image.height*.08)return {};
 const auto text=row.value("text",std::string{});const auto chars=ocr_characters(text,false);bool repeated=false;
 // A loop in the small pronunciation line can consume the entire decoder output.
 // Only allow a separate recovery when at least three complete kana copies occur.
 for(size_t n=4;n<=16&&n*3<=chars.size();n++)if(std::equal(chars.begin(),chars.begin()+n,chars.begin()+n)&&std::equal(chars.begin(),chars.begin()+n,chars.begin()+2*n)&&std::all_of(chars.begin(),chars.begin()+n,[](uint32_t c){return(c>=0x3041&&c<=0x3096)||(c>=0x30a1&&c<=0x30fa);}))repeated=true;
 const auto latin=text.find_first_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz");std::string prefix,main;
 if(!repeated){if(latin==std::string::npos||latin==0)return {};prefix=trim(text.substr(0,latin));main=trim(text.substr(latin));if(!kana_reading(prefix)||std::count_if(main.begin(),main.end(),[](unsigned char c){return(c>='A'&&c<='Z')||(c>='a'&&c<='z');})<4)return {};}

 const auto a=lines(image,box,128);if(a.size()<2||a.size()>4)return {};const int ruby=a[0][3]-a[0][1],body=a[1][3]-a[1][1];if(ruby>body*.6||ruby<5||a[1][1]-a[0][3]<2||w<body*3)return {};
 for(int threshold:{80,176}){const auto b=lines(image,box,threshold);if(b.size()!=a.size())return {};for(size_t i=0;i<a.size();i++)if(double(overlap(a[i],b[i]))/std::max(area(a[i]),area(b[i]))<.8)return {};}
 return Plan{a.front(),{box[0],a[1][1],box[2],a.back()[3]},prefix,main,repeated};
}
template<class Read> inline json correction(const PageImage& image,const json& row,const std::vector<Region>& detected,Read read){
 const auto p=plan(image,row,detected);if(!p)return nullptr;json annotations=json::array(),mains=json::array();std::string reading,mainText=p->mainText;int mainAgreement=0;
 for(int scale:{1,2})for(bool inverse:{false,true}){const auto a=read(p->annotation,scale,inverse),b=read(p->main,scale,inverse);if(!kana_reading(a))return nullptr;if(reading.empty())reading=a;else if(ocr_characters(reading,false)!=ocr_characters(a,false))return nullptr;if(p->repeated){const auto mainChars=ocr_characters(b);if(std::count_if(mainChars.begin(),mainChars.end(),[](uint32_t c){return c>=0x4e00&&c<=0x9fff;})<2)return nullptr;if(mainText.empty())mainText=b;else if(ocr_characters(b)!=ocr_characters(mainText))return nullptr;}
 annotations.push_back(a);mains.push_back(b);mainAgreement+=ocr_characters(b)==ocr_characters(mainText);}
 // The larger main text must already be anchored in the full-crop result.
 // Never replace a Roman numeral or a name from a lone line OCR guess.
 if(mainAgreement<(p->repeated?4:3))return nullptr;
 if(p->repeated){const auto prior=ocr_characters(row.at("text"),false),kana=ocr_characters(reading,false);if(kana.size()<4)return nullptr;bool anchored=false;for(size_t period=kana.size();period<=kana.size()+1&&period*3<=prior.size();period++){bool same=true;for(size_t k=0;k<3;k++)for(size_t i=0;i<kana.size();i++)same&=prior[k*period+i]==kana[i];if(period>kana.size())same&=std::find(kana.begin(),kana.end(),prior[kana.size()])!=kana.end();anchored|=same;}if(!anchored)return nullptr;}
 return {{"version",1},{"method","horizontal-pronunciation-lines"},{"sourceBox",row.at("bbox")},{"prior",row.at("text")},{"text",reading+" "+mainText},{"reading",reading},{"mainText",mainText},{"recoveredPronunciationLoop",p->repeated},{"annotationBox",p->annotation},{"mainBox",p->main},{"annotationReadings",annotations},{"mainReadings",mains}};
}
}
