#include "../native/background_guard.hpp"
#include <cassert>
#include <fstream>
#include <iostream>
int main(int argc,char**argv){
 const std::array<int,4> box{40,40,80,100};const std::array<uint8_t,3> white{252,251,252};
 std::vector<uint8_t> im(120*140*3,255);assert(!background_fill_conflict(im,120,140,box,white));
 for(int y=30;y<110;++y)for(int x=20;x<36;++x)for(int c=0;c<3;++c)im[(y*120+x)*3+c]=0;
 assert(!background_fill_conflict(im,120,140,box,white)); // One nearby outline.
 std::fill(im.begin(),im.end(),190);assert(background_fill_conflict(im,120,140,box,white));
 assert(!background_fill_conflict(im,120,140,box,{190,190,190}));
 std::fill(im.begin(),im.end(),0);assert(!background_fill_conflict(im,120,140,box,{0,0,0}));
 if(argc==2){std::ifstream f(argv[1],std::ios::binary);int w,h;f.read((char*)&w,4);f.read((char*)&h,4);im.resize(size_t(w)*h*3);f.read((char*)im.data(),im.size());assert(f.good());assert(background_fill_conflict(im,w,h,{1055,131,1090,238},white));assert(background_fill_conflict(im,w,h,{154,254,241,374},white));assert(!background_fill_conflict(im,w,h,{480,201,511,302},{255,255,255}));}
 std::cout<<"PASS outline rejection, flat white/gray/black, nearby border and real page\n";
}
