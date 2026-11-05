// ZIP store method: images are already compressed. UTF-8 names and CRC32.
(()=>{
 const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 const crc=data=>{let n=0xffffffff;for(const b of data)n=table[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;};
 function create(files){
  if(files.length>65535)throw Error('ZIP 파일 개수 제한 초과');
  const parts=[],central=[];let offset=0,centralSize=0;
  for(const file of files){
   const name=new TextEncoder().encode(file.name),data=file.data;
   if(name.length>65535||data.length>0xffffffff||offset+30+name.length+data.length>0xffffffff)throw Error('ZIP 용량 제한 초과');
   const sum=crc(data),local=new Uint8Array(30),v=new DataView(local.buffer);
   v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,sum,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);
   const c=new Uint8Array(46),w=new DataView(c.buffer);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint16(14,33,true);w.setUint32(16,sum,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,name.length,true);w.setUint32(42,offset,true);
   parts.push(local,name,data);central.push(c,name);offset+=local.length+name.length+data.length;centralSize+=c.length+name.length;
  }
  if(offset+centralSize+22>0xffffffff)throw Error('ZIP 용량 제한 초과');
  const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,centralSize,true);v.setUint32(16,offset,true);
  return new Blob([...parts,...central,end],{type:'application/zip'});
 }
 // Build pairs before filtering the selection: skipping a page must never join
 // two unrelated pages, or shift every later spread.
 const identity=e=>e.sourceURL||'page:'+e.index;
 function plan(entries,selected,options={}){
  const all=[...entries].sort((a,b)=>a.index-b.index),groups=[];const used=new Set();
  const pairs=Array.isArray(options.pairs)?options.pairs:[];
  for(let i=0;i<all.length;i++){
   const a=all[i];if(used.has(a.key))continue;
   const b=all[i+1],adjacent=b&&b.index===a.index+1;
   const join=adjacent&&(options.mode==='pairs'&&i>=(options.firstSingle?1:0)&&(i-(options.firstSingle?1:0))%2===0||options.mode==='manual'&&pairs.some(p=>Array.isArray(p)&&p[0]===identity(a)&&p[1]===identity(b)));
   const group=join?[a,b]:[a];if(join)used.add(b.key);
   const chosen=group.filter(e=>selected.has(e.key));if(chosen.length)groups.push(chosen);
  }
  return groups;
 }
 async function merge(data,direction='rtl'){
  if(data.length!==2)throw Error('두 페이지를 선택하세요.');
  const images=[];let canvas;
  try{
   for(const value of data){const response=await fetch(value);if(!response.ok)throw Error('이미지 읽기 실패');images.push(await createImageBitmap(await response.blob()));}
   const height=Math.max(...images.map(i=>i.height)),widths=images.map(i=>Math.max(1,Math.round(i.width*height/i.height))),width=widths[0]+widths[1];
   if(width>32767||height>32767||width*height>64000000)throw Error('합친 이미지가 너무 큽니다. 개별 이미지로 저장합니다.');
   canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw Error('이미지 합치기 실패');context.fillStyle='white';context.fillRect(0,0,width,height);context.imageSmoothingQuality='high';
   const order=direction==='ltr'?[0,1]:[1,0];let x=0;for(const i of order){context.drawImage(images[i],x,0,widths[i],height);x+=widths[i];}
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('합친 이미지 저장 실패');return {data:new Uint8Array(await blob.arrayBuffer()),width,height};
  }finally{for(const image of images)image.close();if(canvas){canvas.width=0;canvas.height=0;}}
 }
 globalThis.MangaZip={create,plan,merge,identity};
})();
