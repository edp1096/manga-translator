#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "../native/platform.hpp"
#include "../native/pipeline.hpp"
int main(int argc,char**argv){try{
 require(argc>=4,"probe ROOT JOB MODE [THREADS]");const fs::path root=argv[1],folder=argv[2];auto config=read_json(root/"config/native_api.json");if(argc>4)config["threads"]=std::stoi(argv[4]);NativePipeline pipeline(root,config);manga_ort::initialize();manga_litert::library_path=root/config.at("litert_library").get<std::string>();const std::string mode=argv[3];auto start=Clock::now();json output;
 if(mode=="translate"){
  const auto saved=read_json(folder/"result.json"),request=read_json(folder/"request.json");auto regions=saved.at("regions");if(saved.contains("translationOrder")&&saved.at("translationOrder").contains("after")){json ordered=json::array();for(const auto& id:saved.at("translationOrder").at("after"))for(const auto& row:regions)if(row.at("id")==id)ordered.push_back(row);if(ordered.size()==regions.size())regions=std::move(ordered);}
  output["translations"]=pipeline.translate(regions,saved.at("target"),request.value("dictionary",json::object()));output["elapsedMs"]=ms(start);size_t expected=0;for(const auto& r:regions)if(nonblank(r.at("text"))&&!r.value("ocrTruncated",false)){++expected;require(output.at("translations").contains(std::to_string(r.at("id").get<int>())),"Missing translated row");}output["expected"]=expected;
 }else if(mode=="geometry"){
  auto first=pipeline.bubbles(folder),second=pipeline.bubbles(folder);require(second.at("detectionCached")==true,"Cache not used");output={{"firstMs",first.at("elapsedMs")},{"secondMs",second.at("elapsedMs")},{"firstCached",first.at("detectionCached")}};for(auto* value:{&first,&second}){value->erase("elapsedMs");value->erase("detectionCached");}require(first==second,"Cached geometry differs");output["parity"]=true;
  auto key=display_detection_cache::identity(folder/"original.png",root/config.at("layout_model").get<std::string>(),config);std::vector<Region> regions;key["version"]=999;require(!display_detection_cache::load(folder,key,regions),"Stale cache accepted");output["staleRejected"]=true;
 }else if(mode=="process"){
  output=pipeline.process(folder,"Korean",[](const std::string& phase){std::cerr<<phase<<std::endl;});
 }else throw std::runtime_error("Unknown probe mode");std::cout<<output.dump(2)<<std::endl;return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}}
