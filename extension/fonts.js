/* Packaged, unmodified KERIS school-safe fonts; see fonts/LICENSE.txt. */
(() => {
if(globalThis.MangaFonts)return;
const catalog=Object.freeze({dialogue:'바른돋움',reflective:'날개',narration:'바른바탕',shout:'여행',impact:'투호',handwritten:'민들레홀씨',stone:'돌담',shower:'소나기',serif:'산뜻바탕',kimdaegeon:'솔뫼 김대건'});
const groups=Object.freeze([
 {title:'돋움체',ids:['dialogue']},
 {title:'바탕체',ids:['narration','serif']},
 {title:'손글씨체',ids:['reflective','handwritten','stone']},
 {title:'강조·효과음체',ids:['shout','impact','kimdaegeon','shower']}
].map(group=>Object.freeze({...group,ids:Object.freeze(group.ids)})));
const legacy=size=>`600 ${size}px "Noto Sans CJK KR", "Malgun Gothic", sans-serif`;
let loader,revision=0;const pending=new Map(),loaded=new Set();
const roles=Object.freeze({dialogue:'일반 대사',narration:'독백·서술',shout:'강조·외침',impact:'강한 효과음'});
const defaultPolicy=Object.freeze(Object.fromEntries(Object.keys(roles).map(role=>[role,{font:'auto',bold:['shout','impact'].includes(role)}])));
function normalizePolicy(input){return Object.fromEntries(Object.keys(roles).map(role=>{const p=input?.[role];return [role,{font:p?.font==='default'||Object.hasOwn(catalog,p?.font)?p.font:'auto',bold:typeof p?.bold==='boolean'?p.bold:defaultPolicy[role].bold}];}));}
let policy=normalizePolicy();
function configure(value){const next=normalizePolicy(value);if(JSON.stringify(next)===JSON.stringify(policy))return false;policy=next;revision++;return true;}
function category(region){
 const role=region.fontStyle?.role,short=typeof region.translation==='string'&&!!region.translation.trim()&&[...region.translation.replace(/\s/gu,'')].length<=24,effect=region.type==='effect'&&!['DIALOGUE','LABEL'].includes(region.textVerification?.role);
 if(role==='impact'&&effect&&short)return 'impact';
 if(role==='narration'&&!effect)return 'narration';
 if(role==='shout'&&short&&!effect)return 'shout';
 return 'dialogue';
}
const defaultChoice=role=>role==='narration'?'reflective':role;
function pageDefaults(value){return {font:value?.font==='default'||Object.hasOwn(catalog,value?.font)?value.font:'auto',weight:[400,700].includes(value?.weight)?value.weight:'auto'};}
function withPage(region,result){return {...region,_pageFontDefaults:pageDefaults(result.fontDefaults)};}
function choice(region,target,light=false){
 if(light)return 'default';
 if(region.fontChoice==='friendly')return 'dialogue';
 if(region.fontChoice==='default'||Object.hasOwn(catalog,region.fontChoice))return region.fontChoice;
 const page=pageDefaults(region._pageFontDefaults);if(page.font!=='auto')return page.font;
 if(target!=='Korean')return 'default';
 const role=category(region);if(policy[role].font!=='auto')return policy[role].font;
 const source=region.sourceTypography;if(source?.version===1&&source.key===sourceKey(region)&&Object.hasOwn(catalog,source.choice))return source.choice;
 return defaultChoice(role);
}
async function ensure(result,light=result._fontLight===true){
 const ids=new Set(result.regions.map(r=>choice(withPage(r,result),result.target,light)));
 await Promise.all([...ids].filter(id=>id!=='default').map(id=>{
  if(!pending.has(id))pending.set(id,(async()=>{
   try{
    if(!loader||typeof FontFace==='undefined')return;
    const data=await loader(id),bytes=typeof data==='string'?Uint8Array.from(atob(data.slice(data.indexOf(',')+1)),c=>c.charCodeAt(0)):data;
    const face=await new FontFace('MangaSchool_'+id,bytes,{weight:'400'}).load();
    document.fonts.add(face);loaded.add(id);revision++;
   }catch(error){console.warn('Manga font fallback:',id,error.message);}
  })());
  return pending.get(id);
 }));
}
function decorate(result,light=result._fontLight===true){return {...result,_fontLight:light,regions:result.regions.map(r=>({...withPage(r,result),_fontId:choice(withPage(r,result),result.target,light),_fontLight:light}))};}
function weight(region){
 if(region?._fontLight)return 400;
 if(region?.fontWeight===400||region?.fontWeight===700)return region.fontWeight;
 const page=pageDefaults(region?._pageFontDefaults);if(page.weight!=='auto')return page.weight;
 // Reuse semantic classification; punctuation alone does not make speech bold.
 return policy[category(region)].bold?700:400;
}
function css(size,region){const id=region?._fontId;return loaded.has(id)?`${weight(region)} ${size}px "MangaSchool_${id}", "Noto Sans CJK KR", "Malgun Gothic", sans-serif`:!region?._fontLight?`${weight(region)} ${size}px "Noto Sans CJK KR", "Malgun Gothic", sans-serif`:legacy(size);}
// Source-image shape matching is conservative: ambiguity retains the existing
// typography policy. This is not a semantic guess from the translated sentence.
const sourceKey=r=>JSON.stringify([3,r.text,r.bbox,r.fontStyle?.role,r.type]);
function sourceEligible(r){
 if(policy[category(r)].font!=='auto'||r.manual||r.fontChoice&&r.fontChoice!=='auto'||r.ocrTruncated||r.truncated||!r.text||!Array.isArray(r.bbox))return false;
 return r.type==='text'&&category(r)==='narration'||r.type==='effect'&&category(r)==='impact';
}
function shapeDescriptor(data,w,h,characters){
 const bits=new Uint8Array(w*h);let count=0,x0=w,y0=h,x1=0,y1=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const n=y*w+x,j=n*4;if(data[j+3]<128||Math.max(data[j],data[j+1],data[j+2])>=170)continue;bits[n]=1;count++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}
 if(count<24||count>w*h*.7||x1-x0<8||y1-y0<8)return null;
 const area=(x1-x0)*(y1-y0),cell=Math.sqrt(area/Math.max(1,characters));let perimeter=0,axis=0,diagonal=0,slant=0,total=0;
 const distances=new Uint16Array(w*h);distances.fill(6550);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const n=y*w+x;if(!bits[n]){distances[n]=0;continue;}distances[n]=Math.min(x?distances[n-1]+1:1,y?distances[n-w]+1:1);perimeter+=!x||!bits[n-1]?1:0;perimeter+=x===w-1||!bits[n+1]?1:0;perimeter+=!y||!bits[n-w]?1:0;perimeter+=y===h-1||!bits[n+w]?1:0;}
 for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const n=y*w+x;if(bits[n])distances[n]=Math.min(distances[n],x<w-1?distances[n+1]+1:1,y<h-1?distances[n+w]+1:1);}
 const widths=[];
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
  const n=y*w+x;if(bits[n]&&distances[n]>=distances[n-1]&&distances[n]>=distances[n+1]&&distances[n]>=distances[n-w]&&distances[n]>=distances[n+w])widths.push(distances[n]/cell);
  const gx=bits[n-w+1]+2*bits[n+1]+bits[n+w+1]-bits[n-w-1]-2*bits[n-1]-bits[n+w-1],gy=bits[n+w-1]+2*bits[n+w]+bits[n+w+1]-bits[n-w-1]-2*bits[n-w]-bits[n-w+1];
  if(!gx&&!gy)continue;const a=Math.abs(gx),b=Math.abs(gy);if(Math.min(a,b)<=Math.max(a,b)*.25)axis++;else diagonal++;slant+=gx*gy/Math.max(1,gx*gx+gy*gy);total++;
 }
 widths.sort((a,b)=>a-b);const q=p=>widths[Math.min(widths.length-1,Math.floor(widths.length*p))]||0;
 return [count/area,2*count/Math.max(1,perimeter)/cell,axis/Math.max(1,total),diagonal/Math.max(1,total),slant/Math.max(1,total),q(.5),q(.9)-q(.1)];
}
function shapeDistance(a,b){const scales=[.35,.08,.5,.5,.15,.08,.10];return a.reduce((n,v,i)=>n+Math.min(2,Math.abs(v-b[i])/scales[i]),0)/a.length;}
const shapeTemplates=new Map();
function templateShapes(text,aspect,ids){
 const chars=[...text.replace(/\s/gu,'')],key=JSON.stringify([text,Math.round(aspect*4)/4,ids]);if(shapeTemplates.has(key))return shapeTemplates.get(key);
 const vertical=aspect<.7,cols=Math.max(1,Math.ceil(Math.sqrt(chars.length*Math.max(.1,Math.min(10,aspect))))),rows=Math.ceil(chars.length/cols),c=document.createElement('canvas');c.width=cols*48+16;c.height=rows*48+16;const ctx=c.getContext('2d'),out=[];
 for(const id of ids)for(const weight of [400,700]){ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle='#111';ctx.font=`${weight} 40px "MangaSchool_${id}"`;ctx.textAlign='center';ctx.textBaseline='middle';
  for(let i=0;i<chars.length;i++){const x=vertical?cols-1-Math.floor(i/rows):i%cols,y=vertical?i%rows:Math.floor(i/cols);ctx.fillText(chars[i],8+x*48+24,8+y*48+24);}
  const features=shapeDescriptor(ctx.getImageData(0,0,c.width,c.height).data,c.width,c.height,chars.length);if(features)out.push({id,features});
 }
 c.width=c.height=0;if(shapeTemplates.size>=64)shapeTemplates.clear();shapeTemplates.set(key,out);return out;
}
const sourceInside=(r,result,geometry)=>r.type==='text'&&!!geometry?.bubbles?.some(bg=>globalThis.MangaRender?.coverage(bg,result,r.bbox)>=.9);
const analysisTasks=new WeakMap();
async function analyze(result,original,geometry,light=false){
 if(light||result.target!=='Korean'||!original||pageDefaults(result.fontDefaults).font!=='auto')return false;
 const candidates=result.regions.filter(r=>sourceEligible(r)&&(r.sourceTypography?.key!==sourceKey(r)||r.sourceTypography.inside!==sourceInside(r,result,geometry)));if(!candidates.length)return false;
 if(analysisTasks.has(result))return analysisTasks.get(result);
 const task=(async()=>{
  const ids=[...new Set(candidates.flatMap(r=>r.type==='effect'?['impact','kimdaegeon','shower']:['dialogue','narration','reflective','handwritten','stone']))];
  await ensure({target:'Korean',regions:ids.map(fontChoice=>({fontChoice}))});if(ids.some(id=>!loaded.has(id)))return false;
  const im=new Image();im.src=original;await im.decode();if(im.width!==result.width||im.height!==result.height)return false;let changed=false;
  for(const r of candidates){await new Promise(resolve=>setTimeout(resolve,0));const key=sourceKey(r),text=r.text.replace(/\s/gu,''),b=r.bbox,chars=[...text];let selected;
   if(chars.length>=(r.type==='effect'?2:6)&&chars.length<=64&&b.length===4&&b.every(Number.isFinite)&&b[0]>=0&&b[1]>=0&&b[2]<=result.width&&b[3]<=result.height&&b[2]>b[0]&&b[3]>b[1]&&Math.sqrt((b[2]-b[0])*(b[3]-b[1])/chars.length)>=20){
    // Narration inside a normal balloon keeps the established body typography.
    const inside=sourceInside(r,result,geometry);
    if(!inside){
     const scale=Math.min(1,512/Math.max(b[2]-b[0],b[3]-b[1])),w=Math.max(1,Math.round((b[2]-b[0])*scale)),h=Math.max(1,Math.round((b[3]-b[1])*scale)),c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(im,b[0],b[1],b[2]-b[0],b[3]-b[1],0,0,w,h);
     const features=shapeDescriptor(ctx.getImageData(0,0,w,h).data,w,h,chars.length),group=r.type==='effect'?['impact','kimdaegeon','shower']:['dialogue','narration','reflective','handwritten','stone'];
     if(features){const scores=new Map();for(const ref of templateShapes(text,w/h,group)){const score=shapeDistance(features,ref.features);scores.set(ref.id,Math.min(scores.get(ref.id)??Infinity,score));}
      const ranked=[...scores].sort((a,b)=>a[1]-b[1]),best=ranked[0],runner=ranked[1],printed=Math.min(scores.get('dialogue')??Infinity,scores.get('narration')??Infinity);
      if(best&&best[1]<.24&&runner&&runner[1]-best[1]>.012&&(r.type==='effect'||!['dialogue','narration'].includes(best[0])&&printed-best[1]>.025))selected={choice:best[0],distance:best[1],margin:runner[1]-best[1]};
     }
     c.width=c.height=0;
    }
   }
   r.sourceTypography={version:1,key,inside:sourceInside(r,result,geometry),method:'source-image-shape',...(selected||{choice:null})};changed=true;
  }
  return changed;
 })();analysisTasks.set(result,task);try{return await task;}finally{analysisTasks.delete(result);}
}

globalThis.MangaFonts={defaultChoice,pageDefaults,withPage,configure,normalizePolicy,defaultPolicy,roles,category,analyze,shapeDescriptor,shapeDistance,sourceKey,catalog,groups,choice,weight,ensure,decorate,css,get revision(){return revision;},setLoader(value){loader=value;}};
})();
