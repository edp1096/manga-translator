// Draft masks are local to the editor until the user accepts a preview.
// No detector confidence gate is applied to an explicitly painted mask.
function beginManualMask(){
 const r=result?.regions[selected];if(!r||busy)return;maskPriorOriginal=showOriginal;maskTarget=r.id;maskEditing=true;
 const c=$('erase-mask');c.width=result.width;c.height=result.height;c.hidden=false;$('mask-controls').hidden=false;
 const previous=r.manualRestoration?.mask;
 if(previous){const [x,y,x1,y1]=previous.bounds,w=x1-x;const ctx=c.getContext('2d');ctx.fillStyle='rgba(245,70,10,.5)';for(let i=0;i<previous.runs.length;i+=2){let p=previous.runs[i],end=p+previous.runs[i+1];while(p<end){const n=Math.min(w-p%w,end-p);ctx.fillRect(x+p%w,y+Math.floor(p/w),n,1);p+=n;}}}
 else fillManualBox();select(selected);draw();tell('빨간 부분만 복원합니다. 영역을 조정한 뒤 복원 미리보기를 누르세요.');
}
function fillManualBox(){const r=result?.regions[selected];if(!r)return;const c=$('erase-mask'),ctx=c.getContext('2d'),b=r.bbox;ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='rgba(245,70,10,.5)';ctx.fillRect(Math.floor(b[0]),Math.floor(b[1]),Math.ceil(b[2])-Math.floor(b[0]),Math.ceil(b[3])-Math.floor(b[1]));}
function finishManualMask(){maskEditing=false;maskTarget=undefined;$('erase-mask').hidden=true;$('mask-controls').hidden=true;showOriginal=maskPriorOriginal;$('toggle').textContent=showOriginal?'번역 보기':'원본 보기';select(selected);}
function encodedManualMask(){
 const c=$('erase-mask'),w=c.width,h=c.height,pixels=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;let x0=w,y0=h,x1=0,y1=0,count=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(pixels[(y*w+x)*4+3]>=32){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);count++;}
 if(!count)throw Error('지울 영역을 선택하세요.');const width=x1-x0,height=y1-y0;if(width*height>4000000||count>1000000)throw Error('한 번에 복원할 영역을 더 작게 나눠 선택하세요.');
 const runs=[];let start=-1;for(let p=0;p<width*height;p++){const inside=pixels[((y0+Math.floor(p/width))*w+x0+p%width)*4+3]>=32;if(inside&&start<0)start=p;if(start>=0&&(!inside||p===width*height-1)){runs.push(start,p-start+(inside?1:0));start=-1;}}
 if(runs.length>200000)throw Error('선택 영역이 너무 복잡합니다. 더 작게 나눠 복원하세요.');return {width:w,height:h,bounds:[x0,y0,x1,y1],runs};
}
async function previewManualMask(){
 const r=result?.regions[selected];if(!r||busy||!maskEditing||r.id!==maskTarget)return;let mask;try{mask=encodedManualMask();}catch(e){tell(e.message);return;}
 busy=true;select(selected);tell('선택한 영역의 배경을 복원하는 중…');
 try{const ref=await rpc({type:'manualRestoration',id:job,mask});if(ref.version!==1||ref.width!==result.width||ref.height!==result.height||JSON.stringify(ref.mask?.bounds)!==JSON.stringify(mask.bounds)||JSON.stringify(ref.mask?.runs)!==JSON.stringify(mask.runs)||!/^manual-[0-9a-f]{32}\.png$/.test(ref.asset))throw Error('복원 응답이 선택한 영역과 다릅니다.');
  // Load and validate the generated crop before replacing the current preview.
  const data=await rpc({type:'asset',id:job,name:ref.asset}),img=await MangaRender.image(data);if(img.width!==mask.bounds[2]-mask.bounds[0]||img.height!==mask.bounds[3]-mask.bounds[1])throw Error('복원 이미지 크기가 다릅니다.');
  const next={...r,manualRestoration:{...ref,job},mode:'restore',displayOverride:true,layoutOverride:true};delete next.whiteBackground;delete next.whiteScope;const candidate={...result,regions:result.regions.map(row=>row.id===r.id?next:row)},check=document.createElement('canvas');try{await MangaRender.render(check,candidate,original,cleaned,restored);}finally{check.width=0;check.height=0;}result=candidate;finishManualMask();showOriginal=false;$('toggle').textContent='원본 보기';await draw();tell('복원 미리보기입니다. 번역문 위치를 조절하고 페이지에 적용하세요.');
 }catch(e){tell(/서버 409:/.test(e.message)?'진행 중인 작업이 끝난 뒤 복원 미리보기를 다시 누르세요.':e.message);}finally{busy=false;select(selected);}
}
function setupManualMask(){
 $('mask-edit').onclick=beginManualMask;$('mask-box').onclick=fillManualBox;$('mask-clear').onclick=()=>{const c=$('erase-mask');c.getContext('2d').clearRect(0,0,c.width,c.height);};$('mask-cancel').onclick=async()=>{finishManualMask();try{await draw();tell('영역 지정을 취소했습니다.');}catch(e){tell(e.message);}};$('mask-preview').onclick=previewManualMask;
 const c=$('erase-mask');c.onpointerdown=e=>{if(!maskEditing||busy)return;e.preventDefault();c.setPointerCapture(e.pointerId);const rect=c.getBoundingClientRect(),point=e=>[Math.max(0,Math.min(c.width,(e.clientX-rect.left)*c.width/rect.width)),Math.max(0,Math.min(c.height,(e.clientY-rect.top)*c.height/rect.height))],ctx=c.getContext('2d'),start=point(e),tool=$('mask-tool').value,base=tool==='rectangle'?ctx.getImageData(0,0,c.width,c.height):null;let prior=start;const radius=Math.max(2,Math.min(160,Number($('mask-size').value)||20));
  const paint=event=>{const p=point(event);ctx.save();if(tool==='rectangle'){ctx.putImageData(base,0,0);ctx.fillStyle='rgba(245,70,10,.5)';ctx.fillRect(Math.min(start[0],p[0]),Math.min(start[1],p[1]),Math.abs(start[0]-p[0]),Math.abs(start[1]-p[1]));}else{ctx.globalCompositeOperation=tool==='erase'?'destination-out':'source-over';ctx.strokeStyle=ctx.fillStyle=tool==='erase'?'rgba(245,70,10,1)':'rgba(245,70,10,.5)';ctx.lineWidth=radius;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(...prior);ctx.lineTo(...p);ctx.stroke();ctx.beginPath();ctx.arc(...p,radius/2,0,Math.PI*2);ctx.fill();}ctx.restore();prior=p;};paint(e);c.onpointermove=paint;const end=()=>{c.onpointermove=null;c.onpointerup=null;c.onpointercancel=null;};c.onpointerup=end;c.onpointercancel=end;
 };
}
