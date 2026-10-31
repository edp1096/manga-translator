import assert from 'node:assert/strict';
import {overlap,subtract,validRegionMask} from '../control/tools/geometry/masks.mjs';
let checks=0;const yes=(v)=>{assert(v);checks++;},near=(a,b)=>{assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);checks++;};
function mask(w,h,fn){const bits=Array.from({length:w*h},(_,i)=>fn(i%w,Math.floor(i/w))?1:0),runs=[];for(let i=0;i<bits.length;){if(!bits[i]){i++;continue;}const start=i;while(i<bits.length&&bits[i])i++;runs.push(start,i-start);}return {width:w,height:h,runs,pixels:bits.reduce((a,b)=>a+b,0)};}
const result={width:100,height:100},bubble=mask(10,10,(x,y)=>x>=2&&x<8&&y>=2&&y<8),fx=mask(10,10,(x,y)=>x>=7&&x<9&&y<4),a=overlap(bubble,fx,result);near(a.firstArea,3600);near(a.secondArea,800);near(a.intersectionArea,200);near(a.firstFraction,1/18);near(a.secondFraction,.25);
const inverse=overlap(fx,bubble,result);near(a.firstFraction,inverse.secondFraction);near(a.secondFraction,inverse.firstFraction);
const donut=mask(10,10,(x,y)=>x>=1&&x<9&&y>=1&&y<9&&!(x>=3&&x<7&&y>=3&&y<7)),center=mask(10,10,(x,y)=>x>=3&&x<7&&y>=3&&y<7);near(overlap(donut,center,result).firstArea,4800);near(overlap(donut,center,result).intersectionArea,0);
const minus=subtract(bubble,[fx],result,0);near(overlap(minus,fx,result).intersectionArea,0);near(minus.polygonOverlap.remainingArea,3400);near(minus.polygonOverlap.originalArea-minus.polygonOverlap.remainingArea,a.intersectionArea);
const padded=subtract(bubble,[fx],result,1);near(overlap(padded,padded.effectExclusions,result).intersectionArea,0);yes(padded.pixels<minus.pixels);yes(padded.polygonOverlap.remainingFraction>.5);
const entire=mask(10,10,()=>true),empty=mask(10,10,()=>false);near(overlap(bubble,empty,result).intersectionArea,0);near(subtract(bubble,[entire],result,0).polygonOverlap.remainingFraction,0);near(overlap(empty,bubble,result).firstFraction,0);
const small=mask(20,20,(x,y)=>x>=14&&x<18&&y<8),different=overlap(bubble,small,result);near(different.intersectionArea,a.intersectionArea);near(different.secondFraction,a.secondFraction);yes(subtract(bubble,[small],result)===null);
const duplicate=subtract(bubble,[fx,fx],result,0);yes(JSON.stringify(duplicate.runs)===JSON.stringify(minus.runs));near(duplicate.polygonOverlap.remainingArea,3400);
for(const change of [m=>m.width=0,m=>m.height=513,m=>m.runs=[-1,1],m=>m.runs=[0,0],m=>m.runs=[0,5,3,2],m=>m.runs=[99,2],m=>m.runs=[0],m=>m.pixels++,m=>m.imageWidth=101]){const m=structuredClone(fx);change(m);yes(overlap(bubble,m,result)===null);yes(subtract(bubble,[m],result)===null);}
for(const pad of [-1,3,.5,NaN])yes(subtract(bubble,[fx],result,pad)===null);
const row={type:'effect',bbox:[0,0,100,100],text:'effect',hitMask:{...fx,version:1,kind:'detector-text-region',sourceText:'effect',sourceBox:[0,0,100,100],imageWidth:100,imageHeight:100}};yes(validRegionMask(row,result));
for(const flag of ['manual','layoutOverride','displayOverride','ocrTruncated','truncated'])yes(!validRegionMask({...row,[flag]:true},result));
for(const change of [r=>r.text='stale',r=>r.hitMask.sourceBox[0]++,r=>r.hitMask.kind='hover-envelope',r=>r.hitMask.version=2,r=>r.bbox[2]=101]){const r=structuredClone(row);change(r);yes(!validRegionMask(r,result));}
// Independent raster oracle for aligned masks, including holes and disconnected pieces.
for(let seed=1;seed<=20;seed++){const x=mask(16,16,(a,b)=>(a*17+b*13+seed)%7<3),y=mask(16,16,(a,b)=>(a*11+b*5+seed)%9<2),r={width:160,height:160};const decode=m=>{const b=new Uint8Array(256);for(let i=0;i<m.runs.length;i+=2)b.fill(1,m.runs[i],m.runs[i]+m.runs[i+1]);return b;},xb=decode(x),yb=decode(y);const n=xb.reduce((n,v,i)=>n+(v&&yb[i]?1:0),0),q=overlap(x,y,r);near(q.intersectionArea,n*100);const cut=subtract(x,[y],r,0);yes(cut!==null);near(cut.polygonOverlap.remainingArea,(x.pixels-n)*100);}
console.log(`PASS polygon area and difference ${checks} checks`);
