#define STB_IMAGE_IMPLEMENTATION
#include "ort_kv_engine.hpp"
int main(int argc,char** argv){try{
 require(argc==4,"usage models eval manifest");OrtKvEngine engine(fs::u8path(argv[1]),4,false,false);
 auto rows=read_json(fs::u8path(argv[3]));for(auto& row:rows){auto r=engine.run(fs::u8path(argv[2])/row.at("file").get<std::string>(),64);std::cout<<json({{"id",row.at("id")},{"tokens",r.ids},{"text",engine.tokenizer.decode(r.ids)},{"stopped",r.stopped}}).dump()<<'\n';}
 return 0;
}catch(const std::exception&e){std::cerr<<e.what()<<'\n';return 1;}}
