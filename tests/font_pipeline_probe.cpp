#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "../native/platform.hpp"
#include "../native/pipeline.hpp"
int main(int argc,char**argv){try{
 require(argc==3,"font probe ROOT INPUT.json");fs::path root=argv[1];auto config=read_json(root/"config/native_api.json");config["inpaint_backend"]="onnx";NativePipeline pipeline(root,config);
 const auto rows=read_json(argv[2]);json styles=json::object();auto translated=pipeline.translate(rows,"Korean",json::object(),nullptr,&styles);
 require(translated.size()==rows.size()&&styles.size()==rows.size(),"Missing translation/style");std::cout<<json{{"translations",translated},{"styles",styles}}.dump(2)<<std::endl;return 0;
}catch(const std::exception&e){std::cerr<<e.what()<<std::endl;return 1;}}
