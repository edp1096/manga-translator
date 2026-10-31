import {union,intersect,difference,FillRule} from 'clipper2-ts';

const scale=100;
const decodedMasks=new WeakMap();
const validMasks=new WeakMap();
function decode(mask,result){
 const w=mask?.width,h=mask?.height;
 if(!Number.isInteger(result?.width)||!Number.isInteger(result?.height)||result.width<=0||result.height<=0||result.width*result.height>40000000||!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>512||h>512||!Array.isArray(mask.runs)||mask.runs.length%2||mask.runs.length>w*h*2)return null;
 if(mask.imageWidth!==undefined&&mask.imageWidth!==result.width||mask.imageHeight!==undefined&&mask.imageHeight!==result.height)return null;
 const signature=[w,h,result.width,result.height,mask.pixels,mask.runs.join(',')].join('|'),cached=decodedMasks.get(mask);
 if(cached?.signature===signature)return cached.value;
 const bits=new Uint8Array(w*h);let end=0,pixels=0;
 for(let i=0;i<mask.runs.length;i+=2){const at=mask.runs[i],n=mask.runs[i+1];if(!Number.isInteger(at)||!Number.isInteger(n)||at<end||n<1||at+n>bits.length)return null;bits.fill(1,at,at+n);end=at+n;pixels+=n;}
 if(mask.pixels!==undefined&&mask.pixels!==pixels)return null;
 const value={bits,width:w,height:h,pixels};decodedMasks.set(mask,{signature,value});return value;
}
function paths(decoded,result){
 if(decoded.paths)return decoded.paths;
 const {bits,width:w,height:h}=decoded,rectangles=[];let active=new Map();
 for(let y=0;y<h;y++){
  const next=new Map();for(let x=0;x<w;){if(!bits[y*w+x]){x++;continue;}const left=x++;while(x<w&&bits[y*w+x])x++;const key=left+':'+x,prior=active.get(key);if(prior){prior[3]=y+1;next.set(key,prior);}else{const b=[left,y,x,y+1];rectangles.push(b);next.set(key,b);}}active=next;
 }
 if(rectangles.length>8192)throw new RangeError('Mask contour is too complex');
 decoded.bounds=rectangles.length?[Math.min(...rectangles.map(b=>b[0]))*result.width/w,Math.min(...rectangles.map(b=>b[1]))*result.height/h,Math.max(...rectangles.map(b=>b[2]))*result.width/w,Math.max(...rectangles.map(b=>b[3]))*result.height/h]:[0,0,0,0];
 const polygons=rectangles.map(([l,t,r,b])=>{const x=Math.round(l*result.width/w*scale),y=Math.round(t*result.height/h*scale),right=Math.round(r*result.width/w*scale),bottom=Math.round(b*result.height/h*scale);return [{x,y},{x:right,y},{x:right,y:bottom},{x,y:bottom}];});
 decoded.paths=polygons.length?union(polygons,FillRule.NonZero):[];return decoded.paths;
}
function area(polygons){let twice=0;for(const p of polygons)for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];twice+=a.x*b.y-b.x*a.y;}return Math.abs(twice)/(2*scale*scale);}
function encode(bits){const runs=[];for(let i=0;i<bits.length;){if(!bits[i]){i++;continue;}const start=i;while(i<bits.length&&bits[i])i++;runs.push(start,i-start);}return runs;}

// Both denominators matter: a tiny effect may be completely inside a large
// balloon, while a large effect may barely touch a small balloon.
export function overlap(first,second,result){
 try{const a=decode(first,result),b=decode(second,result);if(!a||!b)return null;const ap=paths(a,result),bp=paths(b,result),firstArea=a.area??(a.area=area(ap)),secondArea=b.area??(b.area=area(bp));
  let disjoint=a.bounds[2]<=b.bounds[0]||b.bounds[2]<=a.bounds[0]||a.bounds[3]<=b.bounds[1]||b.bounds[3]<=a.bounds[1];
  if(!disjoint&&a.width===b.width&&a.height===b.height){disjoint=true;for(let i=0;i<a.bits.length;i++)if(a.bits[i]&&b.bits[i]){disjoint=false;break;}}
  const intersectionArea=ap.length&&bp.length&&!disjoint?area(intersect(ap,bp,FillRule.NonZero)):0;
  return {firstArea,secondArea,intersectionArea,firstFraction:firstArea?Math.min(1,intersectionArea/firstArea):0,secondFraction:secondArea?Math.min(1,intersectionArea/secondArea):0};
 }catch{return null;}
}
export function validRegionMask(region,result){
 if(!result)return false;
 const m=region?.hitMask,b=region?.bbox,same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===4&&b.length===4&&a.every((x,i)=>Number.isFinite(x)&&x===b[i]);
 if(['manual','layoutOverride','displayOverride','ocrTruncated','truncated'].some(k=>region?.[k])||m?.version!==1||m.kind!=='detector-text-region'||m.sourceText!==region.text||!same(b,m.sourceBox)||m.imageWidth!==result.width||m.imageHeight!==result.height||!Array.isArray(b)||b[0]<0||b[1]<0||b[2]>result.width||b[3]>result.height||b[2]<=b[0]||b[3]<=b[1])return false;
 const decoded=decode(m,result);if(!decoded?.pixels)return false;
 const key=b.join(','),cached=validMasks.get(region);if(cached?.decoded===decoded&&cached.key===key)return cached.valid;
 let valid=true;for(let i=0;i<decoded.bits.length;i++)if(decoded.bits[i]){const x=(i%decoded.width+.5)*result.width/decoded.width,y=(Math.floor(i/decoded.width)+.5)*result.height/decoded.height;if(x<b[0]||x>=b[2]||y<b[1]||y>=b[3]){valid=false;break;}}
 validMasks.set(region,{decoded,key,valid});return valid;
}
// Retain the exact common raster after Clipper's polygon difference. Refuse
// mixed grids rather than resampling a protected glyph into fewer pixels.
export function subtract(background,exclusions,result,padding=1){
 try{const base=decode(background,result);if(!base||!Number.isInteger(padding)||padding<0||padding>2||!Array.isArray(exclusions)||exclusions.length>32)return null;
  const blocked=new Uint8Array(base.bits.length),w=base.width,h=base.height;
  for(const item of exclusions){const cut=decode(item,result);if(!cut||cut.width!==w||cut.height!==h||!cut.pixels)return null;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(cut.bits[y*w+x])for(let dy=-padding;dy<=padding;dy++)for(let dx=-padding;dx<=padding;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<w&&yy<h)blocked[yy*w+xx]=1;}}
  const blockedMask={width:w,height:h,runs:encode(blocked)},bp=paths(base,result),cuts=paths({width:w,height:h,bits:blocked},result),remaining=cuts.length?difference(bp,cuts,FillRule.NonZero):bp;
  const bits=base.bits.map((v,i)=>v&&!blocked[i]?1:0),rasterPaths=paths({width:w,height:h,bits},result),polygonArea=area(remaining),rasterArea=area(rasterPaths);
  if(Math.abs(polygonArea-rasterArea)>.01)return null;
  return {...background,width:w,height:h,runs:encode(bits),pixels:bits.reduce((n,v)=>n+v,0),effectExclusions:blockedMask,polygonOverlap:{originalArea:area(bp),remainingArea:polygonArea,remainingFraction:area(bp)?polygonArea/area(bp):0}};
 }catch{return null;}
}
