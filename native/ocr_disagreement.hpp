#pragma once
#include "ocr_dedup.hpp"
#include <optional>
namespace ocr_disagreement {
inline bool han(uint32_t c){return (c>=0x3400&&c<=0x4dbf)||(c>=0x4e00&&c<=0x9fff);}
inline std::vector<uint32_t> chars(const std::string& s){auto v=ocr_characters(s,false);for(auto& c:v)if(c>=0xff01&&c<=0xff5e)c-=0xfee0;return v;}
inline bool eligible(const json& row){
 if(row.value("type",std::string{})!="text"||row.value("safe",true)||!row.contains("bbox")||!row.contains("detectorConfidence"))return false;
 for(auto flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})if(row.value(flag,false))return false;
 for(auto key:{"textVerification","ocrDuplicateGeometry","numericCorrection","missingKanaCorrection","glyphRepeatCorrection","repeatColumnCorrection"})if(row.contains(key))return false;
 const double s=row.at("detectorConfidence");const auto v=chars(row.value("text",std::string{}));return std::isfinite(s)&&s>=.65&&s<=1&&v.size()>=6&&v.size()<=64&&std::any_of(v.begin(),v.end(),han);
}
// Restrict disagreement to one existing Han glyph. Never repair missing text,
// change punctuation, or choose between competing whole sentences.
inline std::optional<size_t> unstable(const std::vector<std::string>& readings){
 if(readings.size()!=4)return {};const auto first=chars(readings[0]);if(first.size()<6||first.size()>64)return {};std::optional<size_t> at;std::set<uint32_t> variants;
 for(const auto& s:readings){const auto v=chars(s);if(v.size()!=first.size())return {};for(size_t i=0;i<v.size();i++)if(v[i]!=first[i]){if(!han(v[i])||!han(first[i])||(at&&*at!=i))return {};at=i;}}
 if(!at)return {};for(const auto& s:readings)variants.insert(chars(s)[*at]);return variants.size()>=3?at:std::nullopt;
}
inline json consensus(const std::vector<std::string>& primary,const std::vector<std::string>& secondary){
 const auto index=unstable(primary);if(!index||secondary.size()!=4)return nullptr;const auto a=chars(primary[0]);std::map<uint32_t,size_t> votes;
 for(const auto& s:secondary){const auto v=chars(s);if(v.size()!=a.size()||!han(v[*index]))return nullptr;for(size_t i=0;i<a.size();i++)if(i!=*index&&a[i]!=v[i])return nullptr;votes[v[*index]]++;}
 auto winner=std::max_element(votes.begin(),votes.end(),[](const auto& x,const auto& y){return x.second<y.second;});if(winner==votes.end()||winner->second<3)return nullptr;auto b=a;b[*index]=winner->first;
 for(const auto& s:primary)if(chars(s)[*index]==b[*index])return nullptr;
 std::string corrected=primary[0];size_t ordinal=0;
 for(size_t offset=0;offset<corrected.size();){const auto lead=static_cast<unsigned char>(corrected[offset]);const size_t n=lead<128?1:lead<224?2:lead<240?3:4;if(offset+n>corrected.size())return nullptr;const auto code=codepoints(corrected.substr(offset,n));if(code.size()!=1)return nullptr;if(code[0]>0x20&&code[0]!=0x3000){if(ordinal++==*index){const uint32_t c=b[*index];std::string replacement;replacement+=char(0xe0|(c>>12));replacement+=char(0x80|((c>>6)&63));replacement+=char(0x80|(c&63));corrected.replace(offset,n,replacement);break;}}offset+=n;}
 return {{"version",1},{"method","cross-ocr-single-glyph-vote"},{"prior",primary[0]},{"text",corrected},{"index",*index},{"votes",winner->second},{"primaryReadings",primary},{"secondaryReadings",secondary}};
}
}
