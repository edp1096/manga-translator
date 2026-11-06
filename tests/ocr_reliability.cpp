#include "../native/ocr_reliability.hpp"
#include <cassert>
int main(){
 const auto row=[](std::string text){return json{{"id",1},{"type","text"},{"text",text},{"bbox",{1,2,30,40}}};};
 auto rejected=[](int,bool,int){return ocr_reliability::Reading{"different arbitrary OCR strings",true};};
 int calls=0;auto count=[&](int s,bool i,int p){calls++;return rejected(s,i,p);};
 assert(ocr_reliability::proof(row("普通の文章を正しく読む"),count).is_null()&&calls==0);
 const auto expressive=row("あああああああああああああああああああああああああああああああああああ");
 assert(ocr_reliability::repetitive(expressive.at("text")));
 assert(ocr_reliability::proof(expressive,[](int,bool,int){return ocr_reliability::Reading{"ああああああ！",true};}).is_null());
 auto effect=expressive;effect["type"]="effect";calls=0;assert(ocr_reliability::proof(effect,count).is_null()&&calls==0);
 auto manual=expressive;manual["manual"]=true;assert(ocr_reliability::proof(manual,count).is_null()&&calls==0);
 const auto unstable=row("あそそななつつつすすすすすすすすすすすすすすすすすすすすううううううううううううううううううううううう。♡♡♡♡♡♡♡♡♡♡♡");
 auto proof=ocr_reliability::proof(unstable,count);assert(proof.is_object()&&proof.at("readings").size()==3&&calls==3&&proof.at("sourceText")==unstable.at("text"));
 auto mixed=row(std::string(40,'a')+" bbb");assert(ocr_reliability::proof(mixed,[](int,bool,int){return ocr_reliability::Reading{std::string(12,'A')+" BBB!",true};}).is_null());
 assert(ocr_reliability::corroborates("ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ",{"ㅋㅋㅋㅋㅋ",true}));
 assert(!ocr_reliability::corroborates("あああ",{"あああ",false}));
 std::cout<<"PASS selective OCR reliability checks, repeated dialogue/effects retained, crop disagreement proof and no content-based special cases\n";
}
