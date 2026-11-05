/* Selection changes never mutate translation geometry or erasure masks. */
function setupMarqueeSelection(){
 const stage=$('stage');let cancel=null;
 stage.addEventListener('pointerdown',e=>{
  if(e.button!==0||!e.isPrimary||busy||maskDrawing()||showOriginal||!result||cancel||!['canvas','stage'].includes(e.target.id))return;
  e.preventDefault();const pointer=e.pointerId,rect=$('canvas').getBoundingClientRect();
  const point=ev=>[Math.max(0,Math.min(result.width,(ev.clientX-rect.left)*result.width/rect.width)),Math.max(0,Math.min(result.height,(ev.clientY-rect.top)*result.height/rect.height))];
  const start=point(e),add=e.ctrlKey||e.metaKey||e.shiftKey,prior=new Set(selectedIds),primary=selected;
  const polygons=result.regions.map(r=>({id:r.id,points:MangaRotation.corners(r.box,MangaRotation.angle(r))}));
  const box=document.createElement('div');box.className='editor-marquee';box.hidden=true;stage.append(box);stage.classList.add('marquee-active');stage.setPointerCapture(pointer);
  let dragging=false,hits=new Set(prior);
  const move=ev=>{
   if(ev.pointerId!==pointer)return;
   if(!dragging&&Math.hypot(ev.clientX-e.clientX,ev.clientY-e.clientY)<4)return;
   dragging=true;const p=point(ev),b=[Math.min(start[0],p[0]),Math.min(start[1],p[1]),Math.max(start[0],p[0]),Math.max(start[1],p[1])];
   box.hidden=false;Object.assign(box.style,{left:b[0]/result.width*100+'%',top:b[1]/result.height*100+'%',width:(b[2]-b[0])/result.width*100+'%',height:(b[3]-b[1])/result.height*100+'%'});
   const corners=[[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]]];hits=new Set(add?prior:[]);
   for(const row of polygons)if(MangaPolygon.polygonOverlap(corners,row.points)?.intersectionArea>0)hits.add(row.id);
   for(const node of $('handles').children){const id=result.regions[Number(node.dataset.region)]?.id;node.classList.toggle('selected',hits.has(id));node.classList.toggle('primary',hits.has(id)&&Number(node.dataset.region)===primary);}
   $('selection-count').textContent=`${hits.size}개 선택`;
  };
  const finish=(ev,aborted=false)=>{
   if(ev&&ev.pointerId!==pointer)return;
   stage.removeEventListener('pointermove',move);stage.removeEventListener('pointerup',up);stage.removeEventListener('pointercancel',abort);stage.removeEventListener('lostpointercapture',abort);document.removeEventListener('keydown',key);window.removeEventListener('blur',abortAll);cancel=null;
   if(stage.hasPointerCapture(pointer))stage.releasePointerCapture(pointer);box.remove();stage.classList.remove('marquee-active');
   if(aborted){handles();syncSelection();return;}
   if(!dragging)hits=new Set(add?prior:[]);
   selectedIds.clear();for(const id of hits)selectedIds.add(id);
   const index=hits.has(result.regions[primary]?.id)?primary:result.regions.findIndex(r=>hits.has(r.id));select(index);selectionAnchor=result.regions[index]?.id??null;
  };
  const up=ev=>{move(ev);finish(ev)},abort=ev=>finish(ev,true),abortAll=()=>finish(null,true),key=ev=>{if(ev.key==='Escape'){ev.preventDefault();abortAll();}};
  cancel=abortAll;stage.addEventListener('pointermove',move);stage.addEventListener('pointerup',up);stage.addEventListener('pointercancel',abort);stage.addEventListener('lostpointercapture',abort);document.addEventListener('keydown',key);window.addEventListener('blur',abortAll);
 });
}

