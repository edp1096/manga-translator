#include "../../../native/ruby_columns.hpp"
#include <cassert>
int main(){const Box parent{100,100,400,600},left{100,100,285,600},right{288,100,400,480};auto rows=json::array({{{"bbox",parent},{"detectorConfidence",.3}},{{"bbox",left},{"detectorConfidence",.3}},{{"bbox",right},{"detectorConfidence",.3}}});auto parts=detected_caption_columns(parent,rows);assert(parts.size()==2&&parts[0]==right&&parts[1]==left);auto bad=rows;bad[1]["bbox"]=Box{100,100,320,600};assert(detected_caption_columns(parent,bad).empty());bad=rows;bad[1]["detectorConfidence"]=.1;assert(detected_caption_columns(parent,bad).empty());bad=rows;bad[1]["bbox"]=Box{100,100,285,350};assert(detected_caption_columns(parent,bad).empty());
 Region main{0,1,.24f,{290,104,359,477},{},192},ruby{1,0,.27f,{358,117,400,258},{},192};assert(detected_label_ruby({288,106,401,475},{main,ruby}).size()==2);auto weak=ruby;weak.score=.2f;assert(detected_label_ruby({288,106,401,475},{main,weak}).empty());weak=ruby;weak.box[3]=460;assert(detected_label_ruby({288,106,401,475},{main,weak}).empty());
 std::cout<<"PASS independent complete caption columns, overlap/incomplete/weak rejection and main/ruby detection geometry\n";
}
