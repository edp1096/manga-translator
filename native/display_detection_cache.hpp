#pragma once
#include "layout.hpp"
// Optional per-job display cache. It captures the detector output BEFORE OCR
// tightening/panel recovery, exactly the input of the standalone bubbles path.
namespace display_detection_cache {
inline json identity(const fs::path& image,const fs::path& model,const json& config){
 return {{"version",1},{"imageBytes",fs::file_size(image)},{"imageTime",fs::last_write_time(image).time_since_epoch().count()},{"model",model.u8string()},{"modelBytes",fs::file_size(model)},{"modelTime",fs::last_write_time(model).time_since_epoch().count()},{"execution",config.value("layout_execution",std::string("cpu"))},{"gpu",config.value("gpu_index",0)},{"threads",config.value("threads",4)}};
}
inline void save(const fs::path& folder,const json& key,const std::vector<Region>& regions){
 try{json rows=json::array();for(const auto& r:regions)rows.push_back({{"query",r.query},{"cls",r.cls},{"score",r.score},{"box",r.box},{"side",r.mask_side},{"detail",r.detail_verified},{"mask",json::binary(r.mask)}});
  const auto data=json::to_cbor(json{{"key",key},{"regions",rows}});auto path=folder/"display-detection.cbor",temporary=folder/"display-detection.cbor.tmp";{std::ofstream out(temporary,std::ios::binary);out.write(reinterpret_cast<const char*>(data.data()),data.size());if(!out)return;}std::error_code ec;fs::remove(path,ec);fs::rename(temporary,path,ec);
 }catch(...){/* An optional acceleration must not fail a translated page. */}
}
inline bool load(const fs::path& folder,const json& key,std::vector<Region>& regions){
 try{const auto path=folder/"display-detection.cbor";if(!fs::is_regular_file(path)||fs::file_size(path)>64*1024*1024)return false;std::ifstream in(path,std::ios::binary);std::vector<uint8_t> bytes{std::istreambuf_iterator<char>(in),{}};const auto data=json::from_cbor(bytes);if(data.at("key")!=key)return false;const auto& rows=data.at("regions");if(!rows.is_array()||rows.size()>1000)return false;std::vector<Region> restored;size_t pixels=0;
  for(const auto& row:rows){Region r{};r.query=row.at("query");r.cls=row.at("cls");r.score=row.at("score");r.box=row.at("box").get<Box>();r.mask_side=row.at("side");r.detail_verified=row.at("detail");if(r.cls<0||r.cls>3||!std::isfinite(r.score)||r.mask_side<3||r.mask_side>1024||!row.at("mask").is_binary())return false;const auto& mask=row.at("mask").get_binary();if(mask.size()!=size_t(r.mask_side)*r.mask_side||(pixels+=mask.size())>64*1024*1024)return false;r.mask.assign(mask.begin(),mask.end());if(std::any_of(r.mask.begin(),r.mask.end(),[](uint8_t v){return v>1;}))return false;restored.push_back(std::move(r));}
  regions=std::move(restored);return true;
 }catch(...){return false;}
}
}
