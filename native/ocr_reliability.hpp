#pragma once
#include "ocr_dedup.hpp"
#include <functional>
#include <tuple>
namespace ocr_reliability {
struct Reading {std::string text;bool stopped;};
inline std::vector<uint32_t> signature(const std::string& text){
 auto chars=ocr_characters(text);for(auto& c:chars)if(c>='a'&&c<='z')c-=32;
 chars.erase(std::unique(chars.begin(),chars.end()),chars.end());return chars;
}
inline bool repetitive(const std::string& text){
 const auto chars=ocr_characters(text);if(chars.size()<32)return false;size_t longest=0,repeated=0;
 for(size_t i=0;i<chars.size();){size_t end=i+1;while(end<chars.size()&&chars[end]==chars[i])++end;const auto length=end-i;longest=std::max(longest,length);if(length>=5)repeated+=length;i=end;}
 return longest>=12&&repeated*5>=chars.size()*3;
}
inline bool corroborates(const std::string& original,const Reading& reading){
 if(!reading.stopped)return false;const auto a=signature(original),b=signature(reading.text);if(a.empty()||b.empty())return false;
 // Expressive long vowels and repeated glyphs can have different counts after
 // resampling. Preserve them when the non-repeated content still agrees.
 return ocr_substring_distance(a,b,false)<=std::max<size_t>(1,a.size()/7);
}
inline json proof(const json& row,const std::function<Reading(int,bool,int)>& read){
 if(row.value("type",std::string{})!="text"||row.value("ocrTruncated",false)||row.value("manual",false)||!repetitive(row.value("text",std::string{})))return nullptr;
 const auto text=row.at("text").get<std::string>();json evidence=json::array();
 for(const auto& pass:std::vector<std::tuple<int,bool,int>>{{1,false,6},{2,false,12},{1,true,12}}){
  const auto [scale,inverse,padding]=pass;const auto value=read(scale,inverse,padding);
  if(corroborates(text,value))return nullptr;
  evidence.push_back({{"scale",scale},{"inverse",inverse},{"padding",padding},{"text",value.text},{"stopped",value.stopped}});
 }
 return {{"version",1},{"method","unstable-repetitive-ocr"},{"sourceText",text},{"sourceBox",row.at("bbox")},{"readings",evidence}};
}
}
