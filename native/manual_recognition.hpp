#pragma once
#include "image_ops.hpp"

namespace manual_recognition {
struct Selection { std::array<double,4> box; double rotation; std::string type; };
inline Selection checked(const json& input) {
 if(!input.is_object()||!input.contains("box")||!input.at("box").is_array()||input.at("box").size()!=4)throw std::invalid_argument("Invalid recognition rectangle");
 Selection s{{},0,"text"};
 for(size_t i=0;i<4;++i){if(!input.at("box")[i].is_number())throw std::invalid_argument("Invalid recognition coordinate");s.box[i]=input.at("box")[i].get<double>();if(!std::isfinite(s.box[i])||std::abs(s.box[i])>100000)throw std::invalid_argument("Invalid recognition coordinate");}
 if(input.contains("rotation")){if(!input.at("rotation").is_number())throw std::invalid_argument("Invalid recognition angle");s.rotation=input.at("rotation").get<double>();}
 if(!std::isfinite(s.rotation)||std::abs(s.rotation)>180)throw std::invalid_argument("Invalid recognition angle");
 const double w=s.box[2]-s.box[0],h=s.box[3]-s.box[1];if(w<4||h<4||w>8192||h>8192||w*h>4*1024*1024)throw std::invalid_argument("Select a smaller text region (at least 4 pixels per side)");
 if(input.contains("type")){if(!input.at("type").is_string())throw std::invalid_argument("Invalid recognition type");s.type=input.at("type").get<std::string>();}
 if(s.type!="text"&&s.type!="effect")throw std::invalid_argument("Invalid recognition type");return s;
}
struct Crop { PageImage image; Box bounds; };
inline Crop crop(const PageImage& original,const Selection& s) {
 const double cx=(s.box[0]+s.box[2])*.5,cy=(s.box[1]+s.box[3])*.5,angle=s.rotation*3.14159265358979323846/180.,c=std::cos(angle),sn=std::sin(angle);
 const int w=int(std::ceil(s.box[2]-s.box[0])),h=int(std::ceil(s.box[3]-s.box[1]));
 PageImage image{w+16,h+16,std::vector<uint8_t>(size_t(w+16)*(h+16)*3,255)};
 Box bounds{original.width,original.height,0,0};size_t covered=0;int low=255,high=0;
 for(int y=0;y<h;++y)for(int x=0;x<w;++x){const double dx=(x+.5)/w*(s.box[2]-s.box[0])-(s.box[2]-s.box[0])*.5,dy=(y+.5)/h*(s.box[3]-s.box[1])-(s.box[3]-s.box[1])*.5;
  const int sx=int(std::floor(cx+c*dx-sn*dy)),sy=int(std::floor(cy+sn*dx+c*dy));if(sx<0||sy<0||sx>=original.width||sy>=original.height)continue;
  ++covered;bounds={std::min(bounds[0],sx),std::min(bounds[1],sy),std::max(bounds[2],sx+1),std::max(bounds[3],sy+1)};
  for(int channel=0;channel<3;++channel){const auto value=original.rgb[(size_t(sy)*original.width+sx)*3+channel];image.rgb[(size_t(y+8)*image.width+x+8)*3+channel]=value;low=std::min(low,int(value));high=std::max(high,int(value));}
 }
 if(covered<16)throw std::invalid_argument("The recognition rectangle is outside the image");
 if(high-low<12)throw std::invalid_argument("No visible text in the selected region");
 return {std::move(image),bounds};
}
}
