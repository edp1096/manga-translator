#include "../../../native/reading_order.hpp"
#include "../../../native/llm_batch.hpp"
#include <cassert>
#include <random>

using reading_order::Frame;
static size_t checks=0;
void check(bool ok){checks++;require(ok,"Reading-order control "+std::to_string(checks)+" failed");}
json ids(const json& rows){json result=json::array();for(const auto& row:rows)result.push_back(row.at("id"));return result;}
json row(int id,reading_order::Bounds box){return {{"id",id},{"bbox",box},{"text","source-"+std::to_string(id)},{"hitMask",{{"opaque","unchanged"}}},{"translation","previous"}};}
int main(int argc,char** argv){try{
 require(argc==2,"Pass recorded frame geometry fixture");const auto fixture=read_json(fs::u8path(argv[1]));std::vector<Frame> frames;for(const auto& f:fixture.at("frames"))frames.push_back({f.at("bbox").get<reading_order::Bounds>(),f.at("score"),f.at("query")});const auto rows=fixture.at("regions");const auto before=rows.dump();
 auto plan=reading_order::make(rows,frames,fixture.at("width"),fixture.at("height"));check(plan.evidence.at("applied"));check(ids(reading_order::ordered(rows,plan))==fixture.at("expected"));check(rows.dump()==before);check(plan.evidence.at("after")==fixture.at("expected"));
 std::mt19937 rng(9274);for(int i=0;i<30;i++){std::shuffle(frames.begin(),frames.end(),rng);check(reading_order::make(rows,frames,fixture.at("width"),fixture.at("height")).indices==plan.indices);}
 json wire=json::array(),responses=json::object();for(const auto& r:reading_order::ordered(rows,plan))wire.push_back({{"id",std::to_string(r.at("id").get<int>())},{"text",r.at("text")},{"requiredNames",json::array({"retained"})}});
 const LlmBatch batch(wire);for(size_t i=0;i<wire.size();i++){check(batch.rows.at(i).at("text")==wire.at(i).at("text"));check(batch.rows.at(i).at("requiredNames")==wire.at(i).at("requiredNames"));responses[batch.rows.at(i).at("id").get<std::string>()]="out-"+wire.at(i).at("id").get<std::string>();}
 const auto restored=batch.restore(responses);for(const auto& r:rows){const auto id=std::to_string(r.at("id").get<int>());check(restored.at(id)=="out-"+id);}
 const std::vector<Frame> pair={{{0,0,100,200},.95,0},{{110,0,210,200},.96,1}};const json interleaved={row(1,{10,10,40,30}),row(2,{120,10,150,30}),row(3,{20,50,40,90}),row(4,{130,50,150,90})};const auto original=interleaved.dump();
 auto rtl=reading_order::make(interleaved,pair,210,220);check(ids(reading_order::ordered(interleaved,rtl))==json({2,4,1,3}));check(interleaved.dump()==original);auto ltr=reading_order::make(interleaved,pair,210,220,false);check(ids(reading_order::ordered(interleaved,ltr))==json({1,3,2,4}));
 auto ordered=reading_order::ordered(interleaved,rtl);check(!reading_order::make(ordered,pair,210,220).evidence.at("applied").get<bool>());
 auto anchored=interleaved;anchored.insert(anchored.begin()+1,row(9,{70,170,140,210}));const auto anchor=reading_order::make(anchored,pair,210,220);check(ids(reading_order::ordered(anchored,anchor))==json({2,9,4,1,3}));check(anchor.evidence.at("assignments").at(1).at("frame").is_null());
 auto touching=pair;touching[0].box[2]=110;check(ids(reading_order::ordered(interleaved,reading_order::make(interleaved,touching,210,220)))==json({2,4,1,3}));
 auto duplicates=pair;duplicates.push_back({{0,0,99,200},.90,7});check(reading_order::make(interleaved,duplicates,210,220).indices==rtl.indices);
 auto fallback=[&](const json& source,const std::vector<Frame>& f,int w=210,int h=220){const auto p=reading_order::make(source,f,w,h);check(!p.evidence.at("applied").get<bool>());check(reading_order::ordered(source,p)==source);};
 fallback(interleaved,{});fallback(interleaved,{pair[0]});auto weak=pair;weak[1].score=.84;fallback(interleaved,weak);weak=pair;weak[0].score=std::numeric_limits<double>::quiet_NaN();fallback(interleaved,weak);weak=pair;weak[0].score=1.1;fallback(interleaved,weak);
 auto overlapping=pair;overlapping[0].box[2]=180;fallback(interleaved,overlapping);auto nested=pair;nested.push_back({{5,5,80,100},.99,2});fallback(interleaved,nested);
 fallback(interleaved,pair,0,220);fallback(interleaved,pair,100000,100000);auto bad=interleaved;bad[1]["id"]=1;fallback(bad,pair);bad=interleaved;bad[1]["bbox"]={1,1,1,2};fallback(bad,pair);bad=interleaved;bad[1]["bbox"]={1,1,211,22};fallback(bad,pair);bad=interleaved;bad[1]["bbox"][0]=1.1;fallback(bad,pair);bad=interleaved;bad[1]["bbox"][0]=uint64_t(1)<<62;fallback(bad,pair);bad=interleaved;bad[1].erase("bbox");fallback(bad,pair);bad=interleaved;bad[1]["id"]="two";fallback(bad,pair);bad=interleaved;bad[1]["id"]=-1;fallback(bad,pair);
 fallback(json::array(),pair);fallback(json::array({interleaved[0]}),pair);bad=json::array();for(int i=1;i<=151;i++)bad.push_back(row(i,{10,10,20,20}));fallback(bad,pair);
 // These nonoverlapping rectangles form a cycle without a separating gutter.
 const std::vector<Frame> cycle={{{0,0,130,40},.95,0},{{140,0,180,130},.95,1},{{50,140,180,180},.95,2},{{0,50,40,180},.95,3}};fallback(interleaved,cycle);
 // A spanning caption, a tie, and rows assigned to only one frame are stable.
 fallback(json::array({row(1,{80,10,130,30}),row(2,{70,40,140,70})}),pair);fallback(json::array({row(1,{120,10,140,30}),row(2,{130,40,150,70})}),pair);
 auto single=reading_order::make(interleaved,pair,210,220);single.indices[1]=single.indices[0];bool rejected=false;try{reading_order::ordered(interleaved,single);}catch(...){rejected=true;}check(rejected);
 check(reading_order::make(json::object(),pair,210,220).evidence.at("reason")=="invalid-rows");
 std::cout<<json({{"ok",true},{"checks",checks},{"recordedFrameOrder",plan.evidence.at("after")},{"sourceUnchanged",rows.dump()==before}}).dump()<<std::endl;
 }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}}
