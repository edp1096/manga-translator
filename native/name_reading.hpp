#pragma once
#include "image_ops.hpp"

inline PageImage name_crop(const PageImage& image,const Box& bounds,int scale=1,int padding=0){
 const int width=bounds[2]-bounds[0],height=bounds[3]-bounds[1];require(width>0&&height>0,"Invalid name crop");
 std::vector<uint8_t> pixels(size_t(width)*height*3);
 for(int row=0;row<height;++row)std::copy_n(image.rgb.data()+(size_t(bounds[1]+row)*image.width+bounds[0])*3,size_t(width)*3,pixels.data()+size_t(row)*width*3);
 if(scale>1)pixels=resize_rgb(pixels.data(),width,height,width*scale,height*scale);
 PageImage crop{width*scale+padding*2,height*scale+padding*2,{}};crop.rgb.assign(size_t(crop.width)*crop.height*3,255);
 for(int row=0;row<height*scale;++row)std::copy_n(pixels.data()+size_t(row)*width*scale*3,size_t(width)*scale*3,crop.rgb.data()+(size_t(row+padding)*crop.width+padding)*3);
 return crop;
}

inline std::string name_preview(const PageImage& image,const Box& box){
 const auto bounds=expand_box(box,8,image.width,image.height);const int scale=std::clamp(600/std::max(bounds[2]-bounds[0],bounds[3]-bounds[1]),1,8);auto crop=name_crop(image,bounds,scale);
 if(std::max(crop.width,crop.height)>600){const double ratio=600.0/std::max(crop.width,crop.height);const int width=std::max(1,int(crop.width*ratio)),height=std::max(1,int(crop.height*ratio));crop.rgb=resize_rgb(crop.rgb.data(),crop.width,crop.height,width,height);crop.width=width;crop.height=height;}
 std::vector<uint8_t> encoded;auto callback=[](void* context,void* data,int length){auto& bytes=*static_cast<std::vector<uint8_t>*>(context);const auto first=static_cast<const uint8_t*>(data);bytes.insert(bytes.end(),first,first+length);};
 require(stbi_write_png_to_func(callback,&encoded,crop.width,crop.height,3,crop.rgb.data(),crop.width*3)!=0,"Cannot encode name preview");
 const std::string alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";std::string output="data:image/png;base64,";
 for(size_t offset=0;offset<encoded.size();offset+=3){const uint32_t value=(uint32_t(encoded[offset])<<16)|(offset+1<encoded.size()?uint32_t(encoded[offset+1])<<8:0)|(offset+2<encoded.size()?encoded[offset+2]:0);output+=alphabet[(value>>18)&63];output+=alphabet[(value>>12)&63];output+=offset+1<encoded.size()?alphabet[(value>>6)&63]:'=';output+=offset+2<encoded.size()?alphabet[value&63]:'=';}
 return output;
}

inline std::vector<Box> ruby_candidates(const PageImage& image,const Box& box){
 const int width=box[2]-box[0],height=box[3]-box[1];if(width<8||height<12)return {};
 const bool vertical=height>width*1.2;const int across=vertical?width:height,along=vertical?height:width;
 std::vector<int> ink(across);
 for(int outer=0;outer<across;++outer)for(int inner=0;inner<along;++inner){const int column=box[0]+(vertical?outer:inner),row=box[1]+(vertical?inner:outer);const size_t offset=(size_t(row)*image.width+column)*3;ink[outer]+=std::max({image.rgb[offset],image.rgb[offset+1],image.rgb[offset+2]})<100;}
 int split=-1;double best=1e30;
 const int start=vertical?int(across*.45):int(across*.15),finish=vertical?int(across*.85):int(across*.55);
 for(int position=std::max(2,start);position<std::min(across-2,finish);++position){const double value=ink[position]+.3*ink[position-1]+.3*ink[position+1];if(value<best){best=value;split=position;}}
 if(split<0||ink[split]>std::max(1,int(along*.04)))return {};
 Box candidate=box;if(vertical)candidate[0]=box[0]+split+1;else candidate[3]=box[1]+split;
 const int small=vertical?candidate[2]-candidate[0]:candidate[3]-candidate[1];
 if(small<3||small>across*.55)return {};
 size_t pixels=0;for(int row=candidate[1];row<candidate[3];++row)for(int column=candidate[0];column<candidate[2];++column){const size_t offset=(size_t(row)*image.width+column)*3;pixels+=std::max({image.rgb[offset],image.rgb[offset+1],image.rgb[offset+2]})<100;}
 if(pixels<6||double(pixels)/area(candidate)>.65)return {};
 return {candidate};
}

inline bool kana_reading(const std::string& text){
 size_t letters=0;
 for(size_t position=0;position<text.size();){const auto first=static_cast<unsigned char>(text[position++]);uint32_t value=first;int continuation=0;if(first>=0xf0){value=first&7;continuation=3;}else if(first>=0xe0){value=first&15;continuation=2;}else if(first>=0xc0){value=first&31;continuation=1;}for(int index=0;index<continuation;++index){if(position>=text.size())return false;const auto next=static_cast<unsigned char>(text[position++]);if((next&0xc0)!=0x80)return false;value=(value<<6)|(next&63);}if(value>=0x3041&&value<=0x30ff){++letters;continue;}if(value==' '||value=='\n'||value==0x3000)continue;return false;}
 return letters>=2&&letters<=50;
}
