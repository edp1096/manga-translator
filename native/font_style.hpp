#pragma once
#include "common.hpp"
namespace font_style {
inline const json roles=json::array({"dialogue","narration","shout","impact"});
inline std::string role(const json& value){if(value.is_string()&&std::find(roles.begin(),roles.end(),value)!=roles.end())return value.get<std::string>();return "dialogue";}
inline json schema(const json& translation){return {{"type","object"},{"properties",{{"translation",translation},{"style",{{"type","string"},{"enum",roles}}}}},{"required",json::array({"translation","style"})},{"additionalProperties",false}};}
inline json extract(json& parsed){json styles=json::object();for(auto& item:parsed.items()){
 auto& value=item.value();if(value.is_string()){styles[item.key()]="dialogue";continue;}
 if(!value.is_object()||!value.contains("translation")||!value.at("translation").is_string())continue;
 styles[item.key()]=role(value.value("style",json()));value=value.at("translation").get<std::string>();
 }return styles;}
inline const std::string instruction=" Return each id as an object with translation (the translated string) and style. Typography must stay consistent across the scene: use dialogue for ordinary speech, friendly or affectionate speech, playful tone, and emotional speech. Most rows should use dialogue. Use narration only for clearly identified narrator exposition or an unmistakable sustained internal monologue, never for sadness, hesitation or wistful wording alone. Keep connected narration or monologue in the same style. Use shout only for an unmistakable short forceful outcry, not long sentences, ordinary excitement or punctuation alone. If uncertain use dialogue. Use impact only when textKind is effect and the text is an unmistakable short, strong impact or explosive sound effect; ordinary or ambiguous sound effects use dialogue. Names and labels use dialogue. Do not invent context. Translation accuracy takes priority.";
}
