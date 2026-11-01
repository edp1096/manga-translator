const embeddedPanel=globalThis.MangaPagePanel;
const $=id=>(embeddedPanel?.root||document).getElementById(id),selected=new Set();
let tabId,known=new Set(),busy=false,pageURL='',noticeUntil=0,autoSelectNew=true,saving=false,running=false,displayBusy=false,changingDisplay=false;
const thumbs=new Map(),thumbTasks=new Map(),rows=new Map();
let nameWork=null,namePageURL='';
const helpTopics={
 lightweight:['경량 표시',['표시용 추가 말풍선 분석·흰 배경·이미지 복원과 정밀 배치를 생략합니다. OCR·중복 제거·툴팁 겹침 방지와 개별 편집은 유지합니다.','선택해 둔 표시 방식은 보존됩니다. 끄면 재번역 없이 해당 방식을 다시 적용합니다. 이미 실행 중인 서버 요청은 완료될 때까지 시간이 필요할 수 있습니다.']],
 reader:['패널 사용',[
  '뒤쪽 이미지가 목록에 없으면 새로고침을 누르세요. 스크롤하거나 지원 뷰어의 페이지를 넘겨 본문을 불러옵니다.',
  '새로고침이나 번역이 끝나도 시작 위치로 돌아가지 않습니다. 토나리노 영점프처럼 화면을 읽는 뷰어는 만화 탭을 활성 상태로 유지하세요.',
  '전체 선택과 체크박스로 번역·저장할 페이지를 고릅니다. 이동은 해당 이미지를 보여주고, 편집에서는 번역문과 배치를 개별 수정할 수 있습니다.',
 '한 페이지의 번역과 선택한 흰 배경·이미지 복원을 마친 뒤 다음 페이지로 넘어갑니다. 목록의 완료는 최종 표시까지 끝났다는 뜻입니다. 표시 적용 오류는 완료된 번역을 보관하며, 다시 적용으로 이어갈 수 있습니다.',
  '사이트에는 번역 이미지만 표시하며 처리는 확장에서 합니다. 단색 배경의 대사는 직접 표시하고, 복잡한 그림은 원본을 보존합니다.']],
 names:['명칭 사전',[
  '작품과 번역 언어에 맞는 사전에 인물명·장소·용어·호칭을 등록하면 다음 번역부터 적용됩니다.',
  '명칭 통일은 현재 작품의 불러온 결과와 저장된 다른 화에 적용합니다. 명칭 되돌림으로 교정을 되돌릴 수 있습니다.']],
 display:['말풍선 표시',[
  '말풍선 흰 배경 자동은 확인된 말풍선의 툴팁을 흰 배경 번역문으로 바꿉니다. 기본 표시로 돌아가면 이전 표시를 복원합니다.',
  '선택 여부와 관계없이 모든 번역 페이지에 적용하고, 다음 번역에도 선택을 유지합니다. 개별 편집은 유지합니다.',
  '재번역 없이 표시만 바뀝니다. 경계가 확인되지 않은 페이지는 처음 적용할 때 분석 시간이 필요할 수 있습니다.']],
 outside:['대사·독백 표시',[
  '말풍선 밖 대사·독백을 툴팁, 흰 배경, 이미지 복원 중에서 선택합니다. 이미지 복원은 말풍선 안에서 툴팁으로 남은 대사에도 적용합니다. 툴팁을 고르면 복원한 부분이 원문으로 돌아갑니다.',
  '이미 직접 표시된 대사, 효과음으로 검출된 영역과 개별 편집은 변경하지 않습니다. 주변 글자를 가리거나 번역문이 들어가지 않는 영역은 툴팁으로 유지합니다.',
  '흰 배경은 그림을 가립니다. 이미지 복원은 원문을 지우고 가려진 그림을 추정하므로 선이나 무늬가 달라질 수 있습니다. 처음에는 복원 시간이 필요하고, 이후에는 재번역 없이 전환됩니다.']]
};
let helpButton=null,helpTopic='';
const helpOpen=()=>$('panel-help').matches(':popover-open');
function helpStatus(){
 const current=$('help-current');
 current.textContent=helpTopic==='names'?(nameWork?'현재 사전: '+nameWork.title+' · '+nameWork.entries.length+'개':'현재 작품과 번역 언어에 등록된 명칭 사전이 없습니다.'):['display','outside'].includes(helpTopic)?$('display-status').textContent:'';
 current.hidden=!current.textContent;
}
function positionHelp(){
 if(!helpOpen()||!helpButton?.isConnected)return;
 const help=$('panel-help'),main=help.closest('main').getBoundingClientRect(),anchor=helpButton.getBoundingClientRect();
 const width=Math.max(0,Math.min(340,main.width-16,innerWidth-16));
 help.style.width=width+'px';help.style.maxHeight=Math.max(0,innerHeight-16)+'px';
 const height=help.getBoundingClientRect().height;
 help.style.left=Math.max(8,Math.min(main.right-width-8,innerWidth-width-8))+'px';
 help.style.top=Math.max(8,Math.min(anchor.bottom+6,innerHeight-height-8))+'px';
}
function closeHelp(restore=false){
 const previous=helpButton;if(helpOpen())$('panel-help').hidePopover();
 previous?.setAttribute('aria-expanded','false');helpButton=null;helpTopic='';
 if(restore&&previous?.isConnected)previous.focus();
}
for(const button of (embeddedPanel?.root||document).querySelectorAll('[data-help]')){
 let pressedOpen=false;
 button.onpointerdown=()=>{pressedOpen=helpOpen()&&helpButton===button;};
 button.onclick=event=>{
 const wasOpen=event.detail>0&&pressedOpen;pressedOpen=false;
 if(wasOpen||helpOpen()&&helpButton===button){closeHelp();return;}
 closeHelp();helpButton=button;helpTopic=button.dataset.help;
 const [title,paragraphs]=helpTopics[helpTopic];$('help-title').textContent=title;
 $('help-body').replaceChildren(...paragraphs.map(text=>{const paragraph=document.createElement('p');paragraph.textContent=text;return paragraph;}));
 helpStatus();button.setAttribute('aria-expanded','true');$('panel-help').showPopover();positionHelp();$('help-close').focus({preventScroll:true});
 };
}
$('help-close').onclick=()=>closeHelp(true);
$('panel-help').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeHelp(true);}});
$('panel-help').addEventListener('toggle',()=>{if(!helpOpen())closeHelp();});
addEventListener('resize',positionHelp);
new ResizeObserver(positionHelp).observe($('panel-header'));
$('panel-header').addEventListener('scroll',positionHelp,{passive:true});
const rpc=async msg=>{const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'확장 오류');if(r.value?.error)throw Error(r.value.error);return r.value;};
function thumbnail(record,e){
 if(record.preview===e.preview)return;
 record.preview=e.preview;record.observer?.disconnect();
 const img=record.thumb;img.alt=e.title||`이미지 ${e.index+1}`;
 img.src=thumbs.get(e.preview)||'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="54" height="76"><rect width="54" height="76" fill="%23e3e9ed"/></svg>';
 if(thumbs.has(e.preview))return;
 if(e.preview?.startsWith('data:image/')){img.src=e.preview;return;}
 const source=e.preview;
 record.observer=new IntersectionObserver(async entries=>{
  if(!entries.some(r=>r.isIntersecting))return;record.observer.disconnect();
  try{
   if(!thumbTasks.has(source))thumbTasks.set(source,rpc({type:'thumbnail',url:source,referrer:pageURL}));
   const data=await thumbTasks.get(source);thumbs.set(source,data);
   if(record.preview===source){img.src=data;img.style.opacity='1';}
  }catch{thumbTasks.delete(source);}
 });record.observer.observe(img);
}
function selectionState(){
 $('run').disabled=running||saving||displayBusy;$('preload').disabled=running||saving||displayBusy;
 $('zip').disabled=running||saving||displayBusy||!selected.size;$('zip').textContent=`선택 저장 (${selected.size})`;
 $('lightweight-display').disabled=saving||changingDisplay;$('display-mode').disabled=saving||changingDisplay||$('lightweight-display').checked;$('outside-text-mode').disabled=saving||changingDisplay||$('lightweight-display').checked;$('display-retry').disabled=saving||changingDisplay||running||displayBusy;
 if($('names-correct'))$('names-correct').disabled=running||saving||displayBusy||!nameWork?.entries?.some(entry=>entry.kind!=='honorific');
 if($('names-undo'))$('names-undo').disabled=running||saving||displayBusy;
 const all=$('all').querySelector('input');all.checked=known.size>0&&selected.size===known.size;all.indeterminate=selected.size>0&&selected.size<known.size;
}
function display(s){
 running=!!s.running;
 displayBusy=!!s.displayBusy;
 if(!changingDisplay){$('lightweight-display').checked=!!s.lightweightDisplay;$('display-mode').value=s.displayMode||'auto';$('outside-text-mode').value=s.outsideTextMode||'tooltip';}
 $('display-status').textContent=s.displayMessage||'';$('display-status').hidden=!s.displayMessage||!s.displayBusy&&!s.displayPaused;$('display-retry').hidden=!s.displayPaused;
 if(s.pageURL){pageURL=s.pageURL;$('page').textContent=new URL(pageURL).hostname;}
 if($('name-status')){
  $('name-status').textContent=s.nameMessage||'';$('name-status').hidden=!s.nameMessage;
  if(namePageURL!==pageURL){namePageURL=pageURL;rpc({type:'namesContext',pageURL}).then(context=>{nameWork=context.work;helpStatus();positionHelp();selectionState();}).catch(()=>{});}
 }
 if(helpOpen()){helpStatus();positionHelp();}
 if(!saving&&Date.now()>noticeUntil)$('status').textContent=s.message;
 $('run').disabled=s.running;$('preload').disabled=s.running;
 const active=new Set(s.items.map(e=>e.key));
 for(const [key,row]of rows)if(!active.has(key)){row.observer?.disconnect();row.node.remove();rows.delete(key);known.delete(key);selected.delete(key);}
 let previous=null;
 for(const e of s.items){
  if(!known.has(e.key)){known.add(e.key);if(autoSelectNew)selected.add(e.key);}
  let r=rows.get(e.key);
  if(!r){
   const node=document.createElement('div');node.className='item';node.dataset.key=e.key;
   const check=document.createElement('input');check.type='checkbox';
   check.onchange=()=>{check.checked?selected.add(e.key):selected.delete(e.key);selectionState();};
   const thumb=document.createElement('img');thumb.loading='lazy';thumb.onerror=()=>{thumb.style.opacity='0.3';};
   const label=document.createElement('span');
   const locate=document.createElement('button');locate.textContent='이동';locate.title='만화 페이지의 해당 이미지로 스크롤합니다';
   const edit=document.createElement('button');edit.textContent='편집';
   const choice=document.createElement('label');choice.className='item-choice';choice.append(check,thumb,label);
   node.append(choice,locate,edit);r={node,check,thumb,label,locate,edit,entry:e};rows.set(e.key,r);
   locate.onclick=()=>control('locate',{key:r.entry.key,sourceURL:r.entry.preview});
   edit.onclick=()=>control('edit',{key:r.entry.key});
  }
  r.entry=e;r.check.checked=selected.has(e.key);r.edit.hidden=!e.done;r.edit.disabled=running||displayBusy||saving;
  const label=`${e.index+1}. ${e.state}`;
  r.node.title=`${e.title||'이미지'} · ${e.width||'?'}×${e.height||'?'}`;
  if(r.label.textContent!==label)r.label.textContent=label;
  // Keep the same button node between pointerdown and pointerup, even while polling.
  const expected=previous?previous.nextSibling:$('items').firstChild;
  if(expected!==r.node)$('items').insertBefore(r.node,expected);
  previous=r.node;thumbnail(r,e);
 }
 selectionState();
}
let connection=null;
async function connect(){
 if(connection)return connection;
 connection=(async()=>{
  const forced=Number(new URLSearchParams(location.search).get('tab'));
  let tab=embeddedPanel?{id:embeddedPanel.tabId,url:location.href}:undefined;
  if(!embeddedPanel&&Number.isInteger(forced)&&forced>0){try{tab=await chrome.tabs.get(forced);}catch{}}
  if(!tab||!/^https?:/.test(tab.url||'')){
   const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});
   tab=tabs.find(t=>/^https?:/.test(t.url||''));
  }
  if(!Number.isInteger(tab?.id)||tab.id<0||!/^https?:/.test(tab.url||'')){
   tabId=undefined;throw Error('만화 페이지를 선택한 뒤 새로고침을 눌러주세요.');
  }
  if(tabId!==tab.id){known.clear();selected.clear();pageURL='';}
  tabId=tab.id;pageURL=tab.url;$('page').textContent=new URL(tab.url).hostname;
  display(await rpc({type:'connect',tabId}));
 })();
 try{await connection;}finally{connection=null;}
}
async function control(action,extra={}){
 try{
  if(!Number.isInteger(tabId)||action==='preload')await connect();
  display(await rpc({type:'control',tabId,action,...extra}));
 }catch(e){noticeUntil=Date.now()+6000;$('status').textContent=e.message;}
}
$('preload').onclick=()=>control('preload');
$('display-mode').onchange=async()=>{const mode=$('display-mode').value;changingDisplay=true;selectionState();try{await control('displayMode',{mode});}finally{changingDisplay=false;await control('status');}};
$('outside-text-mode').onchange=async()=>{const mode=$('outside-text-mode').value;changingDisplay=true;selectionState();try{await control('outsideTextMode',{mode});}finally{changingDisplay=false;await control('status');}};
$('display-retry').onclick=()=>control('displayRetry');
if($('names-settings'))$('names-settings').onclick=()=>rpc({type:'openNames',tabId}).catch(error=>{$('name-status').textContent=error.message;$('name-status').hidden=false;});
if($('names-correct'))$('names-correct').onclick=()=>control('namesCorrect');
if($('names-undo'))$('names-undo').onclick=()=>control('namesUndo');
chrome.storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&(changes.nameWorks||changes.target)){namePageURL='';nameWork=null;control('status');}});
$('run').onclick=()=>control('run',{keys:[...selected]});$('stop').onclick=()=>control('stop');$('toggle').onclick=()=>control('toggle');$('settings').onclick=()=>embeddedPanel?rpc({type:'openOptions'}):chrome.runtime.openOptionsPage();
$('all').querySelector('input').onchange=e=>{
 autoSelectNew=e.target.checked;selected.clear();
 if(autoSelectNew)for(const key of known)selected.add(key);
 // Selection belongs to this panel. A slow or disconnected page must not
 // delay its checkboxes until a status RPC completes.
 for(const [key,row]of rows)row.check.checked=selected.has(key);
 selectionState();
};
(async()=>{try{await connect();}catch(e){$('status').textContent=e.message;}})();
setInterval(async()=>{if(busy||!Number.isInteger(tabId)||embeddedPanel&&(!embeddedPanel.isOpen()||document.hidden))return;busy=true;try{await control('status');}finally{busy=false;}},1500);
// The default side panel can open before Chrome supplies a tab-specific path.
chrome.tabs?.onActivated?.addListener(()=>{
 if(new URLSearchParams(location.search).has('tab'))return;
 connect().catch(e=>{$('status').textContent=e.message;});
});

