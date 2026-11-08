// Editing state belongs to the open editor, source tab and durable job result.
// Never retain a full per-job editing snapshot in extension storage.
(()=>{
 const valid=id=>typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id);
 function preferences(value){return {displayMode:value.displayMode==='white'?'white':'auto',outsideTextMode:['white','restore'].includes(value.outsideTextMode)?value.outsideTextMode:'tooltip',lightweightDisplay:value.lightweightDisplay===true,forceTooltipRestoration:value.forceTooltipRestoration===true};}
 async function route(id,sender){
  if(!valid(id))throw Error('잘못된 작업 ID입니다.');
  try{const url=new URL(sender.url||''),editor=new URL(chrome.runtime.getURL('editor.html')),tab=url.searchParams.get('tab'),key=url.searchParams.get('key');
   if(url.protocol===editor.protocol&&url.host===editor.host&&url.pathname===editor.pathname&&url.searchParams.get('job')===id&&tab!==null&&Number.isInteger(Number(tab))&&Number(tab)>=0&&key&&key.length<=256)return {tabId:Number(tab),key,...preferences({displayMode:url.searchParams.get('mode'),outsideTextMode:url.searchParams.get('outside'),lightweightDisplay:url.searchParams.get('light')==='1',forceTooltipRestoration:url.searchParams.get('force')==='1'})};
  }catch{}
  const saved=(await chrome.storage.local.get('edit:'+id))['edit:'+id];
  if(saved)return saved;
  return preferences(await settings());
 }
 async function open(msg,sender){
  if(!valid(msg.id)||!Number.isInteger(sender.tab?.id)||typeof msg.key!=='string'||!msg.key||msg.key.length>256)throw Error('페이지의 편집 버튼으로 열어주세요.');
  const url=new URL(chrome.runtime.getURL('editor.html')),prefs=preferences(msg);
  for(const [key,value]of Object.entries({job:msg.id,tab:sender.tab.id,key:msg.key,mode:prefs.displayMode,outside:prefs.outsideTextMode,light:prefs.lightweightDisplay?'1':'0',force:prefs.forceTooltipRestoration?'1':'0'}))url.searchParams.set(key,String(value));
  await chrome.tabs.create({windowId:sender.tab.windowId,url:url.href});return true;
 }
 async function load(id,sender){
  const saved=await route(id,sender);
  if(Number.isInteger(saved.tabId)&&saved.key)try{const snapshot=await chrome.tabs.sendMessage(saved.tabId,{type:'getEditState',id,key:saved.key});if(snapshot?.result&&!snapshot.error)return {...snapshot,tabId:saved.tabId,key:saved.key};}catch{}
  try{const data=await(await MangaLibrary.request('/editor/'+encodeURIComponent(id))).json();if(!data.result||!Array.isArray(data.result.regions))throw Error('Invalid editor data');return {...data,tabId:saved.tabId,key:saved.key,...preferences(saved)};}catch(error){
   // Pre-change snapshots remain readable; never delete them as a quota fix.
   if(saved.result)return saved;
   throw Error('편집 결과를 불러오지 못했습니다. 원본 만화 탭에서 편집을 다시 열거나 관리 앱 연결을 확인하세요.');
  }
 }
 globalThis.MangaEditorSessions={open,load,route};
})();
