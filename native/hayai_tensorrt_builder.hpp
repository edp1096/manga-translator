#pragma once
#include "hayai_tensorrt.hpp"
#include <NvOnnxParser.h>

namespace hayai_trt {
inline nvinfer1::Dims profile_dimensions(const std::string& name, nvinfer1::OptProfileSelector selector) {
 const bool small = selector == OptProfileSelector::kMIN;
 const bool large = selector == OptProfileSelector::kMAX;
 if (name == "pixel_values" || name == "pos_embeds") return Dims3{1,small ? 8 : 256,768};
 if (name == "spatial_shapes") return Dims2{1,2};
 if (name == "bos_ids" || name == "input_ids") return Dims2{1,1};
 if (name == "l_vis_arange") return Dims{1,{small ? 1 : large ? 128 : 64}};
 if (name == "position_id") return Dims{1,{1}};
 const int length = small ? 2 : large ? 384 : 68;
 if (name == "past_attention_mask") return Dims2{1,length};
 if (name == "k_cache_in" || name == "v_cache_in") return Dims{5,{12,1,2,length,64}};
 throw std::runtime_error("Unexpected Hayai input: " + name);
}

inline Dims v21_dimensions(const std::string& name, OptProfileSelector selector, bool step) {
 if(name=="pixel_values" || name=="pos_embeds" || name=="visual_features") return Dims3{1,256,768};
 if(name=="attention_mask") return Dims2{1,256};
 if(name=="text_token_ids") return Dims2{1,1};
 if(name=="mask") return Dims4{1,1,257,257};
 if(name=="cos" || name=="sin") return Dims3{1,step ? 1 : 257,32};
 if(name=="past_k" || name=="past_v"){
  const int length=selector==OptProfileSelector::kMIN ? 257 : selector==OptProfileSelector::kMAX ? 512 : 269;
  return Dims{5,{12,1,length,2,64}};
 }
 throw std::runtime_error("Unexpected Hayai v2.1 input: "+name);
}

enum class Graph { Supernova, V21Encoder, V21Prefill, V21Step };
inline void build_plan(const char* graph, const fs::path& destination, Graph kind=Graph::Supernova) {
 Logger logger;
 std::unique_ptr<IBuilder> builder(createInferBuilder(logger));
 require(bool(builder),"Cannot initialize TensorRT builder");
 std::unique_ptr<INetworkDefinition> network(builder->createNetworkV2(0));
 require(bool(network),"Cannot create TensorRT network");
 std::unique_ptr<nvonnxparser::IParser> parser(nvonnxparser::createParser(*network,logger));
 require(parser && parser->parseFromFile(graph,int(ILogger::Severity::kWARNING)),
         std::string("Cannot parse Hayai graph: ") + graph);
 std::unique_ptr<IBuilderConfig> config(builder->createBuilderConfig());
 require(bool(config),"Cannot create TensorRT builder configuration");
 config->clearFlag(BuilderFlag::kTF32);
 config->setBuilderOptimizationLevel(1);
 config->setMemoryPoolLimit(MemoryPoolType::kWORKSPACE,512ULL << 20);
 auto* profile=builder->createOptimizationProfile();
 require(profile != nullptr,"Cannot create Hayai optimization profile");
 for(int i=0;i<network->getNbInputs();++i) {
  const char* name=network->getInput(i)->getName();
  for(auto selector:{OptProfileSelector::kMIN,OptProfileSelector::kOPT,OptProfileSelector::kMAX})
   require(profile->setDimensions(name,selector,kind==Graph::Supernova ? profile_dimensions(name,selector) : v21_dimensions(name,selector,kind==Graph::V21Step)),name);
 }
 require(config->addOptimizationProfile(profile)>=0,"Invalid Hayai optimization profile");
 std::unique_ptr<IHostMemory> bytes(builder->buildSerializedNetwork(*network,*config));
 require(bytes && bytes->size(),"Cannot compile Hayai engine");
 std::ofstream out(destination,std::ios::binary);
 out.write(static_cast<const char*>(bytes->data()),bytes->size());
 out.close();
 require(bool(out),"Cannot save Hayai engine");
}
}
