#include "../native/translation_retry.hpp"
#include "../native/translation_output.hpp"
#include <cassert>
int main(){
 json rows=json::array();for(int i=0;i<9;++i)rows.push_back({{"id",std::to_string(i)},{"text","test"}});
 std::map<std::string,int> completed;std::map<std::string,int> calls;
 translation_retry::resolve(rows,[&](const json& batch,bool finalRetry){assert(!finalRetry);++calls[batch.dump()];if(batch.size()>2)return batch;for(const auto& r:batch)++completed[r.at("id")];return json::array();});
 assert(completed.size()==9);for(const auto& item:completed)assert(item.second==1);for(const auto& item:calls)assert(item.second==1);
 int attempt=0;translation_retry::resolve(json::array({rows[0]}),[&](const json& batch,bool finalRetry){assert(finalRetry==(attempt==1));return ++attempt==1?batch:json::array();});assert(attempt==2);
 bool failed=false;try{translation_retry::resolve(json::array({rows[0]}),[](const json& b,bool){return b;});}catch(const std::exception&){failed=true;}assert(failed);
 assert(translation_retry::budget(json::array({rows[0]}))==256);rows[0]["text"]=std::string(5000,'a');assert(translation_retry::budget(rows)==2048);
 using translation_output::normalize_plamo;
 const auto no_approvals = json::array();
 const auto repaired = normalize_plamo("그러니까ー", "Korean", no_approvals);
 assert(repaired == "그러니까…" && translation_output::valid(repaired, "Korean"));
 assert(normalize_plamo("그래ｰ!", "Korean", no_approvals) == "그래…!");
 assert(!translation_output::valid(normalize_plamo("だからー", "Korean", no_approvals), "Korean"));
 assert(normalize_plamo("そうー", "Japanese", no_approvals) == "そうー");
 const auto approved = json::array({{{"required", "가나ー"}}});
 assert(normalize_plamo("가나ー", "Korean", approved) == "가나ー");
 std::cout<<"PASS split retry, IDs, bounded failure, token budgets\n";
}
