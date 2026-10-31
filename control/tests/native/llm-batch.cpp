#include "../../../native/llm_batch.hpp"
#include <cassert>

int main(){
 json input=json::array();for(const auto& identifier:{"1","2","3","5","7","8","9","10","11","12","15"})input.push_back({{"id",identifier},{"text","source-"+std::string(identifier)},{"requiredNames",json::array({{{"original","name"},{"required","approved"}}})}});
 const LlmBatch batch(input);json response=json::object();size_t index=0;
 for(const auto& property:batch.properties.items()){const auto& row=batch.rows.at(index);assert(property.key()==row.at("id"));assert(batch.required.at(index)==property.key());assert(row.at("text")==input.at(index).at("text"));assert(row.at("requiredNames")==input.at(index).at("requiredNames"));response[property.key()]="translation-"+input.at(index).at("id").get<std::string>();++index;}
 const auto restored=batch.restore(response);for(const auto& row:input){const std::string identifier=row.at("id");assert(restored.at(identifier)=="translation-"+identifier);}
 assert(input.at(1).at("id")=="2");response.erase(batch.rows.at(1).at("id").get<std::string>());assert(!batch.restore(response).contains("2"));response["unknown"]="wrong";assert(batch.restore(response).empty());
 const LlmBatch retry(json::array({input.at(9),input.at(1)}));assert(retry.restore({{"row_000000","twelve"},{"row_000001","two"}}).at("12")=="twelve");
 const LlmBatch fields(json::array({{{"id","familySource"},{"text","full"}},{{"id","givenSource"},{"text","full"}}}));assert(fields.restore({{"row_000000","family"},{"row_000001","given"}}).at("givenSource")=="given");
 const LlmBatch labels(json::array({{{"id","givenSource"},{"text","given"}},{{"id","familySource"},{"text","family"}}}),false);assert(labels.rows[0]["id"]=="familySource");assert(labels.restore({{"familySource","family"},{"givenSource","given"}}).at("givenSource")=="given");
 bool rejected=false;try{LlmBatch duplicate(json::array({input.at(0),input.at(0)}));}catch(...){rejected=true;}assert(rejected);
 std::cout<<"PASS sparse/double-digit ids, schema/source order, round trip, retry subsets, named fields, missing/unknown/duplicate ids\n";
}
