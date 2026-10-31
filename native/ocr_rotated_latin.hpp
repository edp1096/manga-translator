#pragma once
#include "ocr_horizontal_reading.hpp"
namespace rotated_latin {
struct Plan{Box word;size_t begin,end;std::string prior;};
inline bool ascii_letter(unsigned char c){return(c>='A'&&c<='Z')||(c>='a'&&c<='z');}
inline std::optional<Plan> plan(const PageImage& image,const json& row,const std::vector<Region>& found){
 if(!repeat_columns::eligible(row,image)||!repeat_columns::source(row,found))return {};const Box b=row.at("bbox");const int w=b[2]-b[0],h=b[3]-b[1];if(w<48||h<w*1.5||area(b)>int64_t(image.width)*image.height*.25)return {};
 const std::string text=row.at("text");size_t begin=std::string::npos,end=0;int spans=0;for(size_t i=0;i<text.size();){if(!ascii_letter(text[i])){i++;continue;}const auto a=i;while(i<text.size()&&ascii_letter(text[i]))i++;if(i-a>=4){begin=a;end=i;spans++;}}
 if(spans!=1||end-begin>24||ocr_characters(text.substr(0,begin)).size()<4||!ocr_characters(text.substr(end)).empty())return {};
 std::vector<Box> columns;int start=-1;for(int x=b[0];x<=b[2];x++){int pixels=0;if(x<b[2])for(int y=b[1];y<b[3];y++){const auto p=(size_t(y)*image.width+x)*3;pixels+=(int(image.rgb[p])+image.rgb[p+1]+image.rgb[p+2])/3<128;}if(pixels>=2){if(start<0)start=x;}else if(start>=0){columns.push_back({start,b[1],x,b[3]});start=-1;}}
 if(columns.size()<2||columns.size()>8)return {};const auto col=columns.front();const int cw=col[2]-col[0];if(cw<16||cw>w*.5||h<cw*4)return {};
 std::vector<Box> bands;start=-1;for(int y=b[1];y<=b[3];y++){int pixels=0;if(y<b[3])for(int x=col[0];x<col[2];x++){const auto p=(size_t(y)*image.width+x)*3;pixels+=(int(image.rgb[p])+image.rgb[p+1]+image.rgb[p+2])/3<128;}if(pixels>=2){if(start<0)start=y;}else if(start>=0){bands.push_back({col[0],start,col[2],y});start=-1;}}
 if(bands.size()<4)return {};while(!bands.empty()&&bands.back()[3]-bands.back()[1]<cw*.3)bands.pop_back();if(bands.empty())return {};
 const int bottom=bands.back()[3];std::vector<Box> candidates;for(const auto& band:bands){const int height=bottom-band[1];if(height>=cw*(end-begin)*.4&&height<=cw*(end-begin)*.9)candidates.push_back({col[0],band[1],col[2],bottom});}
 if(candidates.empty())return {};const double ideal=cw*(end-begin)*.65;std::sort(candidates.begin(),candidates.end(),[&](Box a,Box b){return std::abs(a[3]-a[1]-ideal)<std::abs(b[3]-b[1]-ideal);});return Plan{candidates.front(),begin,end,text.substr(begin,end-begin)};
}
inline bool bounded(const std::string& prior,const std::string& value){
 if(prior.size()<4||prior.size()!=value.size()||!std::all_of(value.begin(),value.end(),ascii_letter)||prior.front()!=value.front()||prior.back()!=value.back())return false;
 size_t changes=0;for(size_t i=0;i<prior.size();i++)changes+=prior[i]!=value[i];return changes<=2&&changes*4<=prior.size();
}
template<class Read> inline json correction(const PageImage& image,const json& row,const std::vector<Region>& found,Read read){
 const auto p=plan(image,row,found);if(!p)return nullptr;auto crop=name_crop(image,p->word);PageImage rotated{crop.height,crop.width,std::vector<uint8_t>(crop.rgb.size())};
 for(int y=0;y<crop.height;y++)for(int x=0;x<crop.width;x++)for(int c=0;c<3;c++)rotated.rgb[(size_t(crop.width-1-x)*crop.height+y)*3+c]=crop.rgb[(size_t(y)*crop.width+x)*3+c];
 json original=json::array(),readings=json::array();std::string value;for(int scale:{1,2})for(bool inverse:{false,true}){const auto text=read(rotated,{0,0,rotated.width,rotated.height},scale,inverse);if(value.empty())value=text;else if(text!=value)return nullptr;readings.push_back(text);}
 if(value==p->prior||!bounded(p->prior,value))return nullptr;int anchors=0;for(int scale:{1,2})for(bool inverse:{false,true}){const auto text=read(image,p->word,scale,inverse);if(!bounded(value,text))return nullptr;anchors+=text==value;original.push_back(text);}if(anchors<2)return nullptr;
 std::string text=row.at("text");text.replace(p->begin,p->end-p->begin,value);
 return {{"version",1},{"method","rotated-latin-suffix"},{"sourceBox",row.at("bbox")},{"wordBox",p->word},{"prior",row.at("text")},{"text",text},{"priorWord",p->prior},{"word",value},{"rotation",-90},{"readings",readings},{"originalReadings",original}};
}
}
