#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "../../../native/ruby_projection.hpp"
#include <cassert>
int main(int argc,char** argv){
 PageImage im{100,180,std::vector<uint8_t>(100*180*3,255)};
 auto paint=[&](int x0,int x1){for(int y=10;y<170;++y)for(int x=x0;x<x1;++x)for(int c=0;c<3;++c)im.rgb[(y*100+x)*3+c]=0;};paint(4,18);paint(36,73);paint(85,96);
 auto parts=projected_middle_column(im,{0,0,100,180});assert(parts.size()==3&&parts[1][0]>=18&&parts[1][0]<=36&&parts[1][2]>=73&&parts[1][2]<=85);
 assert(projected_middle_column(im,{-1,0,100,180}).empty());assert(projected_middle_column(im,{0,0,100,90}).empty());
 auto solid=im;std::fill(solid.rgb.begin(),solid.rgb.end(),0);assert(projected_middle_column(solid,{0,0,100,180}).empty());std::fill(solid.rgb.begin(),solid.rgb.end(),255);assert(projected_middle_column(solid,{0,0,100,180}).empty());
 if(argc==2){auto actual=load_page(fs::u8path(argv[1]));auto crops=projected_middle_column(actual,{263,108,402,331});assert(crops.size()==3);assert(crops[1][0]>=294&&crops[1][0]<=299&&crops[1][2]>=368&&crops[1][2]<=374);std::cout<<json(crops).dump()<<"\n";}
 std::cout<<"PASS projection candidates, image bounds, blank/solid/horizontal rejection and real image crop\n";
}
