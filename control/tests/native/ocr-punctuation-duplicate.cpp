#include "../../../native/ocr_punctuation_duplicate.hpp"
#include "../../../native/hit_geometry.hpp"
#include <cassert>

int main(int argc,char** argv){
 assert(argc==2);const auto fixture=read_json(fs::u8path(argv[1]));const int w=fixture.at("width"),h=fixture.at("height");
 std::vector<Region> original;
 for(const auto& d:fixture.at("regions")){
  Region r{d.at("query"),d.at("cls"),d.at("score"),d.at("box").get<Box>(),{},d.at("side")};r.mask.resize(size_t(r.mask_side)*r.mask_side);
  const auto& runs=d.at("runs");for(size_t i=0;i<runs.size();i+=2)for(size_t p=runs[i].get<size_t>();p<runs[i].get<size_t>()+runs[i+1].get<size_t>();p++)r.mask.at(p)=1;original.push_back(std::move(r));
 }
 const auto base=fixture.at("rows");size_t tests=0;
 auto run=[&](json rows,std::vector<Region> regions,bool expected){auto p=ocr_punctuation_duplicate::suppress(rows,regions,w,h);if(p.size()!=size_t(expected))std::cerr<<"Failure check "<<tests<<" expected "<<expected<<" found "<<p.size()<<"\n";assert(p.size()==size_t(expected));assert(rows.size()==base.size()-size_t(expected));tests++;return std::make_pair(rows,regions);};
 auto row=[&](json& rows,int id)->json&{return *std::find_if(rows.begin(),rows.end(),[&](const json& r){return r.at("id")==id;});};
 auto actual=run(base,original,true);const auto& proof=row(actual.first,4).at("punctuationFragments").at(0);assert(proof.at("owner")==4&&proof.at("id")==6&&proof.at("pixels")==30&&proof.at("shared")==29);tests++;
 // Every other row remains byte-for-byte unchanged; the source text and bbox
 // of the owner remain unchanged, including its existing reading evidence.
 for(const auto& r:base){if(r.at("id")==6)continue;const auto found=std::find_if(actual.first.begin(),actual.first.end(),[&](const json& v){return v.at("id")==r.at("id");});assert(found!=actual.first.end());auto clean=*found;clean.erase("punctuationFragments");if(r.at("id")==4){auto before=r;before.erase("hitMask");assert(before==clean);}else assert(r==clean);tests++;}
 auto restored=original;assert(ocr_punctuation_duplicate::replay(restored,actual.first,w,h)==1);assert(restored.size()==actual.second.size());for(size_t i=0;i<restored.size();i++){assert(restored[i].box==actual.second[i].box&&restored[i].mask==actual.second[i].mask&&restored[i].score==actual.second[i].score);}tests++;
 auto hit=actual.first;attach_hit_geometry(hit,actual.second,w,h);const auto& owner=*std::find_if(hit.begin(),hit.end(),[](const json& r){return r.at("id")==4;});assert(owner.at("hitMask").at("pixels")==245);tests++;
 for(int id:{4,6})for(const char* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){auto rows=base;row(rows,id)[flag]=true;run(rows,original,false);}
 for(auto text:{"!?","!", "...","!!です","ー"}){auto rows=base;row(rows,6)["text"]=text;run(rows,original,std::string(text)=="!");}
 for(auto text:{"上等ッッ!?","上等ッッ!!あ","!!"}){auto rows=base;row(rows,4)["text"]=text;run(rows,original,false);}
 for(int id:{4,6}){auto rows=base;row(rows,id)["bbox"][0]=row(rows,id)["bbox"][0].get<int>()+1;run(rows,original,false);}
 for(int id:{4,6}){auto rows=base;row(rows,id)["detectorConfidence"]=.99;run(rows,original,false);}
 const int a=ocr_punctuation_duplicate::source(base.at(2),original),b=ocr_punctuation_duplicate::source(base.at(3),original);assert(a>=0&&b>=0);
 for(int i:{a,b}){auto ds=original;ds.push_back(ds.at(i));run(base,ds,false);}
 {auto ds=original;std::fill(ds[b].mask.begin(),ds[b].mask.end(),0);run(base,ds,false);}
 {auto ds=original;std::fill(ds[a].mask.begin(),ds[a].mask.end(),0);run(base,ds,false);}
 {auto ds=original;ds[b].mask_side=96;run(base,ds,false);}
 {auto ds=original;ds[b].cls=1;run(base,ds,false);}
 {auto ds=original;ds[a].mask[69*192+160]=1;run(base,ds,true);}
 // One shared point may jitter by one cell. A separate glyph or less than
 // 95% overlap must never be consumed by a similar text suffix.
 {auto ds=original;ds[b].mask[72*192+155]=1;run(base,ds,false);}
 {auto ds=original;ds[a].mask[69*192+155]=0;run(base,ds,false);}
 {auto ds=original;auto rows=base;ds[a].box[3]=542;row(rows,4)["bbox"][3]=542;run(rows,ds,false);}
 // A second equally eligible owner makes ownership ambiguous.
 {auto rows=base;auto extra=row(rows,4);extra["id"]=90;rows.push_back(extra);auto ds=original;auto p=ocr_punctuation_duplicate::suppress(rows,ds,w,h);assert(p.empty()&&rows.size()==base.size()+1);tests++;}
 for(const char* key:{"ownerText","ownerBox","ownerConfidence","imageWidth","imageHeight","sourceBox","sourceConfidence","ownerQuery","sourceQuery","side","pixels","shared","version","method"}){
  auto rows=actual.first;auto& p=row(rows,4)["punctuationFragments"][0];if(p[key].is_string())p[key]="stale";else if(p[key].is_array())p[key][0]=0;else p[key]=99999;auto ds=original;assert(ocr_punctuation_duplicate::replay(ds,rows,w,h)==0&&ds.size()==original.size());tests++;
 }
 for(const char* flag:{"manual","layoutOverride","displayOverride","ocrTruncated","truncated","panelCandidate"}){auto rows=actual.first;row(rows,4)[flag]=true;auto ds=original;assert(ocr_punctuation_duplicate::replay(ds,rows,w,h)==0);tests++;}
 {auto rows=actual.first;rows.push_back(base.at(3));auto ds=original;assert(ocr_punctuation_duplicate::replay(ds,rows,w,h)==0);tests++;}
 for(const char* key:{"version","method","owner","ownerText","ownerBox","ownerConfidence","imageWidth","imageHeight","sourceBox","sourceText","sourceConfidence","ownerQuery","sourceQuery","side","pixels","shared"})for(const auto value:{json(nullptr),json::array(),json::object()}){auto rows=actual.first;row(rows,4)["punctuationFragments"][0][key]=value;auto ds=original;assert(ocr_punctuation_duplicate::replay(ds,rows,w,h)==0);tests++;}
 {std::vector<uint8_t> paint(size_t(w)*h,1);auto rows=actual.first;ocr_punctuation_duplicate::retain_paint(paint,json::array({proof}),rows,w,h);assert(paint[510*w+790]==0&&paint[100*w+100]==1);tests++;row(rows,4)["safe"]=true;row(rows,4)["mode"]="replace";std::fill(paint.begin(),paint.end(),1);ocr_punctuation_duplicate::retain_paint(paint,json::array({proof}),rows,w,h);assert(paint[510*w+790]==1);tests++;row(rows,4)["translation"]="";ocr_punctuation_duplicate::retain_paint(paint,json::array({proof}),rows,w,h);assert(paint[510*w+790]==0);tests++;}
 // English horizontal dialogue and full-width punctuation follow the same
 // rule; positions are transposed, not special-cased by chapter or language.
 {auto ds=original;json rows=base;for(auto& r:rows){const Box box=r["bbox"];r["bbox"]=Box{box[1],box[0],box[3],box[2]};}for(auto& d:ds){const auto box=d.box;d.box={box[1],box[0],box[3],box[2]};std::vector<uint8_t> transposed(d.mask.size());for(int y=0;y<d.mask_side;y++)for(int x=0;x<d.mask_side;x++)transposed[size_t(x)*d.mask_side+y]=d.mask[size_t(y)*d.mask_side+x];d.mask=std::move(transposed);}row(rows,4)["text"]="Come on！！";row(rows,6)["text"]="!!";auto p=ocr_punctuation_duplicate::suppress(rows,ds,h,w);assert(p.size()==1&&row(rows,4)["text"]=="Come on！！");tests++;}
 std::cout<<"PASS same-glyph punctuation ownership "<<tests<<" checks\n";
}
