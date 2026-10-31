#pragma once
#include <functional>
#include "name_reading.hpp"
#include "layout_refinement.hpp"
#include "ocr_dedup.hpp"

inline bool narrow_annotation_box(const Box& b,const Box& parent){
 const int width=parent[2]-parent[0],height=parent[3]-parent[1],bw=b[2]-b[0],bh=b[3]-b[1];
 return width>=24&&height>=width*1.8&&bw>=3&&bw<=width*.25&&bh>=bw*2&&bh<=height*.8&&b[0]>=parent[0]+width*.65&&b[1]>=parent[1]&&b[2]<=parent[2]&&b[3]<=parent[3];
}
inline bool annotation_readings_agree(const std::vector<std::string>& readings){
 if(readings.size()!=6)return false;const auto first=ocr_characters(readings.front(),false);if(first.size()<8)return false;
 return std::all_of(readings.begin(),readings.end(),[&](const std::string& text){return ocr_characters(text,false)==first;});
}
// OCR scratch preprocessing only. Never alter the saved image or erasure mask.
template<class EngineType>
inline json annotation_main_reading(const PageImage& image,Box box,const fs::path& scratch,EngineType& engine,OnnxLayout& detector,const std::function<void()>& check={}){
 if(box[0]<0||box[1]<0||box[2]>image.width||box[3]>image.height||box[2]-box[0]<24||box[3]-box[1]<(box[2]-box[0])*1.8||area(box)>int64_t(image.width)*image.height*.08)return nullptr;
 auto detect=[&](double padding){if(check)check();const auto bounds=expand_box(box,std::max(2,int((box[2]-box[0])*padding)),image.width,image.height);auto crop=name_crop(image,bounds);auto input=layout_input(crop,false,false,detector.input_side());auto rows=decode_regions(detector.run(input),crop.width,crop.height);std::vector<Box> candidates;for(const auto&r:rows){if(r.cls!=0)continue;const auto b=project_region(r,bounds,image.width,image.height,192).box;if(narrow_annotation_box(b,box))candidates.push_back(b);}return candidates;};
 const auto first=detect(.08),second=detect(.25);std::vector<Box> candidates;
 for(const auto& b:first)if(std::any_of(second.begin(),second.end(),[&](Box other){return box_similarity(b,other)>=.8;}))candidates.push_back(b);
 if(candidates.empty()||candidates.size()>2)return nullptr;
 auto read=[&](const PageImage& source,Box bounds,int scale,bool inverse){if(check)check();auto crop=name_crop(source,bounds,scale,12);if(inverse)for(auto&v:crop.rgb)v=255-v;crop_ppm(scratch,crop,{0,0,crop.width,crop.height});const auto result=engine.run(scratch,64);return result.stopped?engine.tokenizer.decode(result.ids):std::string{};};
 std::vector<std::string> readings{read(image,box,1,false),read(image,box,1,true)};
 if(ocr_characters(readings[0],false).size()<8||ocr_characters(readings[0],false)!=ocr_characters(readings[1],false))return nullptr;
 auto masked=image;json annotations=json::array();
 for(const auto& b:candidates){const auto text=read(image,b,1,false),inverse=read(image,b,1,true);if(!kana_reading(text)||!kana_reading(inverse)||ocr_characters(text,false)!=ocr_characters(inverse,false))return nullptr;annotations.push_back({{"bbox",b},{"observedText",text},{"use","geometry-only"}});for(int y=b[1];y<b[3];y++)for(int x=b[0];x<b[2];x++)for(int c=0;c<3;c++)masked.rgb[(size_t(y)*image.width+x)*3+c]=255;}
 for(int method=0;method<4;method++)readings.push_back(read(masked,box,method%2?2:1,method>=2));
 if(!annotation_readings_agree(readings))return nullptr;
 return {{"text",readings[2]},{"annotations",annotations},{"method","annotation-separated-consensus"},{"originalReadings",json::array({readings[0],readings[1]})},{"maskedReadings",json::array({readings[2],readings[3],readings[4],readings[5]})}};
}
