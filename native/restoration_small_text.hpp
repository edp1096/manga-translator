#pragma once
#include "restoration_isolated.hpp"
#include "ocr_detached_columns.hpp"
inline std::vector<uint32_t> small_text_body(const std::string& text){
 auto c=ocr_characters(text,false);for(auto& value:c)if(value>=0xff01&&value<=0xff5e)value-=0xfee0;if(c.size()<2)return c;
 const std::map<uint32_t,uint32_t> pairs{{'(',')'},{'[',']'},{0xff08,0xff09},{0x300c,0x300d},{0x300e,0x300f},{0x3010,0x3011}};
 const auto it=pairs.find(c.front());if(it!=pairs.end()&&it->second==c.back())return {c.begin()+1,c.end()-1};return c;
}
inline json small_text_primary_terminal(const json& original,const json& isolated,const std::string& source){
 const auto expected=ocr_characters(source,false);if(expected.size()<4||original.size()!=4||isolated.size()!=4)return nullptr;const uint32_t last=expected.back();if(last!='!'&&last!='?'&&last!=0xff01&&last!=0xff1f)return nullptr;
 for(const auto& v:isolated)if(ocr_characters(v.get<std::string>(),false)!=expected)return nullptr;int changed=-1;
 for(size_t i=0;i<4;i++){const auto value=ocr_characters(original.at(i).get<std::string>(),false);if(value==expected)continue;if(changed>=0||value.size()!=expected.size()+1||value.back()!=last||!std::equal(expected.begin(),expected.end(),value.begin()))return nullptr;changed=int(i);}
 return changed<0?json{}:json{{"method","repeated-terminal-punctuation"},{"originalIndex",changed}};
}
inline json small_text_primary_brackets(const json& original,const json& isolated,const std::string& source){
 const auto expected=ocr_characters(source,false),body=small_text_body(source);
 if(expected.size()!=body.size()+2||body.size()<4||original.size()!=4||isolated.size()!=4)return nullptr;
 for(const auto& t:isolated)if(ocr_characters(t.get<std::string>(),false)!=expected)return nullptr;
 int changed=-1;
 for(size_t i=0;i<4;i++){auto value=ocr_characters(original.at(i).get<std::string>(),false);if(value==expected)continue;if(changed>=0)return nullptr;changed=int(i);
  auto opening=[](uint32_t c){return c=='('||c=='['||c==0xff08||c==0x300c||c==0x300e||c==0x3010;};
  auto closing=[](uint32_t c){return c==')'||c==']'||c==0xff09||c==0x300d||c==0x300f||c==0x3011;};
  if(!value.empty()&&opening(value.front()))value.erase(value.begin());if(!value.empty()&&closing(value.back()))value.pop_back();if(value!=body)return nullptr;
 }
 return changed<0?json{}:json{{"method","paired-bracket-variant"},{"originalIndex",changed}};
}
// Brackets touching a balloon/music symbol may decode differently. Every
// view must retain the complete body; an original view anchors the wrappers.
inline json small_text_wrapper_consensus(const json& original,const json& isolated,const std::string& source){
 const auto expected=ocr_characters(source,false),body=small_text_body(source);
 if(expected.size()!=body.size()+2||body.size()<4||original.size()!=4||isolated.size()!=4)return nullptr;
 auto unwrap=[](std::vector<uint32_t> c){
  if(!c.empty()&&(c.front()=='('||c.front()=='['||c.front()==0xff08||c.front()==0x300c||c.front()==0x300e||c.front()==0x3010))c.erase(c.begin());
  if(!c.empty()&&(c.back()==')'||c.back()==']'||c.back()==0xff09||c.back()==0x300d||c.back()==0x300f||c.back()==0x3011))c.pop_back();return c;
 };
 int anchors=0;for(const auto& v:original){auto c=ocr_characters(v.get<std::string>(),false);anchors+=c==expected;if(unwrap(c)!=body)return nullptr;}
 if(!anchors)return nullptr;const auto isolatedChars=ocr_characters(isolated.at(0).get<std::string>(),false);
 for(const auto& v:isolated){auto c=ocr_characters(v.get<std::string>(),false);if(c!=isolatedChars||unwrap(c)!=body)return nullptr;}
 return {{"method","anchored-wrapper-consensus"}};
}
inline bool small_text_terminal_punctuation(const json& original,const json& isolated,const std::vector<uint32_t>& expected){
 if(expected.size()<5||original.size()!=4||isolated.size()!=4)return false;
 const auto last=expected.back();if(last!=','&&last!='.'&&last!=0x3001&&last!=0x3002)return false;
 const std::vector<uint32_t> prefix(expected.begin(),expected.end()-1);
 for(const auto& list:std::array<json,2>{original,isolated})for(const auto& v:list)if(ocr_characters(v.get<std::string>(),false)!=prefix)return false;
 return true;
}
inline bool small_text_graphic(const json& row){const auto chars=ocr_characters(row.value("text",std::string{}),false);return !chars.empty()&&chars.size()<=8&&std::all_of(chars.begin(),chars.end(),[](uint32_t c){return (c>=0x2600&&c<=0x27ff)||(c>=0x1f300&&c<=0x1faff);});}
inline bool small_text_effect_duplicate(const json& row,const json& effect){
 try{for(const auto& r:{row,effect})for(const auto* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"})if(r.value(flag,false))return false;
 const auto full=ocr_characters(row.at("text"),false),body=small_text_body(row.at("text")),part=ocr_characters(effect.at("text"),false);
 return effect.value("type",std::string{})=="effect"&&effect.value("mode",std::string{})=="tooltip"&&effect.value("detectorConfidence",0.)>=.2&&effect.value("detectorConfidence",0.)<.3&&body.size()+2==full.size()&&part.size()>=2&&part.size()<body.size()&&std::search(body.begin(),body.end(),part.begin(),part.end())!=body.end();
 }catch(const std::exception&){return false;}
}
// A second OCR engine may consistently confuse letter shapes. It verifies
// preservation only: the primary still reads the stored source exactly in all
// eight views. Require the independent engine to return the same full-length
// reading before and after isolation, in every tight-crop view.
// Independent OCR can merge adjacent glyphs into a different letter. This
// validates preservation, never edits transcription: all four paired views
// must agree before/after, three must share one bounded 2-to-1 segmentation,
// and the primary reader must still match the complete source in eight views.
inline json small_text_paired_segmentation(const json& originals,const json& isolated,const std::vector<uint32_t>& expected){
 if(expected.size()<4||expected.size()>32||originals.size()!=4||isolated.size()!=4)return nullptr;
 auto letter=[](uint32_t c){return (c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>=0x3041&&c<=0x3096)||(c>=0x30a1&&c<=0x30fa)||(c>=0x3400&&c<=0x9fff)||(c>=0xac00&&c<=0xd7a3);};
 for(size_t i=0;i<4;i++)if(small_text_body(originals.at(i))!=small_text_body(isolated.at(i)))return nullptr;
 for(const auto& text:originals){const auto reference=small_text_body(text);if(reference.size()+1!=expected.size())continue;int votes=0;bool stable=true;
  for(const auto& t:originals){const auto c=small_text_body(t);if(c==reference){votes++;continue;}if(c==expected)continue;const bool leading=c.size()==reference.size()+1&&letter(c.front())&&std::equal(reference.begin(),reference.end(),c.begin()+1);const bool trailing=c.size()==reference.size()+1&&letter(c.back())&&std::equal(reference.begin(),reference.end(),c.begin());if(!leading&&!trailing)stable=false;}
  if(!stable||votes<3)continue;
  for(size_t k=0;k+1<expected.size();k++)if(letter(expected[k])&&letter(expected[k+1])&&letter(reference[k])&&reference[k]!=expected[k]&&reference[k]!=expected[k+1]&&std::equal(expected.begin(),expected.begin()+k,reference.begin())&&std::equal(expected.begin()+k+2,expected.end(),reference.begin()+k+1))return {{"method","paired-secondary-segmentation"},{"reading",text},{"position",k}};
 }return nullptr;
}
inline std::vector<uint32_t> small_text_unframe_ellipsis(std::vector<uint32_t> c){
 size_t at=0,marks=0;while(at<c.size()&&(c[at]=='.'||c[at]==0x2026||c[at]==0x22ef)){marks+=c[at]=='.'?1:3;at++;}if(marks>=3)c.erase(c.begin(),c.begin()+at);return c;
}
inline bool small_text_ellipsis_consensus(const json& original,const json& isolated,const std::vector<uint32_t>& expected){
 if(expected.size()<6||expected.size()>32||original.size()!=4||isolated.size()!=4||small_text_unframe_ellipsis(expected)!=expected)return false;
 bool framed=false;for(const auto& t:isolated){const auto c=ocr_characters(t.get<std::string>(),false);framed|=c!=expected;if(small_text_unframe_ellipsis(c)!=expected)return false;}if(!framed)return false;
 int exact=0;for(const auto& t:original){const auto c=small_text_unframe_ellipsis(ocr_characters(t.get<std::string>(),false));if(c==expected){exact++;continue;}bool merge=false;if(c.size()+1==expected.size())for(size_t k=0;k+1<expected.size();k++){auto letter=[](uint32_t x){return (x>='A'&&x<='Z')||(x>='a'&&x<='z')||(x>=0x3041&&x<=0x3096)||(x>=0x30a1&&x<=0x30fa)||(x>=0x3400&&x<=0x9fff)||(x>=0xac00&&x<=0xd7a3);};merge|=letter(c[k])&&letter(expected[k])&&letter(expected[k+1])&&c[k]!=expected[k]&&c[k]!=expected[k+1]&&std::equal(expected.begin(),expected.begin()+k,c.begin())&&std::equal(expected.begin()+k+2,expected.end(),c.begin()+k+1);}if(!merge)return false;}return exact>=3;
}
inline json small_text_paired_reading(const json& originals,const json& isolated,const std::vector<uint32_t>& expected){
 if(originals.size()!=4||isolated.size()!=4)return nullptr;
 if(expected.size()>=4){int exactPairs=0;bool paired=true;std::set<size_t> differences;
  for(size_t i=0;i<4;i++){const auto a=small_text_body(originals.at(i).get<std::string>()),b=small_text_body(isolated.at(i).get<std::string>());if(a!=b||a.size()!=expected.size()){paired=false;break;}exactPairs+=a==expected;for(size_t k=0;k<a.size();k++)if(a[k]!=expected[k]){auto letter=[](uint32_t c){return (c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>=0x3041&&c<=0x3096)||(c>=0x30a1&&c<=0x30fa)||(c>=0x3400&&c<=0x9fff)||(c>=0xac00&&c<=0xd7a3);};if(!letter(a[k])||!letter(expected[k]))paired=false;differences.insert(k);}}
  if(paired&&exactPairs==3&&differences.size()==1)return {{"method","majority-secondary-readings"},{"reading",originals.at(0)},{"substitutions",json(differences)}};
 }
 if(expected.size()<8)return nullptr;
 const auto reference=small_text_body(originals.at(0).get<std::string>());if(reference.size()!=expected.size())return nullptr;
 json changed=json::array();for(size_t i=0;i<expected.size();i++)if(reference[i]!=expected[i]){
  auto punctuation=[](uint32_t c){return c<=0x20||(c<128&&!std::isalpha(static_cast<unsigned char>(c)))||(c>=0x2000&&c<=0x303f)||(c>=0xff00&&c<=0xff20)||(c>=0xff3b&&c<=0xff40)||(c>=0xff5b&&c<=0xff65);};
  if(punctuation(reference[i])||punctuation(expected[i]))return nullptr;changed.push_back(i);
 }
 if(changed.empty()||changed.size()>2||changed.size()*5>expected.size())return nullptr;
 bool unanimous=true;std::set<size_t> uncertain;int pairs=0;
 for(size_t i=0;i<4;i++)pairs+=small_text_body(originals.at(i).get<std::string>())==small_text_body(isolated.at(i).get<std::string>());
 for(const auto& list:std::array<json,2>{originals,isolated})for(const auto& value:list){
  if(!value.is_string())return nullptr;const auto reading=small_text_body(value.get<std::string>());if(reading.size()!=expected.size())return nullptr;unanimous&=reading==reference;
  for(size_t i=0;i<reading.size();i++)if(reading[i]!=expected[i]){
   auto letter=[](uint32_t c){return (c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>=0x3041&&c<=0x3096)||(c>=0x30a1&&c<=0x30fa)||(c>=0x3400&&c<=0x9fff)||(c>=0xac00&&c<=0xd7a3);};
   if(!letter(reading[i])||!letter(expected[i]))return nullptr;uncertain.insert(i);
  }
 }
 if(uncertain.empty()||uncertain.size()>2||uncertain.size()*5>expected.size()||pairs<2)return nullptr;
 return {{"method",unanimous?"paired-secondary-reading":"bounded-secondary-readings"},{"reading",originals.at(0)},{"substitutions",json(uncertain)}};
}
inline json small_text_geometry(const std::vector<uint8_t>& bits,int side,Box box,float confidence){
 json runs=json::array();for(size_t i=0;i<bits.size();){if(!bits[i]){i++;continue;}const auto begin=i;while(i<bits.size()&&bits[i])i++;runs.push_back(begin);runs.push_back(i-begin);}return {{"width",side},{"height",side},{"bbox",box},{"confidence",confidence},{"runs",runs}};
}
template<class Read,class Verify>
inline RestorationRevalidation restoration_small_text(const PageImage& image,const PageImage& cleaned,const std::vector<Region>& detected,const json& rows,const LayoutRaw& raw,const std::function<void()>& check,Read read,Verify verify,const std::set<int>& excluded={}){
 RestorationRevalidation out;const auto originalSources=raw.mask_side>=3&&raw.mask_side<=512&&raw.logits.size()==1500&&raw.boxes.size()==1200&&raw.masks.size()==size_t(300)*raw.mask_side*raw.mask_side?decode_regions(raw,image.width,image.height):std::vector<Region>{};
 for(const auto& row:rows){
  const int id=row.value("id",-1);if(id<0||excluded.count(id)||row.value("translation",std::string{}).empty()||row.contains("ocrDuplicateGeometry")||row.value("detectorConfidence",0.)<.25||row.value("detectorConfidence",0.)>1)continue;
  const auto mode=row.value("mode",std::string{});if(mode!="tooltip"&&mode!="replace")continue;
  if(row.value("detectorConfidence",0.)>=.65&&mode!="tooltip")continue;
  auto plain=row;plain["mode"]="tooltip";
  if(row.contains("textVerification")){
   const auto& v=row.at("textVerification");
   if(!restoration_verified_text(row)||v.value("method",std::string{})!="ocr-consensus"||v.at("sources")!=json::array({row.at("bbox")}))continue;
   plain.erase("textVerification");
  }
  auto source=restoration_original_source(plain,detected,raw);if(!source)source=restoration_original_source(plain,originalSources,raw);if(!source)source=restoration_single_verified_source(row,originalSources,raw);if(!source||!restoration_box(source->box,image)||area(source->box)>int64_t(image.width)*image.height*.02)continue;
  // This is a fallback. Preserve already accepted normal masks instead of
  // replacing a complete restoration with a narrower small-label mask.
  if(mode=="tooltip"&&source->cls==0&&restoration_mask(image,*source,row,detected,rows,&raw).accepted())continue;
  const auto expected=ocr_characters(row.at("text"),false),body=small_text_body(row.at("text"));if(expected.size()<4||expected.size()>32||body.size()<2)continue;
  std::set<int> effects;std::vector<std::pair<json,const Region*>> peers;
  for(const auto& other:rows){if(other.value("type",std::string{})!="effect"||other.value("mode",std::string{})!="tooltip"||other.value("detectorConfidence",0.)<.2||other.value("detectorConfidence",0.)>=(source->cls==1||small_text_graphic(other)?.65:.3)||!overlap(expand_box(source->box,2,image.width,image.height),other.at("bbox").get<Box>()))continue;bool edited=false;for(const auto* flag:{"manual","layoutOverride","displayOverride","panelCandidate"})edited|=other.value(flag,false);if(source->cls!=1)edited|=other.value("ocrTruncated",false)||other.value("truncated",false);if(edited)continue;const Region* match=nullptr;for(const auto& r:detected)if(r.cls==1&&r.box==other.at("bbox").get<Box>()&&std::abs(r.score-other.value("detectorConfidence",0.))<.0001&&restoration_effect_matches(r,&raw)){if(match){match=nullptr;break;}match=&r;}if(match){effects.insert(other.at("id").get<int>());peers.emplace_back(other,match);}}
  auto candidate=restoration_isolated_components(image,*source,source->cls==1?row:plain,{},detected,rows,&raw,false,true,false,nullptr,&effects);
  if(!candidate.mask.accepted()){out.evidence[std::to_string(id)]={{"rejected",candidate.mask.reason},{"details",candidate.proof}};continue;}
  if(source->cls==1)candidate.proof["originalSourceClass"]=1;
  const auto& mask=candidate.mask;const int mw=mask.bounds[2]-mask.bounds[0];auto chosen=[&](int x,int y){return x>=mask.bounds[0]&&y>=mask.bounds[1]&&x<mask.bounds[2]&&y<mask.bounds[3]&&mask.pixels[size_t(y-mask.bounds[1])*mw+x-mask.bounds[0]];};
  // Already-replaced text is revisited only when the old cleaned image still
  // contains original glyph pixels. No classification or transcription changes.
  size_t remaining=0;if(mode=="replace"){
   if(cleaned.width!=image.width||cleaned.height!=image.height)continue;
   for(int y=source->box[1];y<source->box[3];y++)for(int x=source->box[0];x<source->box[2];x++){const auto p=(size_t(y)*image.width+x)*3;if(chosen(x,y)&&(int(image.rgb[p])+image.rgb[p+1]+image.rgb[p+2])/3<192&&std::equal(image.rgb.begin()+p,image.rgb.begin()+p+3,cleaned.rgb.begin()+p))remaining++;}
   if(remaining<8||remaining<candidate.proof.at("glyphPixels").get<size_t>()*.02)continue;
  }
  bool safe=true;json effectProofs=json::array();
  for(const auto& [other,effect]:peers){
   const int side=512;std::vector<uint8_t> original(side*side),retained(side*side);size_t total=0,claimed=0;
   const bool verifiedLabel=source->cls==1;
   Box b=expand_box(effect->box,1,image.width,image.height);if(verifiedLabel)b={std::min(b[0],mask.bounds[0]),std::min(b[1],mask.bounds[1]),std::max(b[2],mask.bounds[2]),std::max(b[3],mask.bounds[3])};
   for(int y=b[1];y<b[3];y++)for(int x=b[0];x<b[2];x++){const auto* p=image.rgb.data()+(size_t(y)*image.width+x)*3;if((int(p[0])+p[1]+p[2])/3>=192||(verifiedLabel&&!region_pixel(*effect,x,y,image.width,image.height)))continue;total++;const bool own=chosen(x,y);claimed+=own;for(int py=y*side/image.height;py<std::min(side,int(std::ceil((y+1.)*side/image.height)));py++)for(int px=x*side/image.width;px<std::min(side,int(std::ceil((x+1.)*side/image.width)));px++){original[py*side+px]=1;if(!own)retained[py*side+px]=1;}}
   const bool duplicate=small_text_effect_duplicate(row,other);const auto symbols=ocr_characters(other.at("text"),false);const bool symbolic=!symbols.empty()&&symbols.size()<=8&&std::all_of(symbols.begin(),symbols.end(),[](uint32_t c){return (c>=0x2600&&c<=0x27ff)||(c>=0x1f300&&c<=0x1faff);});const bool annotation=body.size()+2==expected.size();const bool whole=std::all_of(candidate.proof.at("components").begin(),candidate.proof.at("components").end(),[](const json& c){return c.value("coreSourceFraction",0.)>=.98;});if(!total||claimed>total*.5||(!duplicate&&claimed&&(!whole||(!verifiedLabel&&(!annotation||!symbolic))))){safe=false;out.evidence[std::to_string(id)]={{"rejected","small-text-effect"},{"effectId",other.at("id")},{"claimed",claimed},{"total",total}};break;}
   std::vector<uint8_t> owned(original.size());for(size_t i=0;i<owned.size();i++)owned[i]=original[i]&&!retained[i];
   effectProofs.push_back({{"verifiedLabelOverlap",verifiedLabel},{"id",other.at("id")},{"duplicateText",duplicate&&claimed>0},{"sourceText",other.at("text")},{"sourceBox",other.at("bbox")},{"confidence",effect->score},{"inkPixels",total},{"claimedPixels",claimed},{"claimedFraction",double(claimed)/total},{"original",small_text_geometry(original,side,effect->box,effect->score)},{"claimed",small_text_geometry(owned,side,effect->box,effect->score)},{"retained",small_text_geometry(retained,side,effect->box,effect->score)}});
  }
  if(!safe)continue;
  json recovery;if(row.contains("textVerification"))recovery=row.at("textVerification").value("columnRecovery",json{});
  const bool columns=!recovery.is_null()&&detached_columns::valid_proof(recovery,source->box,row.at("text"));
  json fullReadings=json::array(),columnReadings=json::array(),verifierColumns=json::array();
  auto originalRead=[&](int scale,bool inverse){
   const auto full=read(image,source->box,scale,inverse);if(!columns)return full;fullReadings.push_back(full);
   const auto chars=ocr_characters(full,false);if(chars!=expected&&chars!=ocr_characters(recovery.at("prior"),false))return std::string{};
   std::string combined;json parts=json::array();for(const auto& b:recovery.at("columns")){auto value=read(image,b.get<Box>(),scale,inverse);parts.push_back(value);combined+=value;}columnReadings.push_back(parts);return combined;
  };
  auto originalVerify=[&](int scale,bool inverse){if(!columns)return verify(image,source->box,scale,inverse);std::string combined;json parts=json::array();for(const auto& b:recovery.at("columns")){auto value=verify(image,b.get<Box>(),scale,inverse);parts.push_back(value);combined+=value;}verifierColumns.push_back(parts);return combined;};
  json original=json::array(),isolated=json::array(),secondary=json::array(),secondaryIsolated=json::array();bool exact=true;
  for(int scale:{2,3})for(bool inverse:{false,true}){check();const auto a=originalRead(scale,inverse),b=read(candidate.reading,{0,0,candidate.reading.width,candidate.reading.height},scale,inverse);original.push_back(a);isolated.push_back(b);exact&=ocr_characters(a,false)==expected&&ocr_characters(b,false)==expected;}
  // Compare at identical spatial scale before rejecting a small glyph. The
  // isolation margin otherwise shrinks the letters in the OCR input tensor.
  if(!exact&&!columns){
   const Box local{source->box[0]-mask.bounds[0],source->box[1]-mask.bounds[1],source->box[2]-mask.bounds[0],source->box[3]-mask.bounds[1]};
   PageImage antialiased=candidate.reading;for(int y=mask.bounds[1];y<mask.bounds[3];y++)for(int x=mask.bounds[0];x<mask.bounds[2];x++)if(chosen(x,y)){const auto src=(size_t(y)*image.width+x)*3,dst=(size_t(y-mask.bounds[1])*mw+x-mask.bounds[0])*3;std::copy_n(image.rgb.begin()+src,3,antialiased.rgb.begin()+dst);}
   json retryOriginal=json::array(),retryIsolated=json::array();bool retry=true;
   for(int scale:{2,3})for(bool inverse:{false,true}){check();const auto a=read(image,source->box,scale,inverse),b=read(antialiased,local,scale,inverse);retryOriginal.push_back(a);retryIsolated.push_back(b);retry&=ocr_characters(a,false)==expected&&ocr_characters(b,false)==expected;}
   if(retry){candidate.proof["primaryCrop"]={{"method","matched-source-bounds"},{"bbox",source->box}};original=retryOriginal;isolated=retryIsolated;exact=true;}
  }
  if(!exact){auto brackets=small_text_primary_brackets(original,isolated,row.at("text"));if(brackets.is_null())brackets=small_text_primary_terminal(original,isolated,row.at("text"));if(brackets.is_null())brackets=small_text_wrapper_consensus(original,isolated,row.at("text"));if(!brackets.is_null()){candidate.proof["primaryAgreement"]=brackets;exact=true;}}
  const bool ellipsisFraming=!exact&&small_text_ellipsis_consensus(original,isolated,expected);if(ellipsisFraming){exact=true;candidate.proof["primaryAgreement"]={{"method","ellipsis-framed-consensus"}};}
  auto verifiedBody=body;auto secondaryBody=[&](const std::string& t){const auto c=small_text_body(t);return ellipsisFraming?small_text_unframe_ellipsis(c):c;};json terminal=nullptr;
  if(!exact&&small_text_terminal_punctuation(original,isolated,expected)){exact=true;verifiedBody={expected.begin(),expected.end()-1};candidate.proof["terminalPunctuation"]=expected.back();}
  if(!exact&&expected.size()>=4&&(expected.back()=='-'||expected.back()==0x2014||expected.back()==0x30fc)){
   const std::vector<uint32_t> prefix(expected.begin(),expected.end()-1);bool agreement=true;for(const json& list:std::array<json,2>{original,isolated})for(const json& value:list)agreement&=ocr_characters(value.get<std::string>(),false)==prefix;
   const Box b=source->box;const double character=candidate.mask.character_size;
   if(agreement)for(const auto& c:candidate.proof.at("backgroundComponents")){const Box line=c.at("bbox");const bool vertical=b[3]-b[1]>1.5*(b[2]-b[0])&&line[1]>=b[1]+.65*(b[3]-b[1])&&line[1]<b[3]&&line[3]>=b[3]+character&&line[2]-line[0]<=character*.75;const bool horizontal=b[2]-b[0]>1.5*(b[3]-b[1])&&line[0]>=b[0]+.65*(b[2]-b[0])&&line[0]<b[2]&&line[2]>=b[2]+character&&line[3]-line[1]<=character*.75;if((vertical||horizontal)&&c.value("edge",false)&&c.value("ownedCore",0)>0){terminal={{"method","retained-terminal-boundary-stroke"},{"component",c},{"characterSize",character},{"codepoint",expected.back()}};exact=true;verifiedBody=prefix;break;}}
  }
  const bool primaryExact=exact;
  if(exact)for(int scale:{1,2})for(bool inverse:{false,true}){check();const auto a=originalVerify(scale,inverse),b=verify(candidate.reading,{0,0,candidate.reading.width,candidate.reading.height},scale,inverse);secondary.push_back(a);secondaryIsolated.push_back(b);exact&=secondaryBody(a)==verifiedBody&&secondaryBody(b)==verifiedBody;}
  // The independent recognizer resizes to a fixed square. Large isolation
  // margins shrink tiny glyphs; retain their antialiased fringe and verify
  // a tight, component-derived crop at both 2x and 3x instead.
  for(int padding:{1,0})if(primaryExact&&!exact&&!columns){
   Box tight{image.width,image.height,0,0};for(const auto& c:candidate.proof.at("components")){const Box b=c.at("bbox");tight={std::min(tight[0],b[0]),std::min(tight[1],b[1]),std::max(tight[2],b[2]),std::max(tight[3],b[3])};}
   tight=expand_box(tight,padding,image.width,image.height);const Box local{tight[0]-mask.bounds[0],tight[1]-mask.bounds[1],tight[2]-mask.bounds[0],tight[3]-mask.bounds[1]};
   PageImage antialiased=candidate.reading;for(int y=mask.bounds[1];y<mask.bounds[3];y++)for(int x=mask.bounds[0];x<mask.bounds[2];x++)if(chosen(x,y)){const auto sourcePixel=(size_t(y)*image.width+x)*3,dest=(size_t(y-mask.bounds[1])*mw+x-mask.bounds[0])*3;std::copy_n(image.rgb.begin()+sourcePixel,3,antialiased.rgb.begin()+dest);}
   json retryOriginal=json::array(),retryIsolated=json::array();bool retry=true;
   for(int scale:{2,3})for(bool inverse:{false,true}){check();const auto a=verify(image,tight,scale,inverse),b=verify(antialiased,local,scale,inverse);retryOriginal.push_back(a);retryIsolated.push_back(b);retry&=secondaryBody(a)==verifiedBody&&secondaryBody(b)==verifiedBody;}
   if(!retry){auto paired=small_text_paired_reading(retryOriginal,retryIsolated,verifiedBody);if(paired.is_null()&&std::all_of(original.begin(),original.end(),[&](const json& t){return ocr_characters(t.get<std::string>(),false)==expected;})&&std::all_of(isolated.begin(),isolated.end(),[&](const json& t){return ocr_characters(t.get<std::string>(),false)==expected;}))paired=small_text_paired_segmentation(retryOriginal,retryIsolated,verifiedBody);if(!paired.is_null()){candidate.proof["secondaryAgreement"]=std::move(paired);retry=true;}}
   if(retry){candidate.proof["verifierCrop"]={{"method","antialiased-component-bounds"},{"bbox",tight},{"padding",padding},{"scales",json::array({2,3})}};secondary=retryOriginal;secondaryIsolated=retryIsolated;exact=true;}
   else {candidate.proof["verifierCropRejected"]={{"original",retryOriginal},{"isolated",retryIsolated}};}
  }
  if(!exact){out.evidence[std::to_string(id)]={{"rejected","small-text-reading-disagreement"},{"original",original},{"isolated",isolated},{"verifier",secondary},{"verifierIsolated",secondaryIsolated},{"retry",candidate.proof.value("verifierCropRejected",json{})}};continue;}
  if(columns)candidate.proof["columnReading"]={{"recovery",recovery},{"fullReadings",fullReadings},{"originalColumns",columnReadings},{"verifierColumns",verifierColumns}};
  if(row.contains("textVerification"))candidate.proof["sourceVerification"]=row.at("textVerification");
  if(!terminal.is_null())candidate.proof["terminalStroke"]=terminal;candidate.proof["sourceMode"]=mode;candidate.proof["remainingPixels"]=remaining;candidate.proof["originalReadings"]=original;candidate.proof["isolatedReadings"]=isolated;candidate.proof["verifierReadings"]=secondary;candidate.proof["verifierIsolatedReadings"]=secondaryIsolated;candidate.proof["effects"]=effectProofs;
  out.masks.emplace(id,std::move(candidate.mask));out.evidence[std::to_string(id)]=std::move(candidate.proof);
 }
 return out;
}