// Test against each rotated text-box polygon, not its axis-aligned envelope.
function editorPointHits(clientX,clientY){
 if(!result||showOriginal||busy||maskDrawing())return [];
 const canvas=$('canvas').getBoundingClientRect();if(!canvas.width||!canvas.height)return [];
 const p=[(clientX-canvas.left)*result.width/canvas.width,(clientY-canvas.top)*result.height/canvas.height];
 return result.regions.flatMap((region,index)=>{
  const polygon=MangaRotation.corners(region.box,MangaRotation.angle(region));let sign=0;
  for(let n=0;n<polygon.length;n++){const a=polygon[n],b=polygon[(n+1)%polygon.length],cross=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);if(Math.abs(cross)<1e-7)continue;const next=Math.sign(cross);if(sign&&next!==sign)return [];sign=next;}
  return sign?[index]:[];
 }).reverse();
}
let overlapIds=[];
function syncOverlapPicker(){
 const popup=$('overlap-picker');if(!popup?.matches(':popover-open'))return;
 if(busy||maskDrawing()||showOriginal){popup.hidePopover();return;}
 let available=0;for(const row of $('overlap-list').children){const region=result?.regions.find(r=>r.id===row.regionId),input=row.querySelector('input');row.hidden=!region;if(!region)continue;available++;input.checked=selectedIds.has(region.id);row.classList.toggle('current',result.regions[selected]?.id===region.id);}
 if(!available)popup.hidePopover();
}
function setupOverlapSelection(){
 const stage=$('stage'),popup=$('overlap-picker');
 const chooseOnly=id=>{const index=result?.regions.findIndex(r=>r.id===id);if(index<0||busy||maskDrawing())return;selectedIds.clear();selectedIds.add(id);selectionAnchor=id;select(index);popup.hidePopover();};
 function open(clientX,clientY){
  const hits=editorPointHits(clientX,clientY);if(!hits.length)return false;
  overlapIds=hits.map(index=>result.regions[index].id);$('overlap-title').textContent=`겹친 글상자 ${hits.length}개`;$('overlap-list').replaceChildren();
  for(const index of hits){const r=result.regions[index],id=r.id,row=document.createElement('div');row.className='overlap-row';row.regionId=id;const label=document.createElement('label'),check=document.createElement('input'),text=document.createElement('span'),only=document.createElement('button');check.type='checkbox';check.checked=selectedIds.has(id);text.textContent=`${index+1}. ${(r.translation||r.text||'빈 글상자').replace(/\s+/g,' ').slice(0,100)}`;text.title=r.translation||r.text||'빈 글상자';only.type='button';only.textContent='이것만';only.setAttribute('aria-label',`${index+1}번 글상자만 선택`);label.append(check,text);row.append(label,only);$('overlap-list').append(row);
   check.onchange=()=>{if(busy||maskDrawing()){syncOverlapPicker();return;}if(check.checked)selectedIds.add(id);else selectedIds.delete(id);const primary=check.checked?result.regions.findIndex(r=>r.id===id):selectedIds.has(result.regions[selected]?.id)?selected:result.regions.findIndex(r=>selectedIds.has(r.id));selectionAnchor=result.regions[primary]?.id??null;select(primary);};only.onclick=()=>chooseOnly(id);
  }
  popup.style.width=Math.max(0,Math.min(330,innerWidth-16))+'px';popup.style.maxHeight=Math.max(0,Math.min(420,innerHeight-16))+'px';popup.showPopover();syncOverlapPicker();const rect=popup.getBoundingClientRect();popup.style.left=Math.max(8,Math.min(clientX+8,innerWidth-rect.width-8))+'px';popup.style.top=Math.max(8,Math.min(clientY+8,innerHeight-rect.height-8))+'px';$('overlap-list').querySelector('input')?.focus({preventScroll:true});return true;
 }
 stage.addEventListener('contextmenu',e=>{if(open(e.clientX,e.clientY))e.preventDefault();});
 stage.addEventListener('pointerdown',e=>{
  if(e.button!==0||!e.altKey||e.target.closest('.resize,.rotate-handle'))return;
  const hits=editorPointHits(e.clientX,e.clientY);if(!hits.length)return;e.preventDefault();e.stopImmediatePropagation();
  const at=hits.indexOf(selected),index=hits[at<0?0:(at+(e.shiftKey?-1:1)+hits.length)%hits.length],id=result.regions[index].id;
  if(!e.ctrlKey&&!e.metaKey)selectedIds.clear();selectedIds.add(id);selectionAnchor=id;select(index);
 },true);
 $('overlap-all').onclick=()=>{if(busy||maskDrawing()||showOriginal)return;for(const id of overlapIds)if(result.regions.some(r=>r.id===id))selectedIds.add(id);const index=result.regions.findIndex(r=>r.id===overlapIds[0]);if(index>=0){selectionAnchor=result.regions[index].id;select(index);}};
 $('overlap-close').onclick=()=>popup.hidePopover();
 window.addEventListener('resize',()=>{if(popup.matches(':popover-open'))popup.hidePopover();});
 document.addEventListener('scroll',e=>{if(popup.matches(':popover-open')&&!popup.contains(e.target))popup.hidePopover();},true);
}
