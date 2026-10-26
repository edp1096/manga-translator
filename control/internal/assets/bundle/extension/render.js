(() => {
if(globalThis.MangaRender)return;
const image=src=>new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('이미지 로드 실패'));i.src=src;});
function wrap(ctx,text,width){
 const lines=[];
 for(const paragraph of text.split('\n')){
  let line='';
  for(const word of paragraph.split(/(\s+)/).filter(Boolean)){
   if(ctx.measureText(line+word).width<=width){line+=word;continue;}
   if(line.trim()){lines.push(line.trim());line='';}
   if(!word.trim())continue;
   for(const ch of word){if(line&&ctx.measureText(line+ch).width>width){lines.push(line);line=ch;}else line+=ch;}
  }
  lines.push(line.trim());
 }
 return lines;
}
function drawRegion(ctx,r){
 if(r.mode!=='replace'||!r.translation)return;
 const [x1,y1,x2,y2]=r.box, w=x2-x1,h=y2-y1;
 let size=r.fontSize||24,lines=[];
 for(;size>=8;size--){ctx.font=`600 ${size}px "Noto Sans CJK KR", "Malgun Gothic", sans-serif`;lines=wrap(ctx,r.translation,Math.max(8,w-4));if(lines.length*size*1.22<=h-4)break;}
 size=Math.max(8,size);ctx.font=`600 ${size}px \"Noto Sans CJK KR\", \"Malgun Gothic\", sans-serif`;
 ctx.save();ctx.beginPath();ctx.rect(x1,y1,w,h);ctx.clip();

 ctx.fillStyle=r.color||'#111';ctx.textAlign='center';ctx.textBaseline='top';
 const top=y1+Math.max(0,(h-lines.length*size*1.22)/2);
 lines.forEach((line,i)=>ctx.fillText(line,(x1+x2)/2,top+i*size*1.22));ctx.restore();
}
function prepare(result){return result;}
async function render(canvas,result,original,cleaned){
 prepare(result);
 canvas.width=result.width;canvas.height=result.height;
 const ctx=canvas.getContext('2d');ctx.drawImage(await image(original),0,0);
 const clean=await image(cleaned);
 // Restore original per region when user chooses tooltip/original mode.
 for(const r of result.regions)if(r.mode==='replace'&&!r.manual){
   const [x1,y1,x2,y2]=r.bbox;const x=Math.max(0,x1-3),y=Math.max(0,y1-3),w=Math.min(result.width,x2+3)-x,h=Math.min(result.height,y2+3)-y;
   ctx.drawImage(clean,x,y,w,h,x,y,w,h);
 }
 for(const r of result.regions)drawRegion(ctx,r);
 return canvas;
}
globalThis.MangaRender={image,render,prepare};
})();
