#include "../../../native/bubble_geometry.hpp"
#include <cassert>

int main(){
 PageImage image{100,100,{}};
 Region bubble{0,2,.96f,{20,20,80,80},std::vector<uint8_t>(100),10};
 for(int row=2;row<8;++row)for(int column=2;column<8;++column)bubble.mask[row*10+column]=1;
 bubble.mask[0]=1;
 Region effect=bubble;effect.cls=1;
 Region uncertain=bubble;uncertain.score=.7f;
 const auto geometry=bubble_geometry(image,{bubble,effect,uncertain});
 assert(geometry.at("width")==100&&geometry.at("height")==100);
 assert(geometry.at("version")==3);
 assert(geometry.at("bubbles").size()==2);
 const auto& saved=geometry.at("bubbles").at(0);
 assert(saved.at("width")==10&&saved.at("height")==10);
 const std::vector<int> expected{33,4,43,4,53,4,63,4};
 assert(saved.at("runs").get<std::vector<int>>()==expected);
 assert(!saved.at("verifiedWhite").get<bool>());
 assert(saved.at("supports").size()==1);
 assert(saved.at("supports").at(0).at("inside")==1);
 assert(saved.at("supports").at(0).at("interior").get<double>()<.5);
 assert(!saved.at("detailVerified").get<bool>());
 assert(!saved.at("supports").at(0).at("detailVerified").get<bool>());
 bubble.detail_verified=true;
 assert(!bubble_geometry(image,{bubble,effect}).at("bubbles").at(0).at("supports").at(0).at("detailVerified").get<bool>());
 effect.detail_verified=true;
 assert(bubble_geometry(image,{bubble,effect}).at("bubbles").at(0).at("supports").at(0).at("detailVerified").get<bool>());
 bubble.box={40,40,60,60};
 const auto clipped=bubble_geometry(image,{bubble});
 const std::vector<int> clipped_expected{44,2,54,2};
 assert(clipped.at("bubbles").at(0).at("runs").get<std::vector<int>>()==clipped_expected);
 bubble.mask.assign(100,0);
 assert(bubble_geometry(image,{bubble}).at("bubbles").empty());
 bubble.mask_side=100;bubble.mask.assign(10000,0);bubble.box={20,20,80,80};
 image.rgb.assign(30000,255);
 for(int row=20;row<80;++row)for(int column=20;column<80;++column){
  bubble.mask[row*100+column]=1;
  if(row==20||row==79||column==20||column==79)for(int channel=0;channel<3;++channel)image.rgb[(row*100+column)*3+channel]=0;
 }
 assert(bubble_geometry(image,{bubble}).at("bubbles").at(0).at("verifiedWhite").get<bool>());
 image.rgb.assign(30000,255);
 assert(!bubble_geometry(image,{bubble}).at("bubbles").at(0).at("verifiedWhite").get<bool>());
 bubble.mask.resize(1);
 assert(bubble_geometry(image,{bubble}).at("bubbles").empty());
 bubble.mask_side=-1;
 assert(bubble_geometry(image,{bubble}).at("bubbles").empty());
}
