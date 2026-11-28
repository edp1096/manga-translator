#pragma once
#include "common.hpp"
#include <regex>

namespace context_translation {
inline const std::string korean =
 " 일본어 만화를 한국어로 옮겨라. 일본어 어순과 조사를 그대로 옮기기보다 실제로 읽히는 짧은 한국어 대사를 써라. "
 "앞뒤 원문은 연결과 화자·청자 파악에만 사용한다. normalizedSpeech와 sentenceBoundaries가 있으면 해당 원문의 발음이나 문장 경계를 보조한다. 각각 해당 id의 분량만 반환하라. "
 "일반 대사의 です・ます는 자연스러운 한국어 존댓말로 옮겨라. 화자가 바뀌면 각 줄의 높임을 따르고, 공손한 말이라는 이유만으로 격식을 지나치게 높이지 마라. "
 "직책과 가족 호칭, 졸린 발음과 그 말의 뜻, 자기 독백과 상대에게 하는 명령을 구분한다. 첫머리의 감탄이나 응답을 문장의 부정으로 해석하지 마라. "
 "관용구·비유·농담은 앞말에 대해 실제 전달하는 의미로 옮긴다. 행위, 긍정과 부정, 숫자, 조건, 이미 확인된 이름과 용어를 유지하라. "
 "이어지는 두 문장이 OCR에서 붙어 있으면 각각의 서술어를 찾아 문장 경계를 살려라. 앞 문장을 다음 기술명의 일부로 합치지 마라. 한국어에서 잘 안 쓰는 한자 말은 쉬운 말로 풀어 써라. \"~처럼 말하네\"라는 비유가 앞말을 받고 있으면 비교 대상과 비유를 같이 살려라. 원문에 없는 영어 괄호·감정·설명을 붙이지 마라.";

inline bool ends_with(const std::string& text,const std::string& tail) {
 return text.size()>=tail.size()&&text.compare(text.size()-tail.size(),tail.size(),tail)==0;
}
inline std::string trim_tail(std::string text) {
 for(bool removed=true;removed;){
  removed=false;
  for(const std::string tail:{" ","!","?","。","！","？","…",".","っ","ッ","ぁ","〜"})if(ends_with(text,tail)){
   text.resize(text.size()-tail.size());removed=true;break;
  }
 }
 return text;
}
// These are explicit sentence endings, not a general Japanese polarity parser.
inline std::string polarity(const std::string& source) {
 const auto text=trim_tail(source);
 if(ends_with(text,"んじゃい")){
  const auto clause=text.substr(0,text.size()-std::string("んじゃい").size());
  if(ends_with(clause,"ない")||ends_with(clause,"なかった"))return "negative";
  return "affirmative";
 }
 // Invitations such as しませんか are not statements of negation.
 if(source.find('?')!=std::string::npos||source.find("？")!=std::string::npos)return {};
 if(text.find("まひぇん")!=std::string::npos)return "negative";
 for(const std::string suffix:{"ません","まひぇん","なかった","じゃない","ではない","ていない","てない","れない","なかったです"})
  if(ends_with(text,suffix))return "negative";
 return {};
}
inline bool korean_negative(std::string text) {
 for(const std::string prefix:{"아니,","아니.","아니 "})if(text.rfind(prefix,0)==0){text.erase(0,prefix.size());break;}
 for(const std::string part:{"아니야","아니에","아닙니","아니다","아닌","않","없","안 ","못 ","말고","아냐","아닐"})
  if(text.find(part)!=std::string::npos)return true;
 return false;
}
inline bool reversed(const std::string& hint,const std::string& translation) {
 return !hint.empty()&&(hint=="negative")!=korean_negative(translation);
}
inline std::string spoken_reading(std::string raw) {
 const std::string distorted="まひぇん";
 const auto at=raw.find(distorted);
 if(at==std::string::npos)return {};
 raw.replace(at,distorted.size(),"ません");
 return raw;
}
inline std::string normalized_term_boundary(std::string source,const json& names) {
 for(const auto& term:names){
  const auto token=term.at("original").get<std::string>()+"とは";
  const auto at=source.find(token);
  if(at==std::string::npos||at==0)continue;
  const auto head=source.substr(0,at);
  if(head.find("は")==std::string::npos)continue;
  for(const std::string end:{"する","なる","含む","だ","です","いく","いった"})if(ends_with(head,end)){
   source.insert(at,"。");return source;
  }
 }
 return {};
}
inline bool added_latin_note(const std::string& source,const std::string& translation,const json& names) {
 static const std::regex note(R"((?:\(|（)[ \t]*([A-Za-z][A-Za-z0-9 .'_-]{1,70})[ \t]*(?:\)|）))");
 for(auto i=std::sregex_iterator(translation.begin(),translation.end(),note);i!=std::sregex_iterator();++i){
  const auto text=i->str(1);
  if(source.find(text)==std::string::npos&&std::none_of(names.begin(),names.end(),[&](const json& approved){
    return approved.value("required",std::string{}).find(text)!=std::string::npos;
  }))return true;
 }
 return false;
}
inline bool ending_only(const std::string& before,const std::string& after) {
 const auto a=codepoints(before),b=codepoints(after);
 size_t same=0;
 while(same<std::min(a.size(),b.size())&&a[same]==b[same])++same;
 return same>=5&&a.size()-same<=4&&b.size()-same<=4;
}
inline std::string neighbor(const json& row) {
 auto text=row.value("text",std::string{});
 return text.size()<=330?text:std::string{};
}
inline json reference_lines(const std::vector<json>& ordered,const json& batch) {
 std::set<std::string> targets;
 for(const auto& row:batch)targets.insert(row.at("id").get<std::string>());
 json result=json::array();
 for(size_t i=0;i<ordered.size()&&result.size()<4;++i){
  if(targets.count(ordered[i].at("id").get<std::string>()))continue;
  const bool nearby=(i>0&&targets.count(ordered[i-1].at("id").get<std::string>()))||
                    (i+1<ordered.size()&&targets.count(ordered[i+1].at("id").get<std::string>()));
  if(!nearby)continue;
  const auto text=neighbor(ordered[i]);
  if(!text.empty())result.push_back(text);
 }
 return result;
}
inline std::vector<uint32_t> dialogue_letters(const std::string& text) {
 std::vector<uint32_t> letters;
 for(auto cp:codepoints(text)){
  if((cp>=0x3041&&cp<=0x30ff)||(cp>=0x3400&&cp<=0x9fff)||(cp>=0xac00&&cp<=0xd7a3)||
     (cp>='0'&&cp<='9')||(cp>='a'&&cp<='z')||(cp>='A'&&cp<='Z'))
   letters.push_back(cp>='A'&&cp<='Z'?cp-'A'+'a':cp);
 }
 return letters;
}
inline std::set<std::string> repeated_dialogue(const std::vector<json>& rows,const json& translations) {
 using Letters=std::vector<uint32_t>;
 std::map<Letters,std::vector<std::pair<std::string,Letters>>> groups;
 for(const auto& row:rows){
  const auto id=row.at("id").get<std::string>();
  const auto said=dialogue_letters(translations.value(id,std::string{}));
  auto source=dialogue_letters(row.at("text"));
  if(said.size()>=8&&source.size()>=5)groups[said].emplace_back(id,std::move(source));
 }
 std::set<std::string> repeated;
 for(const auto& group:groups){
  const auto& lines=group.second;
  for(size_t i=0;i<lines.size();++i)for(size_t j=i+1;j<lines.size();++j){
   const auto& a=lines[i].second;const auto& b=lines[j].second;
   if(std::search(a.begin(),a.end(),b.begin(),b.end())!=a.end()||
      std::search(b.begin(),b.end(),a.begin(),a.end())!=b.end())continue;
   repeated.insert(lines[i].first);repeated.insert(lines[j].first);
  }
 }
 return repeated;
}
inline json apply(const json& base,json& view,const json& changes){
 require(changes.is_array()&&changes.size()<=150&&base.at("regions").is_array()&&view.at("regions").is_array(),"Invalid review changes");
 std::map<int,const json*> original;
 for(const auto& row:base.at("regions"))if(row.at("id").is_number_integer())original[row.at("id").get<int>()]=&row;
 std::map<int,json*> visible;
 for(auto& row:view.at("regions"))if(row.at("id").is_number_integer())visible[row.at("id").get<int>()]=&row;
 std::set<int> seen;int applied=0,conflicts=0;
 for(const auto& change:changes){
  const int id=change.at("id");require(seen.insert(id).second,"Duplicate region");
  const auto before=change.at("before").get<std::string>(),after=change.at("translation").get<std::string>(),text=change.at("text").get<std::string>();
  require(after.find_first_not_of(" \r\n\t")!=std::string::npos&&after.size()<=3000&&text.size()<=1500&&before.size()<=3000,"Invalid reviewed translation");
  if(!original.count(id)||!visible.count(id)){++conflicts;continue;}
  auto& row=*visible.at(id);const auto& prior=*original.at(id);
  const auto current=row.value("translation",std::string{});
  const auto marker=[&](const char* field){const auto m=row.find(field);return m!=row.end()&&m->is_object()&&m->value("after",std::string{})==current;};
  if(row.value("manual",false)||row.value("textEdited",false)||row.contains("manualRecognition")||text!=prior.at("text")||text!=row.at("text")||current!=before||
     (current!=prior.at("translation")&&!marker("contextEdit")&&!marker("nameEdit"))){++conflicts;continue;}
  row["contextEdit"]={{"before",before},{"after",after}};row["translation"]=after;++applied;
  // A name-only edit encoded the earlier text; a later undo should not undo a contextual rewrite.
  row.erase("nameEdit");
  if(view.contains("forcedRestorations")&&view.at("forcedRestorations").is_object())view["forcedRestorations"].erase(std::to_string(id));
 }
 return {{"applied",applied},{"conflicts",conflicts}};
}
inline json fields(std::initializer_list<const char*> names) {
 json required=json::array(),properties=json::object();
 for(const auto* name:names){required.push_back(name);properties[name]={{"type","string"}};}
 return {{"type","object"},{"properties",properties},{"required",required},{"additionalProperties",false}};
}
}
