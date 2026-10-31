import {union,intersect,difference,FillRule} from 'clipper2-ts';
export {overlap,subtract,validRegionMask} from './masks.mjs';
export const version='clipper2-ts/2.0.1-18';
export const interaction='filled-text-envelope-1';
const scale=100,rectangle=([x,y,right,bottom])=>[{x,y},{x:right,y},{x:right,y:bottom},{x,y:bottom}];
const empty='polygon(0% 0%,0% 0%,0% 0%)';
// Filled outer text envelope for pointer interaction. Raw glyph masks remain
// unchanged for restoration and collision checks.
function hull(points){
 const sorted=points.sort((a,b)=>a.x-b.x||a.y-b.y).filter((p,i,a)=>!i||p.x!==a[i-1].x||p.y!==a[i-1].y);
 if(sorted.length<3)return [];
 const turn=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),lower=[],upper=[];
 for(const p of sorted){while(lower.length>1&&turn(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
 for(let i=sorted.length-1;i>=0;i--){const p=sorted[i];while(upper.length>1&&turn(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
 return [...lower.slice(0,-1),...upper.slice(0,-1)];
}
// Null requests the legacy rectangle fallback. This metadata is never used to erase pixels.
export function clip(region,result,cuts,asContours=false){
 const m=region.hitMask,b=region.bbox;
 if(!m||region.manual||region.layoutOverride||m.version!==1||m.kind!=='detector-text-region'||m.imageWidth!==result.width||m.imageHeight!==result.height||m.sourceText!==region.text)return null;
 if(!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||!Array.isArray(m.sourceBox)||m.sourceBox.length!==4||!b.every((v,i)=>v===m.sourceBox[i]))return null;
 if(!Number.isInteger(result.width)||!Number.isInteger(result.height)||result.width<=0||result.height<=0||result.width*result.height>40000000||b[0]<0||b[1]<0||b[2]>result.width||b[3]>result.height||b[2]<=b[0]||b[3]<=b[1])return null;
 if(!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width<3||m.height<3||m.width>512||m.height>512||!Array.isArray(m.runs)||!m.runs.length||m.runs.length%2||m.runs.length>m.width*m.height*2)return null;
 const rows=new Map();let end=0,pixels=0;
 for(let i=0;i<m.runs.length;i+=2){
  const start=m.runs[i],length=m.runs[i+1];
  if(!Number.isInteger(start)||!Number.isInteger(length)||start<end||length<1||start+length>m.width*m.height||start%m.width+length>m.width)return null;
  end=start+length;pixels+=length;const x=start%m.width,y=Math.floor(start/m.width);
  const prior=rows.get(y);rows.set(y,[Math.min(prior?.[0]??x,x),Math.max(prior?.[1]??x+length,x+length)]);
 }
 if(pixels!==m.pixels)return null;
 try{
  const cellX=result.width/m.width,cellY=result.height/m.height,hullPoints=[];
  for(const [y,[left,right]] of rows){
   const x0=Math.max(b[0],left*cellX),x1=Math.min(b[2],right*cellX),y0=Math.max(b[1],y*cellY),y1=Math.min(b[3],(y+1)*cellY);
   if(x1<=x0||y1<=y0)continue;
   hullPoints.push(...rectangle([x0-cellX,y0-cellY,x1+cellX,y1+cellY].map(v=>Math.round(v*scale))));
  }
  const outer=hull(hullPoints);if(outer.length<3)return null;
  const shape=intersect([outer],[rectangle(b.map(v=>Math.round(v*scale)))],FillRule.NonZero);
  if(!shape.length)return null;
  const protectedPaths=cuts.map(c=>rectangle(c.map(v=>Math.round(v*scale)))),remaining=protectedPaths.length?difference(shape,union(protectedPaths,FillRule.NonZero),FillRule.NonZero):shape;
  if(!remaining.length)return asContours?[]:empty;
  if(asContours)return remaining.map(contour=>contour.map(v=>[(v.x/scale-b[0])/(b[2]-b[0]),(v.y/scale-b[1])/(b[3]-b[1])]));
  const points=['0% 0%'];
  for(const contour of remaining){const p=contour.map(v=>`${(v.x/scale-b[0])/(b[2]-b[0])*100}% ${(v.y/scale-b[1])/(b[3]-b[1])*100}%`);if(p.length)points.push(...p,p[0],'0% 0%');}
  return `polygon(evenodd,${points.join(',')})`;
 }catch{return null;}
}
