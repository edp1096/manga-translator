#pragma once
#include "common.hpp"
namespace font_style {
inline const json roles=json::array({"dialogue","friendly","reflective","narration","shout"});
inline std::string role(const json& value){if(value.is_string()&&std::find(roles.begin(),roles.end(),value)!=roles.end())return value.get<std::string>();return "dialogue";}
inline json schema(const json& translation){return {{"type","object"},{"properties",{{"translation",translation},{"style",{{"type","string"},{"enum",roles}}}}},{"required",json::array({"translation","style"})},{"additionalProperties",false}};}
inline json extract(json& parsed){json styles=json::object();for(auto& item:parsed.items()){
 auto& value=item.value();if(value.is_string()){styles[item.key()]="dialogue";continue;}
 if(!value.is_object()||!value.contains("translation")||!value.at("translation").is_string())continue;
 styles[item.key()]=role(value.value("style",json()));value=value.at("translation").get<std::string>();
 }return styles;}
inline const std::string instruction=" Return each id as an object with translation (the translated string) and style. Choose style using the meaning and speaker tone in the supplied page dialogue: dialogue=ordinary or uncertain; friendly=clearly warm, affectionate or playful; reflective=introspective thought, wistfulness or vulnerable feelings; narration=expository narrator or formal narrative caption; shout=short forceful shouting. A question or exclamation mark alone is not evidence. Do not label every thought as narration. Names and isolated sound effects use dialogue unless context clearly supports another style. Do not invent context. Translation accuracy takes priority.";
}
