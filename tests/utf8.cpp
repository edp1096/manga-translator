#include "../native/common.hpp"
#include <cassert>
int main(){
 for(const auto text:{std::string{},std::string("ASCII"),std::string("日本語 한국어 中文 ♀😀"),std::string("\xf4\x8f\xbf\xbf")})assert(utf8::validate(text).complete);
 for(const auto tail:{std::string("\xd0"),std::string("\xe3"),std::string("\xe3\x81"),std::string("\xf0\x9f\x98")}){
  const auto state=utf8::validate("正常"+tail);assert(!state.complete&&state.incomplete_tail&&state.prefix==6);
 }
 for(const auto bytes:{std::string("\x80"),std::string("\xc0\xaf"),std::string("\xe0\x80\xaf"),std::string("\xed\xa0\x80"),std::string("\xf4\x90\x80\x80"),std::string("\xf5\x80\x80\x80"),std::string("\xe3\x41")}){
  const auto state=utf8::validate("OK"+bytes);assert(!state.complete&&!state.incomplete_tail&&state.prefix==2);
  bool rejected=false;try{codepoints(bytes);}catch(...){rejected=true;}assert(rejected);
 }
 const auto file=fs::temp_directory_path()/"manga-tokenizer-utf8-test.json";{std::ofstream out(file);out<<"[]";}
 Tokenizer tokenizer(file);fs::remove(file);
 // Byte-level tokens need validation after concatenation, not per token.
 tokenizer.pieces={"A","\xe3","\x81","\x82","\xd0","\x94","\x80"};
 assert(tokenizer.decode({0,1,2,3,4,5})=="AあД");
 const auto truncated=tokenizer.decode_checked({0,1,2,3,4});
 assert(truncated.text=="Aあ"&&!truncated.complete&&truncated.incomplete_tail&&truncated.error_offset==4);
 assert(tokenizer.decode({0,1,2,3,4}).empty());
 const auto invalid=tokenizer.decode_checked({0,6,0});assert(invalid.text=="A"&&!invalid.complete&&!invalid.incomplete_tail);
 bool rejected=false;try{tokenizer.decode({999});}catch(...){rejected=true;}assert(rejected);
 std::cout<<"PASS UTF-8 scalar validation, split byte tokens, explicit incomplete output, strict verification and token bounds\n";
}
