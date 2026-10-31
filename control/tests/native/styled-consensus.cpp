#include "../../../native/outside_text.hpp"
#include <cassert>
int main(){
 auto test=[](std::string original,std::vector<std::string> readings,std::string expected,size_t calls){size_t i=0;const auto actual=original_styled_consensus(original,[&](int scale,bool inverse){assert((i==0&&scale==2&&!inverse)||(i==1&&scale==1&&inverse)||(i==2&&scale==2&&inverse));assert(i<readings.size());return readings[i++];});assert(actual==expected);assert(i==calls);};
 test("Label",{"Label","Label"},"Label",2);
 test("Label",{"Label","Different","Label"},"Label",3);
 test("Label",{"Wrong","Wrong","Wrong"},"",1);
 test("Label",{"Label","Other","Other"},"",3);
 test("Label",{"","Label","Label"},"",1);
 test("Label",{"Label","",""},"",3);
 test("...",{},"",0);
 test("A",{},"",0);
 test(std::string(65,'A'),{},"",0);
 std::cout<<"PASS original-anchored styled OCR consensus: 9 cases\n";
}
