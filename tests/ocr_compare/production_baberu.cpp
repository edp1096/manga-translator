#define STB_IMAGE_IMPLEMENTATION
#include "../../native/baberu_engine.hpp"
int main(int argc,char**argv){try{
 require(argc==5,"production_baberu EVAL_BASE OUTPUT BACKEND DUMP_OR_DASH");fs::path base=argv[1];json report=json::array();auto samples=read_json(base/"eval/samples.json");
 for(std::string tier:{"fp16","int4"}){
  BaberuEngine engine(base/"model",tier,4,OrtExecution{argv[3],0});
  for(auto sample:samples){auto id=sample["id"].get<std::string>();if(std::string(argv[4])!="-")engine.dump=fs::path(argv[4])/tier/id;auto r=engine.run(base/"eval"/sample["file"].get<std::string>(),256);auto text=engine.tokenizer.decode(r.ids);report.push_back({{"tier",tier},{"id",id},{"prediction",text},{"ids",r.ids},{"stopped",r.stopped}});std::cout<<tier<<" "<<id<<" "<<text<<std::endl;}
 }
 std::ofstream(argv[2])<<report.dump(2)<<"\n";
}catch(const std::exception&e){std::cerr<<e.what()<<std::endl;return 1;}}
