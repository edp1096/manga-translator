#pragma once
#include "ocr_disagreement.hpp"
// Keep a disputed reading only when another primary crop and all four
// independent OCR views support it. Limit changes to two Han glyph edits;
// kana, Latin letters and numbers remain anchors. This is not sentence repair.
namespace bounded_cross_ocr {
inline bool disputed(const std::vector<std::string>& readings){
 if(readings.size()!=4)return false;const auto a=ocr_characters(readings[0]);if(a.size()<5||a.size()>64)return false;
 return std::any_of(readings.begin()+1,readings.end(),[&](const auto& s){const auto b=ocr_characters(s);return b.size()>=5&&b!=a;});
}
inline json consensus(const std::vector<std::string>& primary,const std::vector<std::string>& secondary){
 if(!disputed(primary)||secondary.size()!=4)return nullptr;const auto prior=ocr_characters(primary[0]),winner=ocr_characters(secondary[0]);
 if(winner.size()<5||winner.size()>64||winner==prior||ocr_substring_distance(prior,winner,false)>2)return nullptr;
 if(!std::all_of(secondary.begin(),secondary.end(),[&](const auto& s){return ocr_characters(s)==winner;}))return nullptr;
 // Preserve the supporting primary reading's punctuation as well. A leading
 // horizontal stroke may be recognized as an em dash only by the verifier.
 auto anchored=[](const std::string& s){auto v=ocr_disagreement::chars(s);while(!v.empty()&&(v.front()==0x2d||(v.front()>=0x2010&&v.front()<=0x2015)||v.front()==0x2212))v.erase(v.begin());return v;};
 const auto exact=anchored(secondary[0]);
 if(!std::any_of(primary.begin()+1,primary.end(),[&](const auto& s){return anchored(s)==exact;}))return nullptr;
 auto nonhan=[](auto v){v.erase(std::remove_if(v.begin(),v.end(),ocr_disagreement::han),v.end());return v;};
 if(nonhan(prior)!=nonhan(winner)||nonhan(winner).size()<3)return nullptr;
 std::map<std::string,int> votes;for(const auto& s:secondary)votes[s]++;const auto best=std::max_element(votes.begin(),votes.end(),[](const auto&a,const auto&b){return a.second<b.second;});if(best->second<3)return nullptr;
 return {{"version",1},{"method","bounded-cross-ocr-agreement"},{"prior",primary[0]},{"text",best->first},{"primaryReadings",primary},{"secondaryReadings",secondary}};
}
}
