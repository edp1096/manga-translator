const $=id=>document.getElementById(id),job=new URLSearchParams(location.search).get('job');
const rpc=async msg=>{const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'확장 오류');return r.value;};
MangaRender.setAssetLoader((id,name)=>rpc({type:'asset',id,name}));
let result,baseResult,original,cleaned,restored,restoration,selected=0,showOriginal=false,drawSeq=0;
let busy=false,bubbleGeometry,displayGeometry,displayMode,outsideTextMode;
let maskEditing=false,maskTarget,maskPriorOriginal=false;
const tell=t=>$('status').textContent=t;
async function draw(){
 if(displayGeometry)result=MangaRender.presentation(MangaRender.editedBase(result,baseResult),displayMode,displayGeometry,outsideTextMode,restoration);
 const seq=++drawSeq;const canvas=document.createElement('canvas');
 if(showOriginal||maskEditing){canvas.width=result.width;canvas.height=result.height;canvas.getContext('2d').drawImage(await MangaRender.image(original),0,0);}else await MangaRender.render(canvas,result,original,cleaned,restored);
 if(seq!==drawSeq)return;$('canvas').width=canvas.width;$('canvas').height=canvas.height;$('canvas').getContext('2d',{willReadFrequently:true}).drawImage(canvas,0,0);handles();
}
function refreshRegions(){
 $('regions').replaceChildren();for(const [i,r]of result.regions.entries())$('regions').append(new Option(`${i+1}. ${r.text.slice(0,24)||'새 글상자'}`,String(i)));
 $('add').disabled=result.regions.length>=150;select(selected);
}
function select(i){selected=i;const r=result.regions[i];
 for(const id of ['source','translation','mode','white-area','font','reset','delete','regions'])$(id).disabled=!r||busy||maskEditing;
 for(const id of ['apply','png','project','toggle'])$(id).disabled=busy||maskEditing;
 $('add').disabled=busy||maskEditing||result.regions.length>=150;
 $('regions').value=r?String(i):'';$('source').value=r?.text||'';$('translation').value=r?.translation||'';$('mode').value=maskEditing?'restore':r?.mode||'replace';$('white-area').value=r?.whiteScope||r?.whiteBackground?.kind||'bubble';$('font').value=r?.fontSize||24;handles();$('mask-edit').disabled=!r||busy||maskEditing;for(const id of ['mask-tool','mask-size','mask-box','mask-clear','mask-preview','mask-cancel'])$(id).disabled=busy;
}
async function changeDisplay(){
 const region=result?.regions[selected];if(!region||busy)return;
 const mode=$('mode').value,scope=$('white-area').value;
 if(mode==='restore'){if(region.manualRestoration||(region.restorationMask&&restored)){region.mode='restore';region.displayOverride=true;await draw();}else beginManualMask();return;}
 if(mode!=='white'){region.displayOverride=true;region.whiteScope=scope;region.mode=mode;await draw();return;}
 busy=true;select(selected);tell('흰 배경을 준비하는 중…');
 try{
  let background={kind:'box'};
  if(scope==='bubble'){
   if(region.whiteBackground?.kind==='bubble')background=MangaRender.whiteBackground(result,region,{width:result.width,height:result.height,bubbles:[region.whiteBackground]});
   else{
    bubbleGeometry ||= rpc({type:'bubbles',id:job}).catch(error=>{bubbleGeometry=null;throw error;});
    background=MangaRender.whiteBackground(result,region,await bubbleGeometry);
   }
  }
  region.displayOverride=true;region.whiteBackground=background;region.whiteScope=scope;region.mode='white';showOriginal=false;$('toggle').textContent='원본 보기';
  await draw();tell(scope==='bubble'?'말풍선 내부를 흰색으로 표시합니다. 미리보기를 확인하고 페이지에 적용하세요.':'원문과 번역 글상자 범위를 흰색으로 표시합니다.');
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
  const box=document.createElement('div');box.className='box'+(i===selected?' selected':'');const [x1,y1,x2,y2]=r.box;
  Object.assign(box.style,{left:x1/result.width*100+'%',top:y1/result.height*100+'%',width:(x2-x1)/result.width*100+'%',height:(y2-y1)/result.height*100+'%'});
  const resize=document.createElement('span');resize.className='resize';box.append(resize);
  box.onpointerdown=e=>{
   if(busy||maskEditing)return;
   e.preventDefault();selected=i;const r=result.regions[i];$('regions').value=String(i);$('source').value=r.text;$('translation').value=r.translation;$('mode').value=r.mode;$('white-area').value=r.whiteScope||r.whiteBackground?.kind||'bubble';$('font').value=r.fontSize;
   const start=[e.clientX,e.clientY],old=[...r.box],s=result.width/$('canvas').getBoundingClientRect().width,isResize=e.target===resize;
   box.setPointerCapture(e.pointerId);
   box.onpointermove=ev=>{const dx=(ev.clientX-start[0])*s,dy=(ev.clientY-start[1])*s;
    const previous=[...r.box];
    if(isResize)r.box=[old[0],old[1],Math.min(result.width,Math.max(old[0]+12,old[2]+dx)),Math.min(result.height,Math.max(old[1]+12,old[3]+dy))];
    else{const x=Math.max(0,Math.min(result.width-(old[2]-old[0]),old[0]+dx)),y=Math.max(0,Math.min(result.height-(old[3]-old[1]),old[1]+dy));r.box=[x,y,x+old[2]-old[0],y+old[3]-old[1]];}
    if(r.mode==='white'&&r.whiteBackground?.kind==='bubble'&&MangaRender.coverage(r.whiteBackground,result,r.box)<.98){r.box=previous;tell('번역 글상자는 흰 말풍선 안쪽에 배치하세요.');return;}
    const b=r.box;Object.assign(box.style,{left:b[0]/result.width*100+'%',top:b[1]/result.height*100+'%',width:(b[2]-b[0])/result.width*100+'%',height:(b[3]-b[1])/result.height*100+'%'});
   };box.onpointerup=()=>{box.onpointermove=null;if(r.box.some((value,index)=>value!==old[index]))r.layoutOverride=true;draw();};
  };$('handles').append(box);
 });
}
for(const [id,prop]of [['source','text'],['translation','translation'],['font','fontSize']])$(id).oninput=()=>{if(!result?.regions[selected])return;if(id==='font')result.regions[selected].layoutOverride=true;result.regions[selected][prop]=id==='font'?Math.max(8,Math.min(100,Number($(id).value)||24)):$(id).value;draw();};
$('mode').onchange=changeDisplay;
$('white-area').onchange=changeDisplay;
$('regions').onchange=()=>select(Number($('regions').value));
$('reset').onclick=()=>{if(result.regions[selected]){result.regions[selected].layoutOverride=true;result.regions[selected].box=[...result.regions[selected].bbox];draw();}};
$('toggle').onclick=()=>{showOriginal=!showOriginal;$('toggle').textContent=showOriginal?'번역 보기':'원본 보기';draw();};
$('apply').onclick=async()=>{if(busy)return;busy=true;select(selected);tell('페이지에 적용하는 중…');try{const applied=await rpc({type:'apply',id:job,result:MangaRender.editedBase(result,baseResult),previewResult:result});if(applied?.result){result=applied.result;baseResult=applied.baseResult;displayGeometry=applied.geometry;displayMode=applied.displayMode;outsideTextMode=applied.outsideTextMode;restoration=applied.restoration;if(restoration?.version===1&&!restored)restored=await rpc({type:'asset',id:job,name:'restored-v1.png'});refreshRegions();await draw();}tell('원본 페이지에 적용했습니다.');}catch(e){tell(e.message);}finally{busy=false;select(selected);}};
function download(url,name){const a=document.createElement('a');a.href=url;a.download=name;a.click();}
$('png').onclick=async()=>{try{const c=document.createElement('canvas');await MangaRender.render(c,result,original,cleaned,restored);download(c.toDataURL('image/png'),`translated-${job}.png`);}catch(e){tell(e.message);}};
$('project').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));download(url,`translation-${job}.json`);setTimeout(()=>URL.revokeObjectURL(url),10000);};
(async()=>{try{const saved=(await chrome.storage.local.get('edit:'+job))['edit:'+job];if(!saved)throw Error('페이지의 편집 버튼으로 열어주세요.');result=MangaRender.prepare(saved.result);baseResult=saved.baseResult;displayGeometry=saved.geometry;displayMode=saved.displayMode;outsideTextMode=saved.outsideTextMode;restoration=saved.restoration;[original,cleaned]=await Promise.all(['original.png','cleaned.png'].map(name=>rpc({type:'asset',id:job,name})));if(restoration?.version===1)restored=await rpc({type:'asset',id:job,name:'restored-v1.png'});refreshRegions();await draw();tell(`${result.regions.length}개 영역`);}catch(e){tell(e.message);}})();

setupManualMask();
