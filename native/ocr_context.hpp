#pragma once
#include "ocr_dedup.hpp"
#include "name_reading.hpp"

// Lexical recovery proposal, deliberately distinct from an OCR consensus.
// Integration must retain this provenance and validate the complete region.
inline json contextual_ocr_proposal(const std::string& first,const std::string& second,const Box& bounds,const json& dictionary,const json& context,bool allow_kana_confusion=false){
 const auto a=codepoints(first),b=codepoints(second);if(a.size()!=b.size()||a.size()<3||a.size()>40||!dictionary.contains("entries")||!dictionary.at("entries").is_array())return nullptr;
 auto han=[](uint32_t c){return (c>=0x3400&&c<=0x9fff)||(c>=0x20000&&c<=0x3134f);};
 size_t changed=a.size(),differences=0;for(size_t i=0;i<a.size();++i)if(a[i]!=b[i]){changed=i;++differences;}
 if(differences!=1)return nullptr;
 auto kana=[](uint32_t c){return c>=0x3041&&c<=0x30fa;};
 if(!(han(a[changed])&&han(b[changed]))&&!(allow_kana_confusion&&((han(a[changed])&&kana(b[changed]))||(kana(a[changed])&&han(b[changed])))))return nullptr;
 std::map<std::string,json> candidates;
 for(const auto& entry:dictionary.at("entries")){
  const auto source=entry.value("source",std::string{});const auto word=codepoints(source);if(word.size()<3||word.size()>8||!std::all_of(word.begin(),word.end(),han))continue;
  for(size_t start=0;start+word.size()<=a.size();++start){if(changed<start||changed>=start+word.size())continue;bool matches=true;for(size_t j=0;j<word.size();++j)if(start+j!=changed&&(word[j]!=a[start+j]||word[j]!=b[start+j]))matches=false;if(!matches)continue;
   json support;
   for(const auto& row:context){if(row.value("type",std::string{})!="text"||row.value("ocrTruncated",false)||row.value("detectorConfidence",0.)<.85||!row.contains("bbox"))continue;const auto other=row.at("bbox").get<Box>();if(area(other)<=0||overlap(bounds,other)>0||row.value("text",std::string{}).find(source)==std::string::npos)continue;support={{"id",row.at("id")},{"text",row.at("text")},{"bbox",other},{"type","text"},{"detectorConfidence",row.at("detectorConfidence")}};break;}
   if(support.is_null())continue;
   // Preserve all bytes outside the matched word, including punctuation.
   size_t byteStart=0,byteEnd=0,index=0;for(size_t p=0;p<first.size();){if(index==start)byteStart=p;if(index==start+word.size()){byteEnd=p;break;}unsigned char c=first[p];p+=c<0x80?1:c<0xe0?2:c<0xf0?3:4;++index;if(p>=first.size())byteEnd=p;}
   const auto corrected=first.substr(0,byteStart)+source+first.substr(byteEnd);candidates[corrected]={{"method","dictionary-context"},{"kanaConfusion",allow_kana_confusion},{"first",first},{"second",second},{"text",corrected},{"term",source},{"support",support}};
  }
 }
 return candidates.size()==1?candidates.begin()->second:json(nullptr);
}

inline bool valid_ocr_context(const json& row){
 try{
  const auto& v=row.at("textVerification");if(v.value("method",std::string{})!="ocr-context"||!v.contains("contextProofs")||!v.at("contextProofs").is_array()||v.at("contextProofs").empty()||v.at("contextProofs").size()>4)return false;
  for(const auto& p:v.at("contextProofs")){
   if(p.value("method",std::string{})!="dictionary-context"||p.value("preprocessing",std::string{})!="white-foreground-160"||p.at("first")!=p.at("polarity")||!kana_reading(p.at("rubyText").get<std::string>()))return false;
   const auto bounds=p.at("bounds").get<Box>(),owner=row.at("bbox").get<Box>(),main=p.at("mainBox").get<Box>(),ruby=p.at("rubyBox").get<Box>();
   if(area(bounds)<=0||double(overlap(bounds,owner))/area(bounds)<.9||area(main)<=0||area(ruby)<=0||double(overlap(main,bounds))/area(main)<.9||double(overlap(ruby,bounds))/area(ruby)<.9||overlap(owner,p.at("support").at("bbox").get<Box>())>0)return false;
   auto candidate=contextual_ocr_proposal(p.at("first"),p.at("second"),bounds,{{"entries",json::array({{{"source",p.at("term")}}})}},json::array({p.at("support")}),p.value("kanaConfusion",false));
   if(candidate.is_null()||candidate.at("text")!=p.at("text")||row.at("text").get<std::string>().find(p.at("text").get<std::string>())==std::string::npos)return false;
  }
  return true;
 }catch(const std::exception&){return false;}
}
inline bool ocr_context_sources_match(const json& row,const json& rows){
 if(!row.contains("textVerification")||row.at("textVerification").value("method",std::string{})!="ocr-context")return true;
 if(!valid_ocr_context(row))return false;
 for(const auto& proof:row.at("textVerification").at("contextProofs")){const auto& support=proof.at("support");if(std::none_of(rows.begin(),rows.end(),[&](const json& r){return r.value("id",-1)==support.value("id",-2)&&r.value("text",std::string{})==support.value("text",std::string{})&&r.contains("bbox")&&r.at("bbox")==support.at("bbox")&&r.value("detectorConfidence",0.)>=.85&&!r.value("ocrTruncated",false);} ))return false;}
 return true;
}
