let forceTooltipRestoration=false;
const $=id=>document.getElementById(id),job=new URLSearchParams(location.search).get('job');
const rpc=async msg=>{const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'확장 오류');return r.value;};
MangaRender.setAssetLoader((id,name)=>rpc({type:'asset',id,name}));
globalThis.MangaFonts?.setLoader(id=>rpc({type:'font',id}));
let result,baseResult,original,cleaned,restored,restoration,selected=0,showOriginal=false,drawSeq=0;
let lightweightDisplay=false;
const selectedIds=new Set();let selectionAnchor=null;
let busy=false,bubbleGeometry,displayGeometry,displayMode,outsideTextMode;
let maskEditing=false,maskTarget,maskPriorOriginal=false;
const tell=t=>$('status').textContent=t;
const fontPreview=MangaFontPreview.attach($('font-family'),()=>({region:MangaFonts.withPage(result?.regions[selected]||{},result||{}),target:result?.target||'Korean',fontDefaults:result?.fontDefaults,light:lightweightDisplay}));
async function draw(){
 const seq=++drawSeq;await globalThis.MangaFonts?.analyze(result,original,displayGeometry,lightweightDisplay);await globalThis.MangaFonts?.ensure(result,lightweightDisplay);if(seq!==drawSeq)return;
 result=MangaRender.presentation(MangaRender.editedBase(result,baseResult),displayMode,displayGeometry,outsideTextMode,restoration,lightweightDisplay,forceTooltipRestoration);
 const canvas=document.createElement('canvas');
 if(showOriginal||maskEditing){canvas.width=result.width;canvas.height=result.height;canvas.getContext('2d').drawImage(await MangaRender.image(original),0,0);}else await MangaRender.render(canvas,result,original,cleaned,restored);
 if(seq!==drawSeq)return;fontPreview.update();syncEditMode(result.regions[selected]);$('canvas').width=canvas.width;$('canvas').height=canvas.height;$('canvas').getContext('2d',{willReadFrequently:true}).drawImage(canvas,0,0);if(document.activeElement!==$('rotation'))$('rotation').value=result.regions[selected]?MangaRotation.angle(result.regions[selected]):0;handles();
}
function refreshRegions(){
 $('regions').replaceChildren();for(const [i,r]of result.regions.entries())$('regions').append(new Option(`${i+1}. ${r.text.slice(0,24)||'새 글상자'}`,String(i)));
 $('add').disabled=result.regions.length>=150;select(selected);
}
function selectedRegions(){return result?.regions.filter(r=>selectedIds.has(r.id))||[];}
function syncSelection(){
 const rows=selectedRegions(),locked=busy||maskEditing;
 $('selection-count').textContent=rows.length>1?`${rows.length}개 선택 · 글꼴·굵기 일괄 적용 (나머지 편집은 현재 영역)`:`${rows.length}개 선택`;
 for(const id of ['select-all','select-single','page-font-family','page-font-weight'])$(id).disabled=locked||!result?.regions.length;
 const defaults=MangaFonts.pageDefaults(result?.fontDefaults);$('page-font-family').value=defaults.font;$('page-font-weight').value=String(defaults.weight);
 if(rows.length>1){const families=new Set(rows.map(r=>r.fontChoice==='friendly'?'dialogue':r.fontChoice||'auto')),weights=new Set(rows.map(r=>r.fontWeight||'auto'));$('font-family').value=families.size===1?[...families][0]:'mixed';$('font-weight').value=weights.size===1?String([...weights][0]):'mixed';}
}
function select(i){selected=i;const r=result.regions[i];
 for(const id of selectedIds)if(!result.regions.some(r=>r.id===id))selectedIds.delete(id);
 if(r&&!selectedIds.has(r.id)){selectedIds.clear();selectedIds.add(r.id);selectionAnchor=r.id;}

 for(const id of ['source','translation','mode','white-area','font','font-family','font-weight','text-outline','paint-preset','text-color','text-hex','stroke-color','stroke-hex','stroke-width','rotation','rotation-auto','reset','delete','regions'])$(id).disabled=!r||busy||maskEditing;
 for(const id of ['apply','png','project','toggle'])$(id).disabled=busy||maskEditing;
 $('add').disabled=busy||maskEditing||result.regions.length>=150;
 $('regions').value=r?String(i):'';$('source').value=r?.text||'';$('translation').value=r?.translation||'';$('mode').value=maskEditing?'restore':r?.mode||'replace';$('white-area').value=r?.whiteScope||r?.whiteBackground?.kind||'bubble';$('font-family').value=(r?.fontChoice==='friendly'?'dialogue':r?.fontChoice)||'auto';$('font-weight').value=r?.fontWeight===400||r?.fontWeight===700?String(r.fontWeight):'auto';$('font-note').textContent=lightweightDisplay?'경량 모드에서는 기본 글꼴로 표시합니다. 선택은 저장됩니다.':'자동은 설정과 원문 형태를 따릅니다. 직접 고르면 이 영역에 우선 적용됩니다.';$('font').value=r?.fontSize||24;syncPaint(r);$('rotation').value=r?MangaRotation.angle(r):0;handles();syncEditMode(r);$('mask-edit').disabled=!r||busy||maskEditing;for(const id of ['mask-tool','mask-size','mask-layout-box','mask-box','mask-clear','mask-preview','mask-cancel'])$(id).disabled=busy;syncSelection();fontPreview.update();
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
  }catch(error){
   if(error.code!=='NO_SAFE_BUBBLE')throw error;
   if(region.type==='text'){background=await MangaRender.sourceWhiteBackground(result,region,await bubbleGeometry,original);if(!background)throw error;region.box=background.box;region.layoutOverride=true;delete region.automaticForced;}
   else if(region.type==='effect'){background={kind:'box'};scope='box';fallback=true;$('white-area').value='box';}else throw error;
  }}
  region.displayOverride=true;region.whiteBackground=background;region.whiteScope=scope;region.mode='white';showOriginal=false;$('toggle').textContent='원본 보기';
  await draw();tell(background.kind==='source-ink'?'말풍선 테두리를 보존하고 원문 획 주변만 흰색으로 교정했습니다.':fallback?'안전한 말풍선 경계가 없어 글상자 흰 배경으로 전환했습니다. 주변 대사를 보호한 미리보기를 확인하세요.':scope==='bubble'?'말풍선 내부를 흰색으로 표시합니다. 미리보기를 확인하고 페이지에 적용하세요.':'원문과 번역 글상자 범위를 흰색으로 표시합니다.');
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
  const node=document.createElement('div');node.className='box'+(selectedIds.has(r.id)?' selected':'')+(i===selected?' primary':'');node.dataset.region=String(i);
  const place=()=>{const [x1,y1,x2,y2]=r.box;Object.assign(node.style,{left:x1/result.width*100+'%',top:y1/result.height*100+'%',width:(x2-x1)/result.width*100+'%',height:(y2-y1)/result.height*100+'%',transform:`rotate(${MangaRotation.angle(r)}deg)`});};place();
  for(const direction of ['nw','n','ne','e','se','s','sw','w']){const h=document.createElement('span');h.className='resize';h.dataset.handle=direction;h.title='글상자 크기 조절';node.append(h);}
  const turn=document.createElement('span');turn.className='rotate-handle';turn.dataset.handle='rotate';turn.title='글상자 회전';node.append(turn);
  node.onpointerdown=e=>{
   if(busy||maskEditing)return;e.preventDefault();
   if(e.ctrlKey||e.metaKey||e.shiftKey){
    if(e.shiftKey){const anchor=result.regions.findIndex(r=>r.id===selectionAnchor),start=anchor<0?selected:anchor;if(!e.ctrlKey&&!e.metaKey)selectedIds.clear();for(let n=Math.min(start,i);n<=Math.max(start,i);n++)selectedIds.add(result.regions[n].id);}
    else{if(selectedIds.has(r.id)&&selectedIds.size>1)selectedIds.delete(r.id);else selectedIds.add(r.id);selectionAnchor=r.id;}
    select(selectedIds.has(r.id)?i:result.regions.findIndex(r=>selectedIds.has(r.id)));return;
   }
   drawSeq++;selected=i;selectedIds.clear();selectedIds.add(r.id);selectionAnchor=r.id;
   for(const el of $('handles').children){el.classList.toggle('selected',el===node);el.classList.toggle('primary',el===node);}
   $('regions').value=String(i);$('source').value=r.text;$('translation').value=r.translation;$('mode').value=r.mode;$('white-area').value=r.whiteScope||r.whiteBackground?.kind||'bubble';$('font').value=r.fontSize;$('font-family').value=(r.fontChoice==='friendly'?'dialogue':r.fontChoice)||'auto';$('font-weight').value=r.fontWeight===400||r.fontWeight===700?String(r.fontWeight):'auto';syncPaint(r);$('rotation').value=MangaRotation.angle(r);syncSelection();fontPreview.update();
   const start=[e.clientX,e.clientY],old=[...r.box],oldAngle=MangaRotation.angle(r),oldRotation=r.rotation,scale=result.width/$('canvas').getBoundingClientRect().width,handle=e.target.dataset.handle;
   const bounds=$('canvas').getBoundingClientRect(),center=[(old[0]+old[2])/2/scale+bounds.left,(old[1]+old[3])/2/scale+bounds.top],startAngle=Math.atan2(e.clientY-center[1],e.clientX-center[0]);let changed=false;
   node.setPointerCapture(e.pointerId);
   node.onpointermove=ev=>{
    const dx=(ev.clientX-start[0])*scale,dy=(ev.clientY-start[1])*scale;let box,angle=oldAngle;
    if(handle==='rotate'){angle=MangaRotation.normalize(oldAngle+(Math.atan2(ev.clientY-center[1],ev.clientX-center[0])-startAngle)*180/Math.PI);angle=ev.shiftKey?Math.round(angle/15)*15:Math.round(angle);box=old;}
    else if(handle)box=MangaRotation.resize(old,oldAngle,handle,dx,dy);
    else box=[old[0]+dx,old[1]+dy,old[2]+dx,old[3]+dy];
    if(!box.every(Number.isFinite)||box[2]<=box[0]||box[3]<=box[1])return;
    r.box=[...box];r.rotation=angle;changed=true;place();$('rotation').value=angle;
   };
   const finish=()=>{node.onpointermove=null;node.onpointerup=null;node.onpointercancel=null;if(changed){delete r.automaticForced;r.layoutOverride=true;r.displayOverride=true;}draw();};node.onpointerup=finish;
   node.onpointercancel=()=>{r.box=old;if(oldRotation===undefined)delete r.rotation;else r.rotation=oldRotation;changed=false;finish();};
  };$('handles').append(node);
 });
}
$('rotation').onchange=()=>{const r=result?.regions[selected],angle=Number($('rotation').value);if(!r||busy||!Number.isFinite(angle))return;const value=MangaRotation.normalize(angle);r.rotation=value;r.layoutOverride=true;r.displayOverride=true;draw();};
$('rotation-auto').onclick=()=>{const r=result?.regions[selected];if(!r||busy)return;delete r.rotation;draw();};
for(const [id,prop]of [['source','text'],['translation','translation'],['font','fontSize']])$(id).oninput=()=>{if(!result?.regions[selected])return;if(id==='font')result.regions[selected].layoutOverride=true;result.regions[selected][prop]=id==='font'?Math.max(8,Math.min(200,Number($(id).value)||24)):$(id).value;draw();};
$('font-family').onchange=()=>{if(busy||maskEditing)return;const choice=$('font-family').value;if(choice!=='auto'&&choice!=='default'&&!Object.hasOwn(MangaFonts.catalog,choice))return;for(const r of selectedRegions())if(choice==='auto')delete r.fontChoice;else r.fontChoice=choice;draw();};
$('mode').onchange=changeDisplay;
$('white-area').onchange=changeDisplay;
$('regions').onchange=()=>{selectedIds.clear();select(Number($('regions').value));};
$('select-all').onclick=()=>{if(busy||maskEditing)return;for(const r of result.regions)selectedIds.add(r.id);select(selected);};
$('select-single').onclick=()=>{selectedIds.clear();select(selected);};
$('reset').onclick=()=>{if(result.regions[selected]){result.regions[selected].layoutOverride=true;result.regions[selected].box=[...result.regions[selected].bbox];draw();}};
$('toggle').onclick=()=>{showOriginal=!showOriginal;$('toggle').textContent=showOriginal?'번역 보기':'원본 보기';draw();};
$('apply').onclick=async()=>{if(busy)return;busy=true;select(selected);tell('페이지에 적용하는 중…');try{const applied=await rpc({type:'apply',id:job,result:MangaRender.editedBase(result,baseResult),previewResult:result});if(applied?.result){forceTooltipRestoration=applied.forceTooltipRestoration===true;lightweightDisplay=applied.lightweightDisplay===true;result=applied.result;baseResult=applied.baseResult;displayGeometry=applied.geometry;displayMode=applied.displayMode;outsideTextMode=applied.outsideTextMode;restoration=applied.restoration;if(restoration?.version===1&&!restored)restored=await rpc({type:'asset',id:job,name:'restored-v1.png'});refreshRegions();await draw();}tell('원본 페이지에 적용했습니다.');}catch(e){tell(e.message);}finally{busy=false;select(selected);}};
function download(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click();}
$('png').onclick=async()=>{try{const c=document.createElement('canvas');await MangaRender.render(c,result,original,cleaned,restored);download(c.toDataURL('image/png'),`translated-${job}.png`);}catch(e){tell(e.message);}};
$('project').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));download(url,`translation-${job}.json`);setTimeout(()=>URL.revokeObjectURL(url),10000);};
chrome.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&changes.fontPolicy&&globalThis.MangaFonts?.configure(changes.fontPolicy.newValue)&&result)draw();});
(async()=>{try{const preferences=await rpc({type:'settings'}).catch(()=>({}));globalThis.MangaFonts?.configure(preferences.fontPolicy);const saved=(await chrome.storage.local.get('edit:'+job))['edit:'+job];if(!saved)throw Error('페이지의 편집 버튼으로 열어주세요.');forceTooltipRestoration=saved.forceTooltipRestoration===true;lightweightDisplay=saved.lightweightDisplay===true;result=MangaRender.prepare(saved.result);baseResult=saved.baseResult;displayGeometry=saved.geometry;displayMode=saved.displayMode;outsideTextMode=saved.outsideTextMode;restoration=saved.restoration;[original,cleaned]=await Promise.all(['original.png','cleaned.png'].map(name=>rpc({type:'asset',id:job,name})));if(restoration?.version===1)restored=await rpc({type:'asset',id:job,name:'restored-v1.png'});refreshRegions();await draw();tell(`${result.regions.length}개 영역`);}catch(e){tell(e.message);}})();

