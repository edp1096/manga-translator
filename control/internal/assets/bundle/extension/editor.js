const $=id=>document.getElementById(id),job=new URLSearchParams(location.search).get('job');
const rpc=async msg=>{const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'확장 오류');return r.value;};
MangaRender.setAssetLoader((id,name)=>rpc({type:'asset',id,name}));
globalThis.MangaFonts?.setLoader(id=>rpc({type:'font',id}));
let result,baseResult,original,cleaned,restored,restoration,selected=0,showOriginal=false,drawSeq=0;
let lightweightDisplay=false;
let busy=false,bubbleGeometry,displayGeometry,displayMode,outsideTextMode;
let maskEditing=false,maskTarget,maskPriorOriginal=false;
const tell=t=>$('status').textContent=t;
async function draw(){
 const seq=++drawSeq;await globalThis.MangaFonts?.ensure(result,lightweightDisplay);if(seq!==drawSeq)return;
 result=MangaRender.presentation(MangaRender.editedBase(result,baseResult),displayMode,displayGeometry,outsideTextMode,restoration,lightweightDisplay);
 const canvas=document.createElement('canvas');
 if(showOriginal||maskEditing){canvas.width=result.width;canvas.height=result.height;canvas.getContext('2d').drawImage(await MangaRender.image(original),0,0);}else await MangaRender.render(canvas,result,original,cleaned,restored);
 if(seq!==drawSeq)return;$('canvas').width=canvas.width;$('canvas').height=canvas.height;$('canvas').getContext('2d',{willReadFrequently:true}).drawImage(canvas,0,0);if(document.activeElement!==$('rotation'))$('rotation').value=result.regions[selected]?MangaRotation.angle(result.regions[selected]):0;handles();
}
function refreshRegions(){
 $('regions').replaceChildren();for(const [i,r]of result.regions.entries())$('regions').append(new Option(`${i+1}. ${r.text.slice(0,24)||'새 글상자'}`,String(i)));
 $('add').disabled=result.regions.length>=150;select(selected);
}
function select(i){selected=i;const r=result.regions[i];
 for(const id of ['source','translation','mode','white-area','font','font-family','font-weight','text-outline','rotation','rotation-auto','reset','delete','regions'])$(id).disabled=!r||busy||maskEditing;
 for(const id of ['apply','png','project','toggle'])$(id).disabled=busy||maskEditing;
 $('add').disabled=busy||maskEditing||result.regions.length>=150;
 $('regions').value=r?String(i):'';$('source').value=r?.text||'';$('translation').value=r?.translation||'';$('mode').value=maskEditing?'restore':r?.mode||'replace';$('white-area').value=r?.whiteScope||r?.whiteBackground?.kind||'bubble';$('font-family').value=(r?.fontChoice==='friendly'?'dialogue':r?.fontChoice)||'auto';$('font-weight').value=r?.fontWeight===400||r?.fontWeight===700?String(r.fontWeight):'auto';$('font-note').textContent=lightweightDisplay?'경량 모드에서는 기본 글꼴로 표시합니다. 선택은 저장됩니다.':'기본 대사는 바른돋움입니다. 직접 고르면 이 영역에 우선 적용됩니다.';$('font').value=r?.fontSize||24;$('text-outline').value=r?.outlineChoice||'auto';$('rotation').value=r?MangaRotation.angle(r):0;handles();$('mask-edit').disabled=!r||busy||maskEditing;for(const id of ['mask-tool','mask-size','mask-box','mask-clear','mask-preview','mask-cancel'])$(id).disabled=busy;
}
async function changeDisplay(){
 const region=result?.regions[selected];if(!region||busy)return;
 const mode=$('mode').value;let scope=$('white-area').value,fallback=false;
 if(mode==='restore'){if(region.manualRestoration||(region.restorationMask&&restored)){region.mode='restore';region.displayOverride=true;await draw();}else beginManualMask();return;}
 if(mode!=='white'){region.displayOverride=true;region.whiteScope=scope;region.mode=mode;await draw();return;}
 busy=true;select(selected);tell('흰 배경을 준비하는 중…');
 try{
  let background={kind:'box'};
  if(scope==='bubble'){try{
   if(region.whiteBackground?.kind==='bubble')background=MangaRender.whiteBackground(result,region,{width:result.width,height:result.height,bubbles:[region.whiteBackground]});
   else{
    bubbleGeometry ||= rpc({type:'bubbles',id:job}).catch(error=>{bubbleGeometry=null;throw error;});
    background=MangaRender.whiteBackground(result,region,await bubbleGeometry);
   }
  }catch(error){if(region.type!=='effect'||error.code!=='NO_SAFE_BUBBLE')throw error;background={kind:'box'};scope='box';fallback=true;$('white-area').value='box';}}
  region.displayOverride=true;region.whiteBackground=background;region.whiteScope=scope;region.mode='white';showOriginal=false;$('toggle').textContent='원본 보기';
  await draw();tell(fallback?'안전한 말풍선 경계가 없어 글상자 흰 배경으로 전환했습니다. 주변 대사를 보호한 미리보기를 확인하세요.':scope==='bubble'?'말풍선 내부를 흰색으로 표시합니다. 미리보기를 확인하고 페이지에 적용하세요.':'원문과 번역 글상자 범위를 흰색으로 표시합니다.');
 }catch(error){tell(/서버 409:/.test(error.message)?'번역 작업이 끝난 뒤 흰 배경 번역을 다시 선택하세요.':/서버 404:/.test(error.message)?'말풍선 경계를 불러오지 못했습니다. 관리 앱을 최신 버전으로 실행하고 기존 결과가 남아 있는지 확인하세요.':error.message);}
 finally{busy=false;select(selected);}
}
$('add').onclick=()=>{
 if(!result||result.regions.length>=150)return;
 const w=Math.min(result.width,Math.max(24,result.width*.25)),h=Math.min(result.height,Math.max(24,result.height*.12));
 const x=(result.width-w)/2,y=(result.height-h)/2,box=[x,y,x+w,y+h];
 result.regions.push({id:crypto.randomUUID(),manual:true,bbox:[...box],box,text:'',translation:'',mode:'replace',fontSize:24,color:'#111'});
 selected=result.regions.length-1;showOriginal=false;$('toggle').textContent='원본 보기';refreshRegions();draw();$('translation').focus();tell('글상자를 추가했습니다. 번역문을 입력하고 위치를 조정하세요.');
};
$('delete').onclick=()=>{const removed=result?.regions[selected];if(!removed)return;if(!removed.manual){result.preservedRegions||=[];result.preservedRegions.push({bbox:removed.bbox,text:removed.text});}result.regions.splice(selected,1);selected=Math.max(0,Math.min(selected,result.regions.length-1));refreshRegions();draw();tell('선택한 글상자를 삭제했습니다. 페이지에 적용하면 저장됩니다.');};
document.addEventListener('keydown',e=>{if(!maskEditing&&!busy&&e.key==='Delete'&&!e.target.closest('input,textarea,select,[contenteditable]')){e.preventDefault();$('delete').click();}});
function handles(){
 $('handles').replaceChildren();if(showOriginal||maskEditing)return;
 result.regions.forEach((r,i)=>{
  const node=document.createElement('div');node.className='box'+(i===selected?' selected':'');node.dataset.region=String(i);
  const place=()=>{const [x1,y1,x2,y2]=r.box;Object.assign(node.style,{left:x1/result.width*100+'%',top:y1/result.height*100+'%',width:(x2-x1)/result.width*100+'%',height:(y2-y1)/result.height*100+'%',transform:`rotate(${MangaRotation.angle(r)}deg)`});};place();
  for(const direction of ['nw','n','ne','e','se','s','sw','w']){const h=document.createElement('span');h.className='resize';h.dataset.handle=direction;h.title='글상자 크기 조절';node.append(h);}
  const turn=document.createElement('span');turn.className='rotate-handle';turn.dataset.handle='rotate';turn.title='글상자 회전';node.append(turn);
  node.onpointerdown=e=>{
   if(busy||maskEditing)return;e.preventDefault();drawSeq++;selected=i;
   for(const el of $('handles').children)el.classList.toggle('selected',el===node);
   $('regions').value=String(i);$('source').value=r.text;$('translation').value=r.translation;$('mode').value=r.mode;$('white-area').value=r.whiteScope||r.whiteBackground?.kind||'bubble';$('font').value=r.fontSize;$('font-family').value=(r.fontChoice==='friendly'?'dialogue':r.fontChoice)||'auto';$('font-weight').value=r.fontWeight===400||r.fontWeight===700?String(r.fontWeight):'auto';$('text-outline').value=r.outlineChoice||'auto';$('rotation').value=MangaRotation.angle(r);
   const start=[e.clientX,e.clientY],old=[...r.box],oldAngle=MangaRotation.angle(r),oldRotation=r.rotation,scale=result.width/$('canvas').getBoundingClientRect().width,handle=e.target.dataset.handle;
   const bounds=$('canvas').getBoundingClientRect(),center=[(old[0]+old[2])/2/scale+bounds.left,(old[1]+old[3])/2/scale+bounds.top],startAngle=Math.atan2(e.clientY-center[1],e.clientX-center[0]);let changed=false;
   node.setPointerCapture(e.pointerId);
   node.onpointermove=ev=>{
    const dx=(ev.clientX-start[0])*scale,dy=(ev.clientY-start[1])*scale;let box,angle=oldAngle;
    if(handle==='rotate'){angle=MangaRotation.normalize(oldAngle+(Math.atan2(ev.clientY-center[1],ev.clientX-center[0])-startAngle)*180/Math.PI);angle=ev.shiftKey?Math.round(angle/15)*15:Math.round(angle);box=old;}
    else if(handle)box=MangaRotation.resize(old,oldAngle,handle,dx,dy);
    else box=[old[0]+dx,old[1]+dy,old[2]+dx,old[3]+dy];
    const candidate={...r,box,rotation:angle};if(!MangaRotation.allowed(candidate,result)){tell('글상자는 페이지와 선택한 말풍선 안쪽에 배치하세요.');return;}
    r.box=[...box];r.rotation=angle;changed=true;place();$('rotation').value=angle;
   };
   const finish=()=>{node.onpointermove=null;node.onpointerup=null;node.onpointercancel=null;if(changed)r.layoutOverride=true;draw();};node.onpointerup=finish;
   node.onpointercancel=()=>{r.box=old;if(oldRotation===undefined)delete r.rotation;else r.rotation=oldRotation;changed=false;finish();};
  };$('handles').append(node);
 });
}
$('rotation').onchange=()=>{const r=result?.regions[selected],angle=Number($('rotation').value);if(!r||busy||!Number.isFinite(angle))return;const value=MangaRotation.normalize(angle);if(!MangaRotation.allowed({...r,rotation:value},result)){$('text-outline').value=r.outlineChoice||'auto';$('rotation').value=MangaRotation.angle(r);tell('회전한 글상자가 페이지 또는 말풍선 경계를 벗어납니다. 먼저 상자를 줄이세요.');return;}r.rotation=value;r.layoutOverride=true;draw();};
$('rotation-auto').onclick=()=>{const r=result?.regions[selected];if(!r||busy)return;delete r.rotation;draw();};
for(const [id,prop]of [['source','text'],['translation','translation'],['font','fontSize']])$(id).oninput=()=>{if(!result?.regions[selected])return;if(id==='font')result.regions[selected].layoutOverride=true;result.regions[selected][prop]=id==='font'?Math.max(8,Math.min(100,Number($(id).value)||24)):$(id).value;draw();};
$('font-family').onchange=()=>{const r=result?.regions[selected];if(!r||busy)return;const choice=$('font-family').value;if(choice==='auto')delete r.fontChoice;else r.fontChoice=choice;draw();};
$('mode').onchange=changeDisplay;
$('white-area').onchange=changeDisplay;
$('regions').onchange=()=>select(Number($('regions').value));
$('reset').onclick=()=>{if(result.regions[selected]){result.regions[selected].layoutOverride=true;result.regions[selected].box=[...result.regions[selected].bbox];draw();}};
$('toggle').onclick=()=>{showOriginal=!showOriginal;$('toggle').textContent=showOriginal?'번역 보기':'원본 보기';draw();};
$('apply').onclick=async()=>{if(busy)return;busy=true;select(selected);tell('페이지에 적용하는 중…');try{const applied=await rpc({type:'apply',id:job,result:MangaRender.editedBase(result,baseResult),previewResult:result});if(applied?.result){lightweightDisplay=applied.lightweightDisplay===true;result=applied.result;baseResult=applied.baseResult;displayGeometry=applied.geometry;displayMode=applied.displayMode;outsideTextMode=applied.outsideTextMode;restoration=applied.restoration;if(restoration?.version===1&&!restored)restored=await rpc({type:'asset',id:job,name:'restored-v1.png'});refreshRegions();await draw();}tell('원본 페이지에 적용했습니다.');}catch(e){tell(e.message);}finally{busy=false;select(selected);}};
function download(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click();}
$('png').onclick=async()=>{try{const c=document.createElement('canvas');await MangaRender.render(c,result,original,cleaned,restored);download(c.toDataURL('image/png'),`translated-${job}.png`);}catch(e){tell(e.message);}};
$('project').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));download(url,`translation-${job}.json`);setTimeout(()=>URL.revokeObjectURL(url),10000);};
(async()=>{try{const saved=(await chrome.storage.local.get('edit:'+job))['edit:'+job];if(!saved)throw Error('페이지의 편집 버튼으로 열어주세요.');lightweightDisplay=saved.lightweightDisplay===true;result=MangaRender.prepare(saved.result);baseResult=saved.baseResult;displayGeometry=saved.geometry;displayMode=saved.displayMode;outsideTextMode=saved.outsideTextMode;restoration=saved.restoration;[original,cleaned]=await Promise.all(['original.png','cleaned.png'].map(name=>rpc({type:'asset',id:job,name})));if(restoration?.version===1)restored=await rpc({type:'asset',id:job,name:'restored-v1.png'});refreshRegions();await draw();tell(`${result.regions.length}개 영역`);}catch(e){tell(e.message);}})();

setupManualMask();

$('font-weight').onchange=()=>{const r=result?.regions[selected];if(!r||busy)return;const value=$('font-weight').value;if(value==='auto')delete r.fontWeight;else r.fontWeight=Number(value);draw();};

$('text-outline').onchange=()=>{const r=result?.regions[selected];if(!r||busy)return;const value=$('text-outline').value;if(value==='auto')delete r.outlineChoice;else r.outlineChoice=value;draw();};
