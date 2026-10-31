#include "../../../native/ocr_long_paragraph.hpp"
#include <cassert>
int main(){PageImage image{300,500,std::vector<uint8_t>(300*500*3,255)};auto ink=[&](int x,int y){for(int c=0;c<3;c++)image.rgb[(y*300+x)*3+c]=0;};for(int x0:{40,80,120})for(int y0=40;y0<350;y0+=20)for(int y=y0;y<y0+12;y++)for(int x=x0;x<x0+12;x++)ink(x,y);
 Region source{0,0,.8f,{35,20,155,380},std::vector<uint8_t>(64*64,1),64};std::vector<Region> found{source};const std::string part="これは長い文章です。続きを最後まで読みます。";json row={{"type","text"},{"bbox",source.box},{"detectorConfidence",source.score},{"ocrTruncated",true},{"text",part}};size_t checks=0,calls=0;auto read=[&](Box,int,int){calls++;return part;};auto call=[&](){return long_paragraph::recovery(image,row,found,read);};auto good=call();assert(!good.is_null()&&calls==9&&good["columns"].size()==3&&good["text"]==part+part+part);checks++;
 for(auto flag:{"manual","layoutOverride","displayOverride","truncated","panelCandidate"}){row[flag]=true;assert(call().is_null());row.erase(flag);checks++;}
 row["type"]="effect";assert(call().is_null());row["type"]="text";checks++;
 row["ocrTruncated"]=false;assert(call().is_null());row["ocrTruncated"]=true;checks++;
 row["detectorConfidence"]=.4;assert(call().is_null());row["detectorConfidence"]=source.score;checks++;
 found.push_back(source);assert(call().is_null());found.pop_back();checks++;
 assert(long_paragraph::recovery(image,row,found,[&](Box,int,int padding){return padding==24?std::string("違う文章です"):part;}).is_null());checks++;
 assert(long_paragraph::recovery(image,row,found,[&](Box,int,int){return std::string{};}).is_null());checks++;
 assert(long_paragraph::recovery(image,row,found,[&](Box,int,int){return std::string("まったく別の文章を繰り返しています。長いものです。");}).is_null());checks++;
 const auto saved=image;for(int y=100;y<120;y++)for(int x=40;x<132;x++)ink(x,y);assert(call().is_null());image=saved;checks++;
 // Sparse speed lines crossing a gutter do not prevent consensus recovery.
 for(int x=40;x<132;x++)ink(x,100);assert(!call().is_null());image=saved;checks++;
 // A large title and unequal column spacing retain right-to-left order.
 const auto originalSource=source;image.rgb.assign(image.rgb.size(),255);
 for(auto band:std::array<std::array<int,2>,3>{{{40,12},{80,12},{150,24}}})
  for(int y0=40;y0<350;y0+=20)for(int y=y0;y<y0+12;y++)for(int x=band[0];x<band[0]+band[1];x++)ink(x,y);
 source.box={35,20,185,380};found={source};row["bbox"]=source.box;
 auto mixed=call();assert(!mixed.is_null()&&mixed["columns"].size()==3);checks++;
 // A continuous vertical mark in every gutter candidate is not a speed line.
 for(int y=50;y<350;y++)for(int x=52;x<80;x++)ink(x,y);
 assert(call().is_null());checks++;
 image=saved;source=originalSource;found={source};row["bbox"]=source.box;
 // No physical ink is dropped: columns tile the unchanged source box.
 auto columns=long_paragraph::columns(image,row,found);std::reverse(columns.begin(),columns.end());int end=source.box[0];for(auto b:columns){assert(b[0]==end&&b[1]==source.box[1]&&b[3]==source.box[3]);end=b[2];}assert(end==source.box[2]);checks++;
 std::cout<<"PASS "<<checks<<" long paragraph guards\n";}
