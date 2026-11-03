#include "../native/font_style.hpp"
#include "../native/llm_batch.hpp"
#include <cassert>
int main(){
 json input=json::array({{{"id","77"},{"text","hello"}},{{"id","2"},{"text","stop"}}});LlmBatch wire(input);
 auto schema=font_style::schema({{"type","string"},{"pattern","Korean"}});assert(schema["properties"]["translation"]["pattern"]=="Korean");
 json output={{"row_000000",{{"translation","안녕"},{"style","friendly"}}},{"row_000001",{{"translation","멈춰"},{"style",false}}}};
 auto styles=wire.restore(font_style::extract(output));assert(styles["77"]=="friendly"&&styles["2"]=="dialogue");assert(wire.restore(output)["77"]=="안녕");
 output={{"row_000000","안녕"},{"row_000001",{{"style","shout"}}}};styles=wire.restore(font_style::extract(output));assert(styles["77"]=="dialogue");assert(wire.restore(output).size()==1);
 output={{"unknown",{{"translation","안녕"},{"style","friendly"}}}};assert(wire.restore(font_style::extract(output)).empty());assert(wire.restore(output).empty());
 assert(font_style::role("__proto__")=="dialogue");std::cout<<"PASS schema preserves translation constraints; optional/invalid style; legacy strings; ID validation\n";
}
