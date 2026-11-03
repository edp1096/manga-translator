/* Rotation changes translated ink only, never the OCR or restoration mask. */
(()=>{
if(globalThis.MangaRotation)return;
const cache=new WeakMap(),rad=Math.PI/180;
const normalize=a=>Number.isFinite(a)?((a+180)%360+360)%360-180:0;
const tilt=a=>{let v=normalize(a);if(v>90)v-=180;if(v< -90)v+=180;if(v>45)v-=90;if(v< -45)v+=90;return v;};
const angle=r=>normalize(Number.isFinite(r.rotation)?r.rotation:r._rotation||0);
function corners(box,degrees=0){const [l,t,r,b]=box,cx=(l+r)/2,cy=(t+b)/2,c=Math.cos(degrees*rad),s=Math.sin(degrees*rad);return [[l,t],[r,t],[r,b],[l,b]].map(([x,y])=>[cx+(x-cx)*c-(y-cy)*s,cy+(x-cx)*s+(y-cy)*c]);}
function inside(points,result){return points.every(([x,y])=>x>=-.01&&y>=-.01&&x<=result.width+.01&&y<=result.height+.01);}
function hull(points){const sorted=points.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);const half=p=>{const out=[];for(const v of p){while(out.length>1&&cross(out.at(-2),out.at(-1),v)<=0)out.pop();out.push(v);}return out.slice(0,-1);};return [...half(sorted),...half([...sorted].reverse())];}
function estimate(region,result){
 const m=region.hitMask;if(!m||region.manual||region.ocrTruncated||region.truncated)return 0;
 const signature=JSON.stringify([region.bbox,region.text,result.width,result.height]);const saved=cache.get(m);if(saved?.signature===signature)return saved.angle;
 let found=0;
 // Editing the translated box does not change the source mask. Source text and
 // source bbox still have to match the detector proof exactly.
 const source={...region,layoutOverride:false,displayOverride:false};
 if(globalThis.MangaPolygon?.validRegionMask(source,result)&&m.runs.length<=16384){
  let n=0,sx=0,sy=0,xx=0,yy=0,xy=0;const points=[],dx=result.width/m.width,dy=result.height/m.height;
  for(let i=0;i<m.runs.length;i+=2){const at=m.runs[i],len=m.runs[i+1],row=Math.floor(at/m.width),col=at%m.width;if(col+len>m.width)return 0;const y=(row+.5)*dy;points.push([col*dx,row*dy],[(col+len)*dx,row*dy],[col*dx,(row+1)*dy],[(col+len)*dx,(row+1)*dy]);for(let j=0;j<len;j++){const x=(col+j+.5)*dx;n++;sx+=x;sy+=y;xx+=x*x;yy+=y*y;xy+=x*y;}}
  if(n>=12){const vx=xx/n-(sx/n)**2,vy=yy/n-(sy/n)**2,cov=xy/n-sx*sy/(n*n),disc=Math.hypot(vx-vy,2*cov),major=(vx+vy+disc)/2,minor=(vx+vy-disc)/2;
   if(minor>0&&major/minor>=6){const pca=tilt(Math.atan2(2*cov,vx-vy)/2/rad),outline=hull(points);let best=null;
    for(let i=0;i<outline.length;i++){const p=outline[i],q=outline[(i+1)%outline.length],a=Math.atan2(q[1]-p[1],q[0]-p[0]),c=Math.cos(a),s=Math.sin(a);let l=Infinity,r=-Infinity,t=Infinity,b=-Infinity;for(const [x,y]of outline){const u=x*c+y*s,v=-x*s+y*c;l=Math.min(l,u);r=Math.max(r,u);t=Math.min(t,v);b=Math.max(b,v);}const area=(r-l)*(b-t);if(!best||area<best.area)best={area,w:r-l,h:b-t,angle:tilt(a/rad+(b-t>r-l?90:0))};}
    if(best&&Math.max(best.w,best.h)/Math.min(best.w,best.h)>=2.5&&n*dx*dy/best.area>=.3&&Math.abs(tilt(pca-best.angle))<=4&&Math.abs(best.angle)>=5)found=Math.round(best.angle*10)/10;
   }
  }
 }
 cache.set(m,{signature,angle:found});return found;
}
function allowed(region,result,degrees=angle(region)){
 const polygon=corners(region.box,degrees);if(!inside(polygon,result))return false;
 const bg=region.mode==='white'?region.whiteBackground:region.restorationMask?.bubble||region.restorationMask?.enclosure;
 if(bg&&bg.kind!=='box'){
  const covered=globalThis.MangaPolygon?.polygonCoverage(polygon,bg,result);if(covered===null||covered===undefined||covered<.98)return false;
  if(bg.effectExclusions&&(globalThis.MangaPolygon?.polygonCoverage(polygon,bg.effectExclusions,result)||0)>0)return false;
 }
 return true;
}
function apply(result,layout,light=false){
 return {...result,_rotationPrepared:true,regions:result.regions.map((region,index)=>{
  const r={...region};delete r._rotation;
  if(Number.isFinite(r.rotation)||light||!['replace','white','restore'].includes(r.mode)||!r.translation?.trim())return r;
  const degrees=estimate(r,result);if(!degrees)return r;
  const baseline=layout(r);if(!baseline)return r;
  const [l,t,right,bottom]=r.box,w=right-l,h=bottom-t,cx=(l+right)/2,cy=(t+bottom)/2;let best=null;
  for(const ws of [1,.85,.7,.55])for(const hs of [1,.7,.45,.25,.12]){
   const nw=w*ws,nh=h*hs;if(nw<12||nh<12)continue;const box=[cx-nw/2,cy-nh/2,cx+nw/2,cy+nh/2],polygon=corners(box,degrees);
   if(polygon.some(([x,y])=>x<l||x>right||y<t||y>bottom))continue;
   const candidate={...r,box,_rotation:degrees};if(!allowed(candidate,result,degrees))continue;
   if([...result.regions,...(result.preservedRegions||[])].some((other,i)=>i!==index&&(other.text?.trim()||other.translation?.trim())&&[other.bbox,other.box].filter(Array.isArray).some(b=>{const otherPolygon=corners(b,b===other.box?angle(other):0);if(Math.max(...polygon.map(p=>p[0]))<=Math.min(...otherPolygon.map(p=>p[0]))||Math.max(...otherPolygon.map(p=>p[0]))<=Math.min(...polygon.map(p=>p[0]))||Math.max(...polygon.map(p=>p[1]))<=Math.min(...otherPolygon.map(p=>p[1]))||Math.max(...otherPolygon.map(p=>p[1]))<=Math.min(...polygon.map(p=>p[1])))return false;const overlap=globalThis.MangaPolygon?.polygonOverlap(polygon,otherPolygon);return !overlap||overlap.intersectionArea>1;})))continue;
   const fitted=layout(candidate,box,baseline.fontSize);if(!fitted||fitted.fontSize<Math.max(8,baseline.fontSize*.8))continue;
   if(!best||fitted.fontSize>best.layout.fontSize||fitted.fontSize===best.layout.fontSize&&fitted.breaks<best.layout.breaks)best={candidate,layout:fitted};
  }
  return best?{...best.candidate,automaticRotation:true}:r;
 })};
}
function resize(box,degrees,handle,dx,dy){
 const c=Math.cos(degrees*rad),s=Math.sin(degrees*rad),u=dx*c+dy*s,v=-dx*s+dy*c,w=box[2]-box[0],h=box[3]-box[1];let l=-w/2,r=w/2,t=-h/2,b=h/2;
 if(handle.includes('w'))l=Math.min(r-12,l+u);if(handle.includes('e'))r=Math.max(l+12,r+u);if(handle.includes('n'))t=Math.min(b-12,t+v);if(handle.includes('s'))b=Math.max(t+12,b+v);
 const x=(box[0]+box[2])/2+(l+r)/2*c-(t+b)/2*s,y=(box[1]+box[3])/2+(l+r)/2*s+(t+b)/2*c;return [x-(r-l)/2,y-(b-t)/2,x+(r-l)/2,y+(b-t)/2];
}
globalThis.MangaRotation={angle,normalize,corners,inside,estimate,allowed,apply,resize};
})();
