#pragma once
#include "common.hpp"
#include <array>

// Change the context sequence sent to translation, never OCR or paint geometry.
// The caller retains the original rows and region IDs for restoration/editing.
namespace reading_order {
using Bounds=std::array<int,4>;
struct Frame {Bounds box;double score;int query;};
struct Plan {std::vector<size_t> indices;json evidence;};
inline int64_t box_area(const Bounds& b){return int64_t(b[2]-b[0])*(b[3]-b[1]);}
inline int64_t shared(const Bounds& a,const Bounds& b){return int64_t(std::max(0,std::min(a[2],b[2])-std::max(a[0],b[0])))*std::max(0,std::min(a[3],b[3])-std::max(a[1],b[1]));}
inline bool valid(const Bounds& b,int w,int h){return b[0]>=0&&b[1]>=0&&b[2]>b[0]&&b[3]>b[1]&&b[2]<=w&&b[3]<=h;}
inline bool partition(const std::vector<size_t>& group,const std::vector<Frame>& frames,bool rtl,std::vector<size_t>& output){
 if(group.size()<2){output.insert(output.end(),group.begin(),group.end());return true;}
 // A horizontal gutter separates rows of panels before vertical gutters split
 // their columns. An unsplittable group has no reliable geometric order.
 for(const int axis:{1,0}){
  auto sorted=group;std::stable_sort(sorted.begin(),sorted.end(),[&](size_t a,size_t b){return frames[a].box[axis]<frames[b].box[axis];});
  int edge=frames[sorted[0]].box[axis+2],gap=-1;size_t cut=0;
  for(size_t i=1;i<sorted.size();i++){const int distance=frames[sorted[i]].box[axis]-edge;if(distance>=0&&distance>gap){gap=distance;cut=i;}edge=std::max(edge,frames[sorted[i]].box[axis+2]);}
  if(!cut)continue;
  std::vector<size_t> first(sorted.begin(),sorted.begin()+cut),second(sorted.begin()+cut,sorted.end());if(axis==0&&rtl)std::swap(first,second);
  return partition(first,frames,rtl,output)&&partition(second,frames,rtl,output);
 }
 return false;
}
inline Plan make(const json& rows,const std::vector<Frame>& detected,int width,int height,bool rtl=true){
 Plan plan;plan.evidence={{"version",1},{"method","detected-frame-context-order"},{"applied",false},{"direction",rtl?"right-to-left":"left-to-right"}};
 if(!rows.is_array()){plan.evidence["reason"]="invalid-rows";return plan;}
 plan.indices.resize(rows.size());std::iota(plan.indices.begin(),plan.indices.end(),size_t(0));
 auto reject=[&](const char* reason){plan.evidence["reason"]=reason;return plan;};
 if(width<=0||height<=0||int64_t(width)*height>40000000||rows.size()>150)return reject("invalid-page");
 std::vector<Bounds> boxes;std::set<int> ids;
 for(const auto& row:rows){
  if(!row.is_object()||!row.contains("id")||!row.at("id").is_number_integer()||!row.contains("bbox")||!row.at("bbox").is_array()||row.at("bbox").size()!=4)return reject("invalid-rows");
  const auto& id=row.at("id");if(id<1||id>std::numeric_limits<int>::max()||!ids.insert(id.get<int>()).second)return reject("invalid-rows");
  Bounds box;for(size_t i=0;i<4;i++){const auto& v=row.at("bbox").at(i);if(!v.is_number_integer()||v<0||v>std::numeric_limits<int>::max())return reject("invalid-rows");box[i]=v.get<int>();}
  if(!valid(box,width,height))return reject("invalid-rows");boxes.push_back(box);
 }
 std::vector<Frame> frames,candidates;
 for(const auto& frame:detected)if(std::isfinite(frame.score)&&frame.score>=.85&&frame.score<=1&&valid(frame.box,width,height))candidates.push_back(frame);
 std::stable_sort(candidates.begin(),candidates.end(),[](const Frame& a,const Frame& b){return a.score>b.score;});
 for(const auto& frame:candidates){bool duplicate=false;for(const auto& kept:frames){const auto intersection=shared(frame.box,kept.box);if(double(intersection)/(box_area(frame.box)+box_area(kept.box)-intersection)>=.9){duplicate=true;break;}}if(!duplicate)frames.push_back(frame);}
 plan.evidence["frameCount"]=frames.size();if(frames.size()<2||frames.size()>48)return reject("insufficient-frames");
 for(size_t i=0;i<frames.size();i++)for(size_t j=0;j<i;j++)if(double(shared(frames[i].box,frames[j].box))/std::min(box_area(frames[i].box),box_area(frames[j].box))>.1)return reject("overlapping-frames");
 std::vector<size_t> frame_indices(frames.size()),frame_order;std::iota(frame_indices.begin(),frame_indices.end(),size_t(0));
 if(!partition(frame_indices,frames,rtl,frame_order))return reject("unresolved-frame-order");
 std::vector<size_t> ranks(frames.size());json order=json::array();for(size_t i=0;i<frame_order.size();i++){ranks[frame_order[i]]=i;const auto& frame=frames[frame_order[i]];order.push_back({{"query",frame.query},{"bbox",frame.box},{"score",frame.score}});}plan.evidence["frames"]=std::move(order);
 struct Owned {size_t index,frame;};std::vector<Owned> owned;std::set<size_t> occupied;json assignments=json::array();
 for(size_t i=0;i<boxes.size();i++){
  double best=0,second=0;size_t owner=0;for(size_t f=0;f<frames.size();f++){const double coverage=double(shared(boxes[i],frames[f].box))/box_area(boxes[i]);if(coverage>best){second=best;best=coverage;owner=f;}else second=std::max(second,coverage);}
  json assignment={{"id",rows.at(i).at("id")},{"coverage",best},{"competingCoverage",second}};
  if(best>=.6&&second<=.4){owned.push_back({i,owner});occupied.insert(owner);assignment["frame"]=frames[owner].query;}else assignment["frame"]=nullptr;assignments.push_back(std::move(assignment));
 }
 plan.evidence["assignments"]=std::move(assignments);if(occupied.size()<2)return reject("single-owned-frame");
 auto sorted=owned;std::stable_sort(sorted.begin(),sorted.end(),[&](const Owned& a,const Owned& b){return ranks[a.frame]<ranks[b.frame];});
 for(size_t i=0;i<owned.size();i++)plan.indices[owned[i].index]=sorted[i].index;
 json before=json::array(),after=json::array();bool changed=false;for(size_t i=0;i<rows.size();i++){before.push_back(rows.at(i).at("id"));after.push_back(rows.at(plan.indices[i]).at("id"));changed|=plan.indices[i]!=i;}
 plan.evidence["before"]=std::move(before);plan.evidence["after"]=std::move(after);plan.evidence["applied"]=changed;plan.evidence["reason"]=changed?"frame-grouping":"already-ordered";return plan;
}
inline json ordered(const json& rows,const Plan& plan){
 require(rows.is_array()&&plan.indices.size()==rows.size(),"Invalid translation reading-order plan");json result=json::array();std::set<size_t> seen;
 for(const auto i:plan.indices){require(i<rows.size()&&seen.insert(i).second,"Reading-order plan lost or duplicated a region");result.push_back(rows.at(i));}return result;
}
}
