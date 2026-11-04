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
