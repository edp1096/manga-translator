#include "../../../native/ocr_detached_columns.hpp"
#include <cassert>
#include <iostream>
int main(){
 PageImage image{2000,4000,std::vector<uint8_t>(2000*4000*3,255)};Box box{60,80,120,260};
 auto ink=[&](int x,int y){for(int c=0;c<3;c++)image.rgb[(size_t(y)*image.width+x)*3+c]=0;};
 for(int y=0;y<400;y++)ink(95,y);
 for(int i=0;i<6;i++)for(int y=82+i*29;y<106+i*29;y++)for(int x=62;x<86;x++)ink(x,y);
 for(int i=0;i<2;i++)for(int y=82+i*29;y<106+i*29;y++)for(int x=102;x<118;x++)ink(x,y);
 auto p=detached_columns::plan(image,box,"ABCDEF");assert(p&&p->columns.size()==2);assert(p->columns[0][0]==102&&p->columns[1][2]==86);
 auto read=[&](const PageImage& im,Box b,int,bool){return im.width!=image.width?std::string("XYABCDEF"):b[0]>90?std::string("XY"):std::string("ABCDEF");};
 auto proof=detached_columns::correction(image,box,"ABCDEF",read);assert(!proof.is_null());assert(detached_columns::valid_proof(proof,box,"XYABCDEF"));
 auto bad=proof;bad["columns"][0][0]=80;assert(!detached_columns::valid_proof(bad,box,"XYABCDEF"));
 bad=proof;bad["readings"][0][2]="XZ";assert(!detached_columns::valid_proof(bad,box,"XYABCDEF"));
 bad=proof;bad["prior"]="ABCDXX";assert(!detached_columns::valid_proof(bad,box,"XYABCDEF"));
 bad=proof;bad["isolatedReadings"][0]="XYABCDE";assert(!detached_columns::valid_proof(bad,box,"XYABCDEF"));
 auto disagreement=[&](const PageImage& im,Box b,int scale,bool inverse){return scale==2&&inverse?std::string("WRONG"):read(im,b,scale,inverse);};assert(detached_columns::correction(image,box,"ABCDEF",disagreement).is_null());
 for(int y=0;y<400;y++)for(int x=102;x<118;x++)ink(x,y);assert(!detached_columns::plan(image,box,"ABCDEF"));
 std::cout<<"PASS detached leading columns, whole contour exclusion, original/isolated agreement and proof rejection\n";
}
