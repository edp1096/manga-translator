const embeddedPanel=globalThis.MangaPagePanel;
const $=id=>(embeddedPanel?.root||document).getElementById(id),selected=new Set();
let tabId,known=new Set(),busy=false,pageURL='',noticeUntil=0,autoSelectNew=true,saving=false,running=false,displayBusy=false,changingDisplay=false;
const thumbs=new Map(),thumbTasks=new Map(),rows=new Map();
let nameWork=null,namePageURL='';
const helpTopics={
 status:['진행 상태',[]],
 force:['대사·독백 툴팁 복원',['효과음을 제외한 대사·독백 툴팁에 원문 영역 제거와 배경 복원을 추가로 시도합니다. 말풍선 안팎 모두 포함합니다.','그림이 손상될 수 있습니다. 실패하거나 글자가 들어가지 않는 영역은 툴팁으로 유지합니다. 끄면 기존 표시로 돌아갑니다. 경량 처리에서는 실행하지 않습니다.']],
 lightweight:['경량 처리',['표시용 추가 말풍선 분석·흰 배경·이미지 복원과 정밀 배치를 생략합니다. OCR·중복 제거·툴팁 겹침 방지와 개별 편집은 유지합니다.','선택해 둔 표시 방식은 보존됩니다. 끄면 재번역 없이 해당 방식을 다시 적용합니다. 이미 실행 중인 서버 요청은 완료될 때까지 시간이 필요할 수 있습니다.']],
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
 current.textContent=helpTopic==='status'?[...new Set(['status','display-status','name-status'].map(id=>$(id)?.textContent).filter(Boolean))].join('\n\n'):helpTopic==='names'?(nameWork?'현재 사전: '+nameWork.title+' · '+nameWork.entries.length+'개':'현재 작품과 번역 언어에 등록된 명칭 사전이 없습니다.'):['display','outside'].includes(helpTopic)?$('display-status').textContent:'';
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
new MutationObserver(()=>{$('status').title=$('status').textContent;if(helpOpen()&&helpTopic==='status'){helpStatus();positionHelp();}}).observe($('status'),{childList:true,characterData:true,subtree:true});
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
const defaultSaveOptions=()=>({mode:'single',direction:'rtl',firstSingle:false,pairs:[]});
let saveOptions=defaultSaveOptions(),saveIdentity='',saveReady=false,saveLoad=Promise.resolve(),saveWrite=Promise.resolve();
function saveEntries(){return [...rows.values()].map(r=>r.entry).sort((a,b)=>a.index-b.index);}
function savePlan(){return MangaZip.plan(saveEntries(),selected,saveOptions);}
function positionSaveOptions(){
 const popup=$('save-options');if(!popup.matches(':popover-open'))return;
 const main=popup.closest('main').getBoundingClientRect(),button=$('save-options-toggle').getBoundingClientRect(),width=Math.min(310,main.width-16,innerWidth-16);
 popup.style.width=Math.max(0,width)+'px';popup.style.maxHeight=Math.max(0,innerHeight-16)+'px';
 popup.style.left=Math.max(8,Math.min(main.right-width-8,innerWidth-width-8))+'px';popup.style.top=Math.max(8,Math.min(button.bottom+6,innerHeight-popup.getBoundingClientRect().height-8))+'px';
}
function syncSaveOptions(){
 $('save-group-mode').value=saveOptions.mode;$('save-first-single').checked=saveOptions.firstSingle;$('save-direction').value=saveOptions.direction;
 $('save-group-mode').disabled=!saveReady||saving;$('save-first-single').disabled=!saveReady||saving||saveOptions.mode!=='pairs';$('save-direction').disabled=!saveReady||saving||saveOptions.mode==='single';
 $('save-group-note').textContent=saveOptions.mode==='manual'?'목록의 ‘다음과 묶기’로 인접한 두 페이지를 지정하세요. 두 장 모두 선택한 경우 가로 PNG 한 장으로 저장합니다.':'묶은 두 페이지는 가로 PNG 한 장으로 저장합니다. 한쪽만 선택하면 그 페이지만 개별 저장합니다.';
 const groups=savePlan(),labels=new Map();for(const group of groups)if(group.length===2)for(const entry of group)labels.set(entry.key,`${group[0].index+1}–${group[1].index+1}`);
 const all=saveEntries();for(let i=0;i<all.length;i++){
  const e=all[i],row=rows.get(e.key),next=all[i+1];if(!row)continue;
  const group=labels.get(e.key);row.node.classList.toggle('paired',!!group);row.label.textContent=`${e.index+1}. ${e.state}${group?' · '+group+' 묶음':''}`;
  row.pair.hidden=saveOptions.mode!=='manual';row.pair.disabled=saving||!saveReady||!next||next.index!==e.index+1||!selected.has(e.key)||!selected.has(next.key);
  const joined=saveOptions.pairs.some(pair=>pair[0]===MangaZip.identity(e)&&pair[1]===MangaZip.identity(next||{}));row.pair.textContent=joined?'묶음 해제':'다음과 묶기';row.pair.setAttribute('aria-pressed',String(joined));
 }
 positionSaveOptions();return groups;
}
function loadSaveOptions(identity){
 if(identity===saveIdentity)return;saveIdentity=identity;saveReady=false;saveOptions=defaultSaveOptions();
 const key='export-groups:'+identity;
 saveLoad=(async()=>{try{const saved=(await chrome.storage.local.get(key))[key];if(saveIdentity!==identity)return;
  if(saved){saveOptions={mode:['single','pairs','manual'].includes(saved.mode)?saved.mode:'single',direction:saved.direction==='ltr'?'ltr':'rtl',firstSingle:saved.firstSingle===true,pairs:Array.isArray(saved.pairs)?saved.pairs.filter(p=>Array.isArray(p)&&p.length===2&&p.every(x=>typeof x==='string'&&x.length<=8192)).slice(0,2000):[]};}
 }catch(error){if(saveIdentity===identity){$('status').textContent='저장 묶음 설정 읽기 실패: '+error.message;noticeUntil=Date.now()+6000;}}
 finally{if(saveIdentity===identity){saveReady=true;selectionState();}}})();
}
function rememberSaveOptions(){
 const identity=saveIdentity,value=structuredClone(saveOptions);if(!identity)return;
 saveWrite=saveWrite.catch(()=>{}).then(async()=>{await chrome.storage.local.set({['export-groups:'+identity]:value});}).catch(error=>{$('status').textContent='저장 묶음 설정 저장 실패: '+error.message;noticeUntil=Date.now()+6000;});
}
for(const id of ['save-group-mode','save-first-single','save-direction'])$(id).onchange=()=>{
 if(saving||!saveReady)return;saveOptions.mode=$('save-group-mode').value;saveOptions.firstSingle=$('save-first-single').checked;saveOptions.direction=$('save-direction').value;rememberSaveOptions();selectionState();
};
$('save-options').addEventListener('toggle',positionSaveOptions);addEventListener('resize',positionSaveOptions);$('panel-header').addEventListener('scroll',positionSaveOptions,{passive:true});
function togglePair(key){
 if(saving||!saveReady)return;const all=saveEntries(),i=all.findIndex(e=>e.key===key),a=all[i],b=all[i+1];if(!a||!b||b.index!==a.index+1||!selected.has(a.key)||!selected.has(b.key))return;
 const left=MangaZip.identity(a),right=MangaZip.identity(b),remove=saveOptions.pairs.some(p=>p[0]===left&&p[1]===right);
 saveOptions.pairs=saveOptions.pairs.filter(p=>!p.includes(left)&&!p.includes(right));if(!remove)saveOptions.pairs.push([left,right]);rememberSaveOptions();selectionState();
}
function selectionState(){
 $('run').disabled=running||saving||displayBusy;$('preload').disabled=running||saving||displayBusy;
 const groups=syncSaveOptions();$('zip').disabled=running||saving||displayBusy||!selected.size||!saveReady;$('save-options-toggle').disabled=saving;$('zip').textContent=`선택 저장 (${groups.length<selected.size?selected.size+'→'+groups.length:selected.size})`;
 $('force-tooltip-restoration').disabled=saving||changingDisplay||$('lightweight-display').checked;
 $('lightweight-display').disabled=saving||changingDisplay;$('display-mode').disabled=saving||changingDisplay||$('lightweight-display').checked;$('outside-text-mode').disabled=saving||changingDisplay||$('lightweight-display').checked;$('display-retry').disabled=saving||changingDisplay||running||displayBusy;
 if($('names-correct'))$('names-correct').disabled=running||saving||displayBusy||!nameWork?.entries?.some(entry=>entry.kind!=='honorific');
 if($('names-undo'))$('names-undo').disabled=running||saving||displayBusy;
 const all=$('all').querySelector('input');all.checked=known.size>0&&selected.size===known.size;all.indeterminate=selected.size>0&&selected.size<known.size;
}
function display(s){
 const displaySummary=$('display-tools').querySelector('summary'),namesSummary=$('name-tools').querySelector('summary');
 displaySummary.textContent='표시 옵션 · '+(s.lightweightDisplay?'경량':(s.displayMode==='white'?'흰 배경':'기본')+' / '+({tooltip:'툴팁',white:'흰 배경',restore:'복원'}[s.outsideTextMode]||'툴팁'));
 namesSummary.textContent='명칭 도구'+(s.nameBusy?' · 적용 중':'');namesSummary.title=s.nameMessage||'';
 running=!!s.running;
 displayBusy=!!s.displayBusy;
 if(!changingDisplay){$('force-tooltip-restoration').checked=!!s.forceTooltipRestoration;$('lightweight-display').checked=!!s.lightweightDisplay;$('display-mode').value=s.displayMode||'auto';$('outside-text-mode').value=s.outsideTextMode||'tooltip';}
 $('display-status').textContent=s.displayMessage||'';$('display-status').hidden=!s.displayMessage||!s.displayBusy&&!s.displayPaused&&!s.forceFailures;$('display-retry').hidden=!s.displayPaused&&!s.forceFailures;
 if(s.pageURL){loadSaveOptions(s.pageIdentity||s.pageURL);pageURL=s.pageURL;$('page').textContent=new URL(pageURL).hostname;}
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
   const pair=document.createElement('button');pair.type='button';pair.className='pair-toggle';pair.title='다음 페이지와 가로 이미지 한 장으로 저장합니다';pair.hidden=true;
   node.append(choice,locate,edit,pair);r={node,check,thumb,label,locate,edit,pair,entry:e};pair.onclick=()=>togglePair(r.entry.key);rows.set(e.key,r);
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
 if(saving||running||displayBusy||!selected.size||!saveReady)return;
 const groups=savePlan(),direction=saveOptions.direction,files=[],manifest=[];let read=0;saving=true;selectionState();
 const filename=e=>String(e.index+1).padStart(4,'0');
 async function single(e,item,warning=''){
  const name=filename(e);
  if(item.error){files.push({name:name+'-error.txt',data:new TextEncoder().encode(item.error)});manifest.push({index:e.index+1,error:item.error});return;}
  const response=await fetch(item.data),blob=await response.blob(),ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/avif':'avif'})[blob.type]||'img';
  files.push({name:name+'.'+ext,data:new Uint8Array(await blob.arrayBuffer())});manifest.push({index:e.index+1,file:name+'.'+ext,state:item.state,kind:item.kind,warning:[item.warning,warning].filter(Boolean).join(' · ')});
 }
 try{
  await rpc({type:'control',tabId,action:'exportStart'});
  for(const group of groups){
   const items=[];for(const e of group){$('status').textContent=`ZIP 준비 ${++read}/${selected.size}`;try{const item=await rpc({type:'control',tabId,action:'export',key:e.key});if(!item?.data?.startsWith('data:image/'))throw Error('이미지 데이터를 받지 못했습니다.');items.push(item);}catch(error){items.push({error:error.message});}}
   let warning='';
   if(group.length===2&&!items.some(x=>x.error)){
    try{const merged=await MangaZip.merge(items.map(x=>x.data),direction),name=group.map(filename).join('-')+'.png';files.push({name,data:merged.data});manifest.push({indices:group.map(e=>e.index+1),file:name,direction,width:merged.width,height:merged.height,pages:group.map((e,i)=>({index:e.index+1,position:direction==='ltr'?(i?'right':'left'):(i?'left':'right'),state:items[i].state,kind:items[i].kind,warning:items[i].warning})),warning:items.map(x=>x.warning).filter(Boolean).join(' · ')});continue;}catch(error){warning='묶음 저장 실패 · 개별 저장: '+error.message;}
   }else if(group.length===2)warning='짝 페이지를 읽지 못해 개별 저장했습니다.';
   for(let i=0;i<group.length;i++)try{await single(group[i],items[i],warning);}catch(error){await single(group[i],{error:error.message});}
  }
  files.push({name:'manifest.json',data:new TextEncoder().encode(JSON.stringify(manifest,null,2))});
  const url=URL.createObjectURL(MangaZip.create(files)),a=document.createElement('a');a.href=url;a.download='manga-selected.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  const failures=manifest.filter(x=>x.error||x.warning).length,images=manifest.filter(x=>x.file).length;$('status').textContent=`${selected.size}페이지 → ${images}개 이미지 ZIP 저장${failures?` · ${failures}건은 manifest.json 확인`:''}`;noticeUntil=Date.now()+10000;
 }catch(error){$('status').textContent=error.message;noticeUntil=Date.now()+6000;}finally{try{await rpc({type:'control',tabId,action:'exportEnd'});}catch{}saving=false;selectionState();}
};

$('lightweight-display').onchange=async()=>{const enabled=$('lightweight-display').checked;changingDisplay=true;selectionState();try{await control('lightweightDisplay',{enabled});}finally{changingDisplay=false;await control('status');}};

$('force-tooltip-restoration').onchange=async()=>{const enabled=$('force-tooltip-restoration').checked;changingDisplay=true;selectionState();try{await control('forceTooltipRestoration',{enabled});}finally{changingDisplay=false;await control('status');}};
