#include "../../../native/restoration_revalidation.hpp"
#include <cassert>
struct FakeLayout:LayoutEngine{
 std::vector<LayoutRaw> views;size_t calls=0;
 int input_side()const override{return 16;}
 LayoutRaw run(std::vector<float>&)override{assert(calls<views.size());return views[calls++];}
};
LayoutRaw view(const Box& crop,const Box& box,float text=.95f,float bubble=.1f){
 LayoutRaw r;const float w=crop[2]-crop[0],h=crop[3]-crop[1];r.boxes={((box[0]+box[2])/2.f-crop[0])/w,((box[1]+box[3])/2.f-crop[1])/h,(box[2]-box[0])/w,(box[3]-box[1])/h};auto logit=[](float p){return std::log(p/(1-p));};r.logits={logit(text),-8,logit(bubble),-8,-8};return r;
}
int main(){
 PageImage image{720,1020,std::vector<uint8_t>(720*1020*3,180)};Box box{300,450,360,600};Region text{0,0,.95f,box,std::vector<uint8_t>(192*192),192};Region balloon{1,2,.3f,{280,420,390,630},std::vector<uint8_t>(192*192),192};
 for(int y=0;y<192;y++)for(int x=0;x<192;x++){double px=(x+.5)*720/192,py=(y+.5)*1020/192;text.mask[y*192+x]=px>=305&&px<355&&py>=460&&py<590;balloon.mask[y*192+x]=px>=280&&px<390&&py>=420&&py<630;}
 json row={{"id",1},{"type","text"},{"mode","tooltip"},{"bbox",box},{"text","これは背景上の文章です"},{"translation","배경 위의 문장입니다"}};auto rows=json::array({row});std::vector<Region> found{text,balloon};const auto crops=restoration_revalidation_crops(image,balloon.box);assert(crops.size()==3);FakeLayout engine;for(auto c:crops)engine.views.push_back(view(c,box));size_t checks=0;
 auto good=restoration_revalidate_weak_bubbles(image,engine,found,rows,[]{});assert(good.masks.size()==1&&good.passes==3&&good.masks.at(1).accepted()&&!good.masks.at(1).bubble);assert(good.evidence.at("1").at("views").size()==3);assert(found[1].score==.3f);checks++;
 engine.calls=0;engine.views[1]=view(crops[1],box,.95,.3);assert(restoration_revalidate_weak_bubbles(image,engine,found,rows,[]{}).masks.empty());assert(engine.calls==2);checks++;
 // A high text score does not hide a secondary balloon logit.
 assert(!restoration_revalidation_view(view(crops[0],box,.99,.4),crops[0],box).at("pass").get<bool>());checks++;
 engine.calls=0;engine.views[1]=view(crops[1],box,.7,.1);assert(restoration_revalidate_weak_bubbles(image,engine,found,rows,[]{}).masks.empty());checks++;
 found[1].score=.55f;engine.calls=0;assert(restoration_revalidate_weak_bubbles(image,engine,found,rows,[]{}).masks.empty()&&engine.calls==0);checks++;
 found[1].score=.3f;found[0].score=.89f;assert(restoration_revalidate_weak_bubbles(image,engine,found,rows,[]{}).masks.empty());checks++;
 found[0].score=.95f;engine.calls=0;engine.views[1]=view(crops[1],box);auto neighbor=row;neighbor["id"]=2;neighbor["bbox"]=Box{330,450,370,600};assert(restoration_revalidate_weak_bubbles(image,engine,found,json::array({row,neighbor}),[]{}).masks.empty());checks++;
 engine.calls=0;bool canceled=false;try{restoration_revalidate_weak_bubbles(image,engine,found,rows,[]{throw std::runtime_error("cancel");});}catch(const std::runtime_error&){canceled=true;}assert(canceled&&engine.calls==0);checks++;
 auto broken=view(crops[0],box);broken.boxes[0]=std::numeric_limits<float>::quiet_NaN();assert(restoration_revalidation_view(broken,crops[0],box).is_null());checks++;
 broken=view(crops[0],box);broken.boxes.pop_back();assert(restoration_revalidation_view(broken,crops[0],box).is_null());checks++;
 assert(restoration_revalidation_crops(PageImage{100,100,{}},{0,0,100,100}).empty());checks++;
 std::cout<<"PASS "<<checks<<" weak-bubble revalidation guards\n";
}
