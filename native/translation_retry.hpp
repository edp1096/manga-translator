#pragma once
#include "common.hpp"
#include <functional>
namespace translation_retry {
// Never submit the same failing multi-row batch twice. Valid rows are retained
// by request(); only rejected rows are split, preserving their original IDs.
inline void resolve(const json& batch,const std::function<json(const json&)>& request){
 auto pending=request(batch);if(pending.empty())return;
 if(batch.size()==1){pending=request(batch);require(pending.empty(),"Gemma translation/name verification failed after retries for region "+batch.at(0).at("id").get<std::string>());return;}
 const size_t half=std::max<size_t>(1,pending.size()/2);
 for(size_t begin=0;begin<pending.size();begin+=half){json smaller=json::array();for(size_t i=begin;i<std::min(begin+half,pending.size());++i)smaller.push_back(pending[i]);resolve(smaller,request);}
}
inline int budget(const json& batch){
 size_t tokens=128;for(const auto& r:batch){tokens+=48+6*codepoints(r.value("text",std::string{})).size();if(r.contains("requiredNames"))tokens+=2*codepoints(r.at("requiredNames").dump()).size();}
 return int(std::clamp<size_t>(tokens,256,2048));
}
}
