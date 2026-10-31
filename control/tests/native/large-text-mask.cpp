#include "../../../native/restoration_mask.hpp"
#include <cassert>
int main(){
 PageImage image{1000,1000,{}};Region text{1,0,.4f,{100,100,340,600},{},1000};text.mask.assign(1000000,0);text.ocr_verified=true;
 for(int y=110;y<590;++y)for(int x=110;x<150;++x)text.mask[y*1000+x]=1;
 json row={{"id",1},{"type","text"},{"mode","tooltip"},{"bbox",text.box},{"text","Stay back!"},{"translation","물러서!"},{"textVerification",{{"version",1},{"method","ocr-consensus"},{"role","DIALOGUE"},{"sources",json::array({text.box})}}}};
 auto mask=restoration_mask(image,text,row,{text},json::array({row}));assert(mask.accepted()&&mask.count<80000&&area(text.box)>80000);
 auto unverified=text;unverified.ocr_verified=false;unverified.score=.9f;assert(restoration_mask(image,unverified,row,{unverified},json::array({row})).reason=="large-or-invalid-region");
 auto dense=text;for(int y=100;y<600;y++)for(int x=100;x<340;x++)dense.mask[y*1000+x]=1;assert(restoration_mask(image,dense,row,{dense},json::array({row})).reason=="mask-too-large");
 auto invalid=row;invalid["textVerification"]["role"]="EFFECT";assert(!restoration_mask(image,text,invalid,{text},json::array({invalid})).accepted());
 auto huge=text;huge.box[2]=500;auto hugeRow=row;hugeRow["bbox"]=huge.box;hugeRow["textVerification"]["sources"]=json::array({huge.box});assert(restoration_mask(image,huge,hugeRow,{huge},json::array({hugeRow})).reason=="large-or-invalid-region");
 auto neighbor=row;neighbor["id"]=2;neighbor["bbox"]=Box{110,200,150,300};neighbor.erase("textVerification");assert(restoration_mask(image,text,row,{text},json::array({row,neighbor})).reason=="neighbor-text");
 std::cout<<"PASS verified sparse large text; dense/unverified/huge/effect/neighbor vetoes preserved\n";
}
