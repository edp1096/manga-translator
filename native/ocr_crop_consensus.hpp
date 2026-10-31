#pragma once
#include "ocr_dedup.hpp"
#include "name_reading.hpp"
#include <functional>

inline bool bounded_crop_correction(const std::string& prior,const std::string& candidate){
 const auto a=ocr_characters(prior),b=ocr_characters(candidate);
 if(a.size()<12||b.size()<12||a==b||a.size()+1<b.size()||b.size()+1<a.size())return false;
 // A tight crop must not silently drop boundary letters or whole words.
 if(a[0]!=b[0]||a[1]!=b[1]||a[a.size()-1]!=b[b.size()-1]||a[a.size()-2]!=b[b.size()-2])return false;
 auto collapsed=[](std::vector<uint32_t> chars){chars.erase(std::unique(chars.begin(),chars.end()),chars.end());return chars;};
 if(collapsed(a)==collapsed(b))return false; // Keep expressive repetitions.
 return ocr_substring_distance(a,b,false)<=2;
}
inline json crop_ocr_consensus(const PageImage& image,const Box& box,const std::string& prior,const fs::path& scratch,Engine& engine,const std::function<void()>& check){
 if(ocr_characters(prior).size()<12)return nullptr;
 auto read=[&](int scale,bool inverse){check();auto crop=name_crop(image,box,scale);if(inverse)for(auto&v:crop.rgb)v=255-v;crop_ppm(scratch,crop,{0,0,crop.width,crop.height});const auto result=engine.run(scratch,64);return result.stopped?engine.tokenizer.decode(result.ids):std::string{};};
 const auto tight=read(1,false);if(!bounded_crop_correction(prior,tight))return nullptr;
 const auto large=read(2,false),inverse=read(2,true);if(ocr_characters(tight)!=ocr_characters(large)||ocr_characters(tight)!=ocr_characters(inverse))return nullptr;
 return {{"method","crop-consensus"},{"prior",prior},{"text",tight},{"bbox",box},{"scaled",large},{"scaledInverse",inverse}};
}
