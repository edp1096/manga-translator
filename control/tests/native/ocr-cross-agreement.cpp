#include "../../../native/ocr_cross_agreement.hpp"
int main(){using namespace bounded_cross_ocr;int checks=0;auto ok=[&](bool x){require(x,"Check "+std::to_string(++checks));};
 const std::vector<std::string> primary{"一緒どころか、","猪どころか、","一緒どころか、","一緒どころか、"},secondary(4,"―猪どころか、");
 auto proof=consensus(primary,secondary);ok(!proof.is_null());ok(proof.at("text")==secondary[0]);
 ok(consensus(std::vector<std::string>(4,primary[0]),secondary).is_null());
 {auto p=primary;p[1]="猫どころか、";ok(consensus(p,secondary).is_null());}
 for(int i=0;i<4;i++){auto s=secondary;s[i]="―猫どころか、";ok(consensus(primary,s).is_null());}
 {auto s=secondary;s[0]="猪どころか、";ok(!consensus(primary,s).is_null());s[1]=s[0];ok(consensus(primary,s).is_null());}
 {auto p=primary;p[0]="一緒どこるか、";ok(consensus(p,secondary).is_null());}
 {auto p=primary;p[0]="一緒どころか2、";ok(consensus(p,secondary).is_null());}
 {auto p=primary;p[0]="一緒どころかA、";ok(consensus(p,secondary).is_null());}
 {auto p=primary;p[0]="一緒空間どころか、";ok(consensus(p,secondary).is_null());}
 {auto p=primary;p[0]=p[1];ok(consensus(p,secondary).is_null());}
 ok(consensus(primary,std::vector<std::string>(4,"―猪どころか！")).is_null());
 ok(consensus(primary,{}).is_null());ok(consensus({},secondary).is_null());
 ok(consensus({"化勤で流切れなかた目","化勁で流切れなた目","化勁で流し切れなかった","化勁で流切れなた目"},std::vector<std::string>(4,"化勁で流し切れなかたヨ")).is_null());
 ok(consensus({"東西の話","南北の話","東西の話","東西の話"},std::vector<std::string>(4,"南北の話")).is_null());
 ok(consensus({"Ready!","Read!","Ready!","Ready!"},std::vector<std::string>(4,"Read!")).is_null());
 ok(consensus({"12時からです","13時からです","12時からです","12時からです"},std::vector<std::string>(4,"13時からです")).is_null());
 std::cout<<"PASS "<<checks<<" bounded cross OCR agreement guards\n";
}
