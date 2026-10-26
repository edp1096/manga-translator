const $=id=>document.getElementById(id),selected=new Set();
let tabId,known=new Set(),busy=false,pageURL='',noticeUntil=0,autoSelectNew=true,saving=false,running=false;
const thumbs=new Map(),thumbTasks=new Map(),rows=new Map();
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
 $('run').disabled=running||saving;$('preload').disabled=running||saving;
 $('zip').disabled=running||saving||!selected.size;$('zip').textContent=`선택 저장 (${selected.size})`;
 const all=$('all').querySelector('input');all.checked=known.size>0&&selected.size===known.size;all.indeterminate=selected.size>0&&selected.size<known.size;
}
function display(s){
 running=!!s.running;
 if(s.pageURL){pageURL=s.pageURL;$('page').textContent=new URL(pageURL).hostname;}
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
  r.entry=e;r.check.checked=selected.has(e.key);r.edit.hidden=!e.done;
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
  let tab;
  if(Number.isInteger(forced)&&forced>0){try{tab=await chrome.tabs.get(forced);}catch{}}
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
$('run').onclick=()=>control('run',{keys:[...selected]});$('stop').onclick=()=>control('stop');$('toggle').onclick=()=>control('toggle');$('settings').onclick=()=>chrome.runtime.openOptionsPage();
$('all').querySelector('input').onchange=e=>{autoSelectNew=e.target.checked;selected.clear();if(e.target.checked)for(const key of known)selected.add(key);control('status');};
(async()=>{try{await connect();}catch(e){$('status').textContent=e.message;}})();
setInterval(async()=>{if(busy||!Number.isInteger(tabId))return;busy=true;try{await control('status');}finally{busy=false;}},1500);
// The default side panel can open before Chrome supplies a tab-specific path.
chrome.tabs.onActivated.addListener(()=>{
 if(new URLSearchParams(location.search).has('tab'))return;
 connect().catch(e=>{$('status').textContent=e.message;});
});

$('zip').onclick=async()=>{
 if(saving||running||!selected.size)return;
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
