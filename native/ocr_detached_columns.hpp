#pragma once
#include "name_reading.hpp"
#include "ocr_dedup.hpp"
#include <optional>

namespace detached_columns {
struct Plan {std::vector<Box> columns;PageImage isolated;};
// Remove whole edge-connected contours only in a temporary OCR view. This
// never authorizes erasure and never cuts a connected stroke into a letter.
inline std::optional<Plan> plan(const PageImage& image,Box box,const std::string& prior){
 const auto chars=ocr_characters(prior,false);const int bw=box[2]-box[0],bh=box[3]-box[1];
 if(chars.size()<4||chars.size()>16||bw<24||bh<bw*1.5||bh>bw*6||box[0]<0||box[1]<0||box[2]>image.width||box[3]>image.height||area(box)>int64_t(image.width)*image.height*.01)return {};
 const auto bounds=expand_box(box,bw,image.width,image.height);const int w=bounds[2]-bounds[0],h=bounds[3]-bounds[1];std::vector<uint8_t> seen(size_t(w)*h);std::vector<std::vector<int>> parts;std::vector<Box> boxes;
 auto dark=[&](int p){const auto i=(size_t(p/w+bounds[1])*image.width+p%w+bounds[0])*3;return (int(image.rgb[i])+image.rgb[i+1]+image.rgb[i+2])/3<192;};
 for(int start=0;start<w*h;start++){
  if(seen[start]||!dark(start))continue;std::vector<int> pixels{start};seen[start]=1;bool edge=false;size_t owned=0;Box b{bounds[2],bounds[3],bounds[0],bounds[1]};
  for(size_t i=0;i<pixels.size();i++){const int p=pixels[i],x=p%w,y=p/w,gx=x+bounds[0],gy=y+bounds[1];edge|=x==0||y==0||x==w-1||y==h-1;owned+=gx>=box[0]&&gx<box[2]&&gy>=box[1]&&gy<box[3];b={std::min(b[0],gx),std::min(b[1],gy),std::max(b[2],gx+1),std::max(b[3],gy+1)};
   for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){const int nx=x+dx,ny=y+dy,n=ny*w+nx;if(nx<0||ny<0||nx>=w||ny>=h||seen[n]||!dark(n))continue;seen[n]=1;pixels.push_back(n);}
  }
  if(edge||owned*2<pixels.size())continue;
  // All selected components must fit wholly within the source detection.
  if(overlap(b,box)!=area(b))return {};boxes.push_back(b);parts.push_back(std::move(pixels));
 }
 if(boxes.size()<4||boxes.size()>128)return {};
 std::vector<bool> occupied(bw);for(const auto& b:boxes)for(int x=b[0];x<b[2];x++)occupied[x-box[0]]=true;
 std::vector<Box> columns;int begin=-1;for(int x=0;x<=bw;x++){
  if(x<bw&&occupied[x]){if(begin<0)begin=x;continue;}if(begin<0)continue;
  int end=x;while(end<bw&&!occupied[end])end++;
  if(end<bw&&end-x<2)continue;
  Box column{box[0]+begin,box[3],box[0]+x,box[1]};for(const auto& b:boxes)if(b[0]>=column[0]&&b[2]<=column[2]){column[1]=std::min(column[1],b[1]);column[3]=std::max(column[3],b[3]);}
  if(column[2]-column[0]<6||column[3]-column[1]<(column[2]-column[0])*1.5)return {};columns.push_back(column);begin=-1;
 }
 if(columns.size()!=2||columns[1][1]>columns[0][1]+bw*.3)return {};
 // This repair restores a short leading column while leaving the longer
 // trailing column exactly as previously recognized.
 if(columns[1][3]-columns[1][1]>(columns[0][3]-columns[0][1])*.75)return {};
 Plan result;result.columns={columns[1],columns[0]};result.isolated={w,h,std::vector<uint8_t>(size_t(w)*h*3,255)};
 for(const auto& part:parts)for(int p:part){const int x=p%w,y=p/w;const auto src=(size_t(y+bounds[1])*image.width+x+bounds[0])*3,dst=(size_t(y)*w+x)*3;std::copy_n(image.rgb.begin()+src,3,result.isolated.rgb.begin()+dst);}
 return result;
}
inline bool valid_proof(const json& proof,Box box,const std::string& text){
 try{
  if(proof.value("version",0)!=1||proof.value("method",std::string{})!="detached-leading-column"||proof.at("sourceBox")!=box||proof.at("text")!=text)return false;
  const auto& columns=proof.at("columns");const auto& readings=proof.at("readings");if(columns.size()!=2||readings.size()!=2)return false;
  const Box right=columns[0],left=columns[1];for(const auto& b:{right,left})if(area(b)<=0||overlap(b,box)!=area(b))return false;if(left[2]+2>right[0])return false;
  std::string full;for(size_t i=0;i<2;i++){if(!readings[i].is_array()||readings[i].size()!=4)return false;const std::string value=readings[i][0];if(ocr_characters(value,false).size()<2)return false;for(const auto& r:readings[i])if(ocr_characters(r.get<std::string>(),false)!=ocr_characters(value,false))return false;full+=value;}
  const auto prior=ocr_characters(proof.at("prior"),false),complete=ocr_characters(text,false);if(prior.size()<4||prior.size()>16||complete.size()<prior.size()+2||complete.size()>prior.size()+4||!std::equal(prior.rbegin(),prior.rend(),complete.rbegin())||ocr_characters(full,false)!=complete)return false;
  const auto& isolated=proof.at("isolatedReadings");return isolated.is_array()&&isolated.size()==4&&std::all_of(isolated.begin(),isolated.end(),[&](const json& r){return ocr_characters(r.get<std::string>(),false)==complete;});
 }catch(const json::exception&){return false;}
}
template<class Read> inline json correction(const PageImage& image,Box box,const std::string& prior,Read read){
 auto p=plan(image,box,prior);if(!p)return nullptr;json readings=json::array();std::string combined;const auto old=ocr_characters(prior,false);
 for(const auto& b:p->columns){json values=json::array();std::string text;for(int scale:{1,2})for(bool inverse:{false,true}){const auto value=read(image,b,scale,inverse);if(text.empty())text=value;else if(ocr_characters(text,false)!=ocr_characters(value,false))return nullptr;values.push_back(value);}const auto chars=ocr_characters(text,false);if(chars.size()<2||chars.size()>16)return nullptr;combined+=text;readings.push_back(values);}
 const auto complete=ocr_characters(combined,false);if(complete.size()<old.size()+2||complete.size()>old.size()+4||!std::equal(old.rbegin(),old.rend(),complete.rbegin()))return nullptr;
 json isolated=json::array();for(int scale:{2,3})for(bool inverse:{false,true}){const auto value=read(p->isolated,{0,0,p->isolated.width,p->isolated.height},scale,inverse);if(ocr_characters(value,false)!=complete)return nullptr;isolated.push_back(value);}
 return {{"version",1},{"method","detached-leading-column"},{"sourceBox",box},{"prior",prior},{"text",combined},{"columns",p->columns},{"readings",readings},{"isolatedReadings",isolated}};
}
}