$('zip').onclick=async()=>{
 if(saving||running||displayBusy||!selected.size)return;
 const chosen=[...rows.values()].map(r=>r.entry).filter(e=>selected.has(e.key)).sort((a,b)=>a.index-b.index),files=[],manifest=[];saving=true;selectionState();
 try{
  await rpc({type:'control',tabId,action:'exportStart'});
  for(const [i,e]of chosen.entries()){
   $('status').textContent=`ZIP 준비 ${i+1}/${chosen.length}`;const name=String(e.index+1).padStart(4,'0');
   try{
    const item=await rpc({type:'control',tabId,action:'export',key:e.key});if(!item?.data?.startsWith('data:image/'))throw Error('이미지 데이터를 받지 못했습니다.');
    const response=await fetch(item.data),blob=await response.blob();const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/avif':'avif'})[blob.type]||'img';
    files.push({name:name+'.'+ext,data:new Uint8Array(await blob.arrayBuffer())});manifest.push({index:e.index+1,file:name+'.'+ext,state:item.state,kind:item.kind,warning:item.warning});
   }catch(error){files.push({name:name+'-error.txt',data:new TextEncoder().encode(error.message)});manifest.push({index:e.index+1,error:error.message});}
  }
  files.push({name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(manifest,null,2))});
  const url=URL.createObjectURL(MangaZip.create(files)),a=document.createElement('a');a.href=url;a.download='manga-selected.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  const failures=manifest.filter(x=>x.error||x.warning).length;$('status').textContent=`${chosen.length}장 ZIP 저장${failures?` · ${failures}건은 manifest.json 확인`:''}`;noticeUntil=Date.now()+10000;
 }catch(error){$('status').textContent=error.message;noticeUntil=Date.now()+6000;}finally{try{await rpc({type:'control',tabId,action:'exportEnd'});}catch{}saving=false;selectionState();}
};

$('lightweight-display').onchange=async()=>{const enabled=$('lightweight-display').checked;changingDisplay=true;selectionState();try{await control('lightweightDisplay',{enabled});}finally{changingDisplay=false;await control('status');}};
