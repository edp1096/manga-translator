#pragma once
#include "layout_refinement.hpp"

// Raw inference belongs to the current page; never retain it in global state.
inline bool restoration_effect_matches(const Region& region,const LayoutRaw* raw){
 if(!raw||region.cls<0||region.cls>3||raw->mask_side<1||region.query<0||size_t(region.query)>=raw->logits.size()/5||region.mask_side!=raw->mask_side||region.mask.size()!=size_t(region.mask_side)*region.mask_side)return false;
 if(raw->masks.size()<(size_t(region.query)+1)*region.mask.size()||!std::isfinite(region.score))return false;
 const auto* logits=raw->logits.data()+region.query*5;const auto* bits=raw->masks.data()+size_t(region.query)*region.mask.size();
 if(std::max_element(logits,logits+4)-logits!=region.cls||std::abs(region.score-1/(1+std::exp(-logits[region.cls])))>.0001)return false;
 for(size_t i=0;i<region.mask.size();i++)if(bool(region.mask[i])!=(bits[i]>0))return false;return true;
}
inline bool restoration_effect_owned(const Region& source,const Region& neighbor,int x,int y,const PageImage& image,const LayoutRaw* raw){
 if(!raw||raw->mask_side<1||source.query<0||neighbor.query<0||raw->masks.size()<(size_t(std::max(source.query,neighbor.query))+1)*raw->mask_side*raw->mask_side||x<0||y<0||x>=image.width||y>=image.height)return false;const int side=raw->mask_side,mx=int((x+.5)*side/image.width),my=int((y+.5)*side/image.height);const size_t offset=size_t(my)*side+mx;
 auto score=[&](const Region& r){return r.score/(1+std::exp(-raw->masks[size_t(r.query)*side*side+offset]));};
 const auto text=score(source),effect=score(neighbor);return text>=.9&&effect<.2&&text>=effect*4;
}

// An independently reread source inside a protected enclosure can claim its
// positive glyph cells against a weak effect query. Preserve the normal
// fourfold weighted margin; an actual competing effect still vetoes erasure.
// The caller must separately establish enclosure geometry and reading proof.
inline bool restoration_enclosure_effect_owned(const Region& source,const Region& neighbor,int x,int y,const PageImage& image,const LayoutRaw* raw){
 if(!raw||raw->mask_side<1||source.cls!=0||neighbor.cls!=1||!std::isfinite(source.score)||source.score<.9f||source.score>1||!std::isfinite(neighbor.score)||neighbor.score<.2f||neighbor.score>=.3f||source.query<0||neighbor.query<0||raw->masks.size()<(size_t(std::max(source.query,neighbor.query))+1)*raw->mask_side*raw->mask_side||x<0||y<0||x>=image.width||y>=image.height)return false;
 const int side=raw->mask_side,mx=int((x+.5)*side/image.width),my=int((y+.5)*side/image.height);const size_t offset=size_t(my)*side+mx;
 const auto textLogit=raw->masks[size_t(source.query)*side*side+offset];if(!(textLogit>0))return false;
 const double text=source.score/(1+std::exp(-textLogit)),effect=neighbor.score/(1+std::exp(-raw->masks[size_t(neighbor.query)*side*side+offset]));
 return std::isfinite(text)&&std::isfinite(effect)&&text>=effect*4;
}
