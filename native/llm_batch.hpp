#pragma once
#include "common.hpp"

struct LlmBatch {
 json rows=json::array(),properties=json::object(),required=json::array();
 std::map<std::string,std::string> original_ids;
 explicit LlmBatch(const json& input,bool sequential=true){
  require(input.is_array()&&input.size()<=1000,"Invalid LLM batch");std::set<std::string> seen;
  auto sorted=input;
  for(const auto& row:sorted)require(row.is_object()&&row.contains("id")&&row.at("id").is_string(),"Invalid LLM row id");
  if(!sequential)std::stable_sort(sorted.begin(),sorted.end(),[](const json& first,const json& second){return first.at("id").get<std::string>()<second.at("id").get<std::string>();});
  for(const auto& row:sorted){
   require(row.is_object()&&row.contains("id")&&row.at("id").is_string(),"Invalid LLM row id");const std::string original=row.at("id");require(!original.empty()&&seen.insert(original).second,"Duplicate LLM row id");
   std::ostringstream identifier;identifier<<"row_"<<std::setw(6)<<std::setfill('0')<<rows.size();const auto wire_id=sequential?identifier.str():original;
   auto ordered=row;ordered["id"]=wire_id;rows.push_back(std::move(ordered));properties[wire_id]={{"type","string"}};required.push_back(wire_id);original_ids[wire_id]=original;
  }
 }
 json restore(const json& response)const{
  json result=json::object();if(!response.is_object())return result;
  for(const auto& item:response.items()){const auto found=original_ids.find(item.key());if(found==original_ids.end())return json::object();if(item.value().is_string())result[found->second]=item.value();}
  return result;
 }
};
