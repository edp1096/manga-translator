#pragma once
#include <cstddef>
#include <cstdint>
#include <string_view>
namespace utf8 {
struct Validation {size_t prefix;bool complete;bool incomplete_tail;};
// Validate scalar values, including overlong encodings, surrogates and the
// Unicode upper bound. A tokenizer token can contain only part of a scalar.
inline Validation validate(std::string_view text){
 size_t i=0;while(i<text.size()){
  const auto lead=uint8_t(text[i]);size_t length=0;
  if(lead<0x80)length=1;else if(lead>=0xc2&&lead<=0xdf)length=2;else if(lead>=0xe0&&lead<=0xef)length=3;else if(lead>=0xf0&&lead<=0xf4)length=4;else return {i,false,false};
  for(size_t n=1;n<length;++n){
   if(i+n>=text.size())return {i,false,true};const auto next=uint8_t(text[i+n]);
   if((next&0xc0)!=0x80||n==1&&((lead==0xe0&&next<0xa0)||(lead==0xed&&next>=0xa0)||(lead==0xf0&&next<0x90)||(lead==0xf4&&next>=0x90)))return {i,false,false};
  }i+=length;
 }return {i,true,false};
}
}
