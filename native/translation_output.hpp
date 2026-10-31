#pragma once
#include "common.hpp"

// These are script checks, not a claim to validate a translation's meaning.
// In particular, shared Han characters in Chinese/Japanese remain permitted.
namespace translation_output {
inline bool kana(uint32_t cp){return (cp>=0x3040&&cp<=0x30ff)||(cp>=0x31f0&&cp<=0x31ff)||(cp>=0xff66&&cp<=0xff9f);}
inline bool han(uint32_t cp){return (cp>=0x3400&&cp<=0x4dbf)||(cp>=0x4e00&&cp<=0x9fff)||(cp>=0xf900&&cp<=0xfaff)||(cp>=0x20000&&cp<=0x323af);}
inline bool hangul(uint32_t cp){return (cp>=0xac00&&cp<=0xd7a3)||(cp>=0x1100&&cp<=0x11ff)||(cp>=0x3130&&cp<=0x318f);}
inline bool foreign(const std::string& text,const std::string& target){
 if(target!="Korean"&&target!="English"&&target!="Chinese"&&target!="Japanese")return false;
 for(const auto cp:codepoints(text)){
  if(target=="Korean"&&(kana(cp)||han(cp)))return true;
  if(target=="English"&&(kana(cp)||han(cp)||hangul(cp)))return true;
  if(target=="Chinese"&&(kana(cp)||hangul(cp)))return true;
  if(target=="Japanese"&&hangul(cp))return true;
 }
 return false;
}
inline std::string pattern(const std::string& target,const json& approvals=json::array()){
 // A user can explicitly approve a foreign-script name. Keep that spelling,
 // then check the rest of its sentence after decoding the model's response.
 if(approvals.is_array())for(const auto& form:approvals)if(form.is_object()&&form.contains("required")&&form.at("required").is_string()&&foreign(form.at("required"),target))return {};
 const std::string kana_ranges="ぁ-ヿㇰ-ㇿｦ-ﾟ",han_ranges="㐀-䶿一-鿿豈-﫿𠀀-𲎯",hangul_ranges="ᄀ-ᇿ㄰-㆏가-힣";
 std::string excluded;if(target=="Korean")excluded=kana_ranges+han_ranges;else if(target=="English")excluded=kana_ranges+han_ranges+hangul_ranges;else if(target=="Chinese")excluded=kana_ranges+hangul_ranges;else if(target=="Japanese")excluded=hangul_ranges;
 return excluded.empty()?std::string{}:"^[^"+excluded+"]*$";
}
inline bool valid(const std::string& translated,const std::string& target,const json& approvals=json::array()){
 auto remainder=translated;
 if(approvals.is_array())for(const auto& form:approvals)if(form.is_object()&&form.contains("required")&&form.at("required").is_string()){
  const auto approved=form.at("required").get<std::string>();if(approved.empty())continue;size_t position=0;
  while((position=remainder.find(approved,position))!=std::string::npos){remainder.replace(position,approved.size(),approved.size(),' ');position+=approved.size();}
 }
 return !foreign(remainder,target);
}
inline bool effect(const json& region){
 if(region.value("type",std::string{})!="effect")return false;
 const auto proof=region.find("textVerification");if(proof!=region.end()&&proof->is_object()){const auto role=proof->value("role",std::string{});if(role=="DIALOGUE"||role=="LABEL")return false;}
 return true;
}
}