setupManualMask();

$('font-weight').onchange=()=>{if(busy||maskEditing)return;const value=$('font-weight').value;if(!['auto','400','700'].includes(value))return;for(const r of selectedRegions())if(value==='auto')delete r.fontWeight;else r.fontWeight=Number(value);draw();};

const paintPresets={black:{fill:'#111111',stroke:null,width:3},'black-white':{fill:'#111111',stroke:'#ffffff',width:3},'white-black':{fill:'#ffffff',stroke:'#111111',width:3},'yellow-black':{fill:'#ffdf00',stroke:'#111111',width:3}};
function syncPaint(r){
 const p=r&&MangaRender.paintOverride(r),fallback=r?MangaRender.resolvePaint(r,null,lightweightDisplay):{fill:'#111111',stroke:null};
 $('paint-preset').value=p?(Object.keys(paintPresets).find(k=>JSON.stringify(paintPresets[k])===JSON.stringify(p))||'custom'):'auto';
 $('text-color').value=$('text-hex').value=p?.fill||fallback.fill;
 $('stroke-color').value=$('stroke-hex').value=p?.stroke||fallback.stroke||'#ffffff';
 $('stroke-width').value=p?.width??3;
 $('text-outline').value=p?(p.stroke?'white':'none'):r?.outlineChoice||'auto';
}
function setPaint(p){const r=result?.regions[selected];if(!r||busy||maskEditing)return;if(p)r.textPaint={...p};else delete r.textPaint;delete r.outlineChoice;syncPaint(r);draw();}
function customPaint(){return {fill:$('text-color').value,stroke:$('text-outline').value==='none'?null:$('stroke-color').value,width:Number($('stroke-width').value)};}
$('paint-preset').onchange=()=>{const key=$('paint-preset').value;setPaint(key==='auto'?null:paintPresets[key]||customPaint());};
for(const [color,hex]of [['text-color','text-hex'],['stroke-color','stroke-hex']]){
 $(color).oninput=()=>{$(hex).value=$(color).value;setPaint(customPaint());};
 $(hex).onchange=()=>{if(!/^#[0-9a-f]{6}$/i.test($(hex).value)){tell('색상은 #RRGGBB 형식으로 입력하세요.');syncPaint(result.regions[selected]);return;}$(color).value=$(hex).value;setPaint(customPaint());};
}
$('stroke-width').onchange=()=>{const width=Number($('stroke-width').value);if(!Number.isFinite(width)||width<0||width>12){tell('테두리 두께는 0~12px입니다.');syncPaint(result.regions[selected]);return;}setPaint(customPaint());};
$('text-outline').onchange=()=>setPaint($('text-outline').value==='auto'?null:customPaint());

function syncEditMode(r){
 $('text-tools').hidden=maskEditing;$('manual-tools').hidden=!maskEditing;
 $('layout-mode').disabled=busy;$('layout-mode').setAttribute('aria-pressed',String(!maskEditing));$('mask-edit').setAttribute('aria-pressed',String(maskEditing));
 $('edit-mode-note').textContent=maskEditing?'빨간 부분이 지워집니다. 미리보기 전 선택은 배치 모드로 돌아가면 취소됩니다.':'상자는 번역문 위치와 크기만 바꿉니다. 이미지 밖으로도 이동할 수 있습니다.';
 $('restoration-compare').hidden=maskEditing||!r?.manualRestoration;
 for(const id of ['compare-before','compare-after'])$(id).disabled=busy;
 $('compare-before').setAttribute('aria-pressed',String(showOriginal));$('compare-after').setAttribute('aria-pressed',String(!showOriginal));
}
$('layout-mode').onclick=()=>{if(maskEditing)$('mask-cancel').click();};
$('compare-before').onclick=()=>{showOriginal=true;$('toggle').textContent='번역 보기';draw();};
$('compare-after').onclick=()=>{showOriginal=false;$('toggle').textContent='원본 보기';draw();};

for(const group of MangaFonts.groups)for(const id of group.ids)$('page-font-family').append(new Option('학교안심 '+MangaFonts.catalog[id],id));
for(const id of ['page-font-family','page-font-weight'])$(id).onchange=()=>{
 if(!result||busy||maskEditing)return;
 const defaults=MangaFonts.pageDefaults({font:$('page-font-family').value,weight:$('page-font-weight').value==='auto'?'auto':Number($('page-font-weight').value)});
 if(defaults.font==='auto'&&defaults.weight==='auto')delete result.fontDefaults;else result.fontDefaults=defaults;
 draw();
};
