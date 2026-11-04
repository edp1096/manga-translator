#include "../native/manual_recognition.hpp"
#include <cassert>
#include <iostream>
int main(){
 PageImage im{30,30,std::vector<uint8_t>(2700,255)};for(int y=5;y<20;y++)for(int x=8;x<12;x++)for(int c=0;c<3;c++)im.rgb[(y*30+x)*3+c]=0;const auto before=im.rgb;
 auto input=json{{"box",{4,3,22,24}},{"rotation",0}};auto a=manual_recognition::crop(im,manual_recognition::checked(input));assert((a.bounds==Box{4,3,22,24}));assert(a.image.width==34&&a.image.height==37);assert(im.rgb==before);assert(a.image.rgb[(size_t(8+2)*a.image.width+8+4)*3]==0);assert(a.image.rgb[0]==255);
 input["rotation"]=90;auto b=manual_recognition::crop(im,manual_recognition::checked(input));assert(b.image.width==a.image.width);
 input["box"]={-8,-8,22,24};manual_recognition::crop(im,manual_recognition::checked(input));
 for(auto box: {json::array({40,40,60,60}),json::array({22,22,29,29}),json::array({1,1,1,2}),json::array({0,0,9000,9000})}){bool rejected=false;try{manual_recognition::crop(im,manual_recognition::checked(json{{"box",box}}));}catch(const std::invalid_argument&){rejected=true;}assert(rejected);}
 for(auto input: {json{{"box",{0,0,20,20}},{"rotation",181}},json{{"box",{0,0,20,20}},{"type","invalid"}},json{{"box",{"x",0,20,20}}}}){bool rejected=false;try{manual_recognition::checked(input);}catch(const std::invalid_argument&){rejected=true;}assert(rejected);}
 std::cout<<"PASS original crop, rotation, partial/outside, blank and invalid bounds\n";
}
