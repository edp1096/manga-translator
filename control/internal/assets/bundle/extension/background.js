const defaults = {server:'http://127.0.0.1:8793',token:'',managementServer:'',target:'Korean',selector:'',captureFallback:true,displayMode:'auto',outsideTextMode:'tooltip',lightweightDisplay:false,forceTooltipRestoration:false,nameCorrectionScope:'chapter',fontPolicy:{}};
importScripts('server-addresses.js','fonts.js','panel_scope.js','readers.js','names.js','job_cache.js','library.js','editor-session.js');
async function settings(){return {...defaults,...await chrome.storage.local.get(Object.keys(defaults))};}
async function api(path, options={}) {
  const s=await settings();
  if(!s.token) throw Error('관리 앱의 크롬 확장에서 ‘확장 연결하기’를 먼저 누르세요. 토큰은 자동으로 전달됩니다.');
  const timeout=options.timeout||25000;delete options.timeout;
  const response=await fetch(s.server.replace(/\/$/,'')+path,{...options,headers:{...options.headers,Authorization:`Bearer ${s.token}`},signal:AbortSignal.timeout(timeout)});
  if(!response.ok) {
    const message=(await response.text()).slice(0,1000);
    if(path.includes('/restoration')&&(message.includes('Manga LaMa model is missing')||message.includes('이미지 복원 모델이 없습니다')))
      throw Error('이미지 복원 모델이 설치되지 않았습니다. 관리 앱 → 설치 관리 → 배경 이미지 복원에서 Manga LaMa를 다운로드한 뒤 다시 시도하세요.');
    throw Error(`서버 ${response.status}: ${message.slice(0,250)}`);
  }
  return response;
}
// Service workers have no FileReader. Convert in bounded chunks instead.
async function encoded(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer());
  let binary=''; for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return `data:${blob.type||'image/png'};base64,${btoa(binary)}`;
}
let imageChain=Promise.resolve();
function browserImage(url,referrer){
  const task=imageChain.catch(()=>{}).then(async()=>{
    if(!/^https?:/.test(url))throw Error('이미지 URL을 읽을 수 없습니다.');
    // Apply the page's Referer only to this extension's own image request.
    const id=913701;
    await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[id],addRules:[{id,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'referer',operation:'set',value:referrer}]},condition:{urlFilter:'|'+url+'|',initiatorDomains:[chrome.runtime.id],resourceTypes:['xmlhttprequest']}}]});
    try {
      const r=await fetch(url,{credentials:'include',signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw Error(`이미지 HTTP ${r.status}`);
      const blob=await r.blob();
      if(blob.size>24*1024*1024)throw Error('이미지가 24 MiB를 넘습니다.');
      if(!blob.type.startsWith('image/'))throw Error('이미지 대신 접근 차단 응답을 받았습니다.');
      return await encoded(blob);
    } finally {await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[id]});}
  });
  imageChain=task;return task;
}
const pageCacheKey=url=>'page:'+MangaReaders.pageIdentity(url);
async function nameContext(url,target){const saved=await chrome.storage.local.get('nameWorks'),works=saved.nameWorks||[];target=target||(await settings()).target;return {works,target,work:url?MangaNames.forURL(works,url,target):null};}
async function nameTargets(url){const context=await nameContext(url);if(!context.work)return [];const stored=await MangaJobCache.pages(),server=(await settings()).server;return Object.entries(stored).filter(([key,value])=>key.startsWith('page:')&&value?.server===server&&Date.now()-value.updated<86400000&&MangaNames.forURL(context.works,key.slice(5),context.target)?.id===context.work.id).flatMap(([key,value])=>(value.items||[]).filter(item=>item.result&&!item.pendingJob&&(item.result.target||'Korean')===context.target).map(item=>({cacheKey:key,pageURL:key.slice(5),sourceURL:item.sourceURL,key:item.key,id:item.id,result:item.result})));}
function rememberNameTarget(msg,sender){const task=cacheWrites.catch(()=>{}).then(async()=>{const context=await nameContext(sender.tab?.url||'');if(!context.work||MangaNames.forURL(context.works,msg.target.pageURL,context.target)?.id!==context.work.id||(msg.target.result?.target||'Korean')!==context.target||(msg.result?.target||'Korean')!==context.target)throw Error('다른 작품의 결과에는 적용할 수 없습니다.');const key=pageCacheKey(msg.target.pageURL),saved=(await chrome.storage.local.get(key))[key];if(saved?.server!==(await settings()).server)return false;const item=saved.items?.find(item=>item.id===msg.target.id&&item.sourceURL===msg.target.sourceURL);if(!item||JSON.stringify(item.result)!==JSON.stringify(msg.target.result))return false;item.result=msg.result;item.updated=Date.now();saved.updated=Date.now();await MangaLibrary.remember(item);await MangaJobCache.writePage(key,saved).catch(error=>console.warn('명칭 표시 캐시:',error.message));const tabs=await chrome.tabs.query({});for(const tab of tabs)if(tab.id!==sender.tab?.id&&tab.url&&pageCacheKey(tab.url)===key)chrome.tabs.sendMessage(tab.id,{type:'namesApplied',id:item.id,sourceURL:item.sourceURL,before:msg.target.result,result:msg.result}).catch(()=>{});return true;});cacheWrites=task;return task;}
let nameWrites=Promise.resolve();
function saveNames(work){const task=nameWrites.catch(()=>{}).then(async()=>{const validated=MangaNames.validate(work),saved=await nameContext('');const others=saved.works.filter(item=>item.id!==validated.id).map(item=>({...item,scopes:(item.scopes||[]).filter(scope=>(item.target||'Korean')!==validated.target||!validated.scopes.includes(scope))}));if(others.length>=100)throw Error('작품 사전은 100개까지 저장할 수 있습니다.');const works=[...others,validated];await chrome.storage.local.set({nameWorks:works});return{works,work:validated};});nameWrites=task;return task;}
let cacheWrites=Promise.resolve();
const discardedJobs=new Set();
function rememberPage(msg,sender){
 const task=cacheWrites.catch(()=>{}).then(async()=>{
  if(discardedJobs.has(msg.id))return false;
  if(!sender.tab?.url||typeof msg.sourceURL!=='string'||msg.sourceURL.length>8192||!msg.result||!Array.isArray(msg.result.regions)||msg.result.regions.length>150)return false;
  let persisted=false;
  try{await MangaLibrary.remember(msg);persisted=true;}catch(error){if(msg.requirePersist)throw error;console.warn('표시 정보 저장:',error.message);}
  try{
   const key=pageCacheKey(sender.tab.url),server=(await settings()).server,saved=(await chrome.storage.local.get(key))[key],now=Date.now();
   const prior=saved?.server===server?saved.items||[]:[],items=prior.filter(x=>x.sourceURL!==msg.sourceURL&&now-x.updated<86400000);
   items.push({sourceURL:msg.sourceURL,key:msg.key,id:msg.id,result:msg.result,...(msg.bubbles?{bubbles:msg.bubbles}:{}),updated:now});
   await MangaJobCache.writePage(key,{server,updated:now,items:items.slice(-200)});
  }catch(error){if(!persisted&&msg.requirePersist)throw error;console.warn('브라우저 표시 캐시:',error.message);}
  return true;
 });cacheWrites=task;return task;
}
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  (async()=>{
    switch(msg.type){
      case 'page-panel-closed':await globalThis.MangaPagePanels?.closed(sender);return true;
      case 'settings':return settings();
      case 'readerMetadata':{
        if(!Number.isInteger(sender.tab?.id)||sender.frameId!==0||!/^https:\/\/(?:manga-one\.com\/manga\/\d+\/chapter\/\d+|manga-mee\.jp\/detail\/\d+|palcy\.jp\/comics\/\d+|www\.manga-up\.com\/titles\/\d+\/chapters\/\d+|www\.pixiv\.net\/(?:[a-z]{2}\/)?artworks\/\d+)(?:[/?#]|$)/.test(sender.url||''))return null;
        const result=await chrome.scripting.executeScript({target:{tabId:sender.tab.id,frameIds:[0]},world:'MAIN',func:MangaReaders.metadata,args:[msg.command?.action==='locate'&&Number.isInteger(msg.command.slot)?{action:'locate',slot:msg.command.slot}:null]});
        return result[0]?.result||null;
      }
      case 'namesContext':return nameContext(/^https?:/.test(sender.tab?.url||'')?sender.tab.url:msg.pageURL||'');
      case 'namesSave':return saveNames(msg.work);
      case 'nameCorrectionScope':{const scope=msg.scope==='work'?'work':'chapter';await chrome.storage.local.set({nameCorrectionScope:scope});return scope;}
      case 'namesTargets':return nameTargets(sender.tab?.url||'');
      case 'namesRememberTarget':return rememberNameTarget(msg,sender);
      case 'openNames':{
        const tab=Number.isInteger(msg.tabId)?await chrome.tabs.get(msg.tabId):sender.tab;if(!tab||!/^https?:/.test(tab.url||''))throw Error('만화 페이지에서 명칭 사전을 여세요.');await chrome.tabs.create({windowId:tab.windowId,url:chrome.runtime.getURL('names.html')+'?tab='+tab.id+'&page='+encodeURIComponent(tab.url)});return true;
      }
      case 'namesSuggest':return (await api('/api/names/suggest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:msg.source,translation:msg.translation}),timeout:90000})).json();
      case 'namesCorrect':{
        const context=await nameContext(sender.tab?.url||''),dictionary=MangaNames.dictionary(context.work);
        if(!dictionary?.entries.length)throw Error('현재 번역 언어의 명칭 사전을 먼저 저장하세요.');
        if((msg.result?.target||'Korean')!==context.target)throw Error('결과와 명칭 사전의 번역 언어가 다릅니다.');
        if(msg.revision&&dictionary.revision!==msg.revision)throw Error('작업 중 명칭 사전이 바뀌었습니다. 다시 실행하세요.');
        const response=await (await api('/api/names/correct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result:msg.result,dictionary}),timeout:120000})).json();
        const latest=await nameContext(sender.tab?.url||'');if(latest.target!==context.target||latest.work?.id!==dictionary.id||latest.work?.revision!==dictionary.revision)throw Error('작업 중 명칭 사전이 바뀌었습니다. 다시 실행하세요.');return response;
      }
      case 'nameReading':return (await api(`/api/jobs/${msg.id}/names/reading`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({region:msg.region,preview:!!msg.preview}),timeout:120000})).json();
      case 'forceTooltipRestoration':{const enabled=msg.enabled===true;await chrome.storage.local.set({forceTooltipRestoration:enabled});return enabled;}
      case 'lightweightDisplay':{const enabled=msg.enabled===true;await chrome.storage.local.set({lightweightDisplay:enabled});return enabled;}
      case 'outsideTextMode':{const mode=['white','restore'].includes(msg.mode)?msg.mode:'tooltip';await chrome.storage.local.set({outsideTextMode:mode});return mode;}
      case 'displayMode':{
        if(!['auto','white'].includes(msg.mode))throw Error('표시 방식이 올바르지 않습니다.');
        await chrome.storage.local.set({displayMode:msg.mode});return msg.mode;
      }
      case 'connect':{
        if(!Number.isInteger(msg.tabId)||msg.tabId<0)throw Error('만화 페이지를 선택한 뒤 새로고침을 눌러주세요.');
        await chrome.scripting.executeScript({target:{tabId:msg.tabId},files:['polygon.js','fonts.js','rotation.js','render.js','readers.js','names.js','content.js']});
        return chrome.tabs.sendMessage(msg.tabId,{type:'control',action:'scan'});
      }
      case 'control':{
        if(!Number.isInteger(msg.tabId)||msg.tabId<0)throw Error('만화 페이지를 선택한 뒤 새로고침을 눌러주세요.');
        const command={type:'control',action:msg.action,keys:msg.keys,key:msg.key,sourceURL:msg.sourceURL,mode:msg.mode,enabled:msg.enabled,scope:msg.scope};
        if(msg.action==='locate')await chrome.tabs.update(msg.tabId,{active:true});
        try{return await chrome.tabs.sendMessage(msg.tabId,command);}
        catch(error){
          if(!/Receiving end does not exist|Could not establish connection|message port closed/i.test(error.message||''))throw error;
          const tab=await chrome.tabs.get(msg.tabId);
          if(!/^https?:/.test(tab.url||''))throw Error('만화 페이지를 연 뒤 다시 연결하세요.');
          await chrome.scripting.executeScript({target:{tabId:msg.tabId},files:['polygon.js','fonts.js','rotation.js','render.js','readers.js','names.js','content.js']});
          const state=await chrome.tabs.sendMessage(msg.tabId,{type:'control',action:'scan'});
          if(['status','scan'].includes(msg.action))return state;
          if(msg.action==='locate'&&msg.sourceURL)return chrome.tabs.sendMessage(msg.tabId,command);
          return {...state,message:'페이지에 다시 연결했습니다. 새 목록에서 작업을 다시 선택하세요.'};
        }
      }
      case 'remember':return rememberPage(msg,sender);
      case 'restore':return sender.tab?.url?MangaLibrary.restore(sender.tab.url,sender.tab.id):[];
      case 'openOptions':await chrome.runtime.openOptionsPage();return true;
      case 'thumbnail':{
        const data=await browserImage(msg.url,msg.referrer);
        const bitmap=await createImageBitmap(await (await fetch(data)).blob());
        const scale=Math.min(1,120/bitmap.width,170/bitmap.height);
        const c=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
        c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);bitmap.close();
        return encoded(await c.convertToBlob({type:'image/jpeg',quality:0.7}));
      }
      case 'fetchImage':return browserImage(msg.url,sender.tab?.url || msg.referrer);
      case 'capture':{
        const tab=await chrome.tabs.get(sender.tab.id);
        const [active]=await chrome.tabs.query({active:true,windowId:tab.windowId});
        if(active?.id!==tab.id)throw Error('화면 캡처를 위해 이 탭을 활성화하세요.');
        await new Promise(r=>setTimeout(r,550));
        return chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
      }
      case 'createDraft':
      case 'submit':{
        if(msg.type==='createDraft'&&(await(await api('/api/ping')).json()).manualDraftVersion!==1)throw Error('번역 전 편집을 지원하는 최신 관리 앱으로 실행하세요.');
        const blob=await (await fetch(msg.data)).blob(), form=new FormData();
        const options=await settings(),target=options.target,context=await nameContext(sender.tab?.url||'',target),dictionary=MangaNames.dictionary(context.work);
        form.append('contextFonts',String(target==='Korean'&&!options.lightweightDisplay));form.append('image',blob,'page.png');form.append('target',target);form.append('pageURL',(sender.tab?.url||'').slice(0,8192));form.append('title',(sender.tab?.title||'').slice(0,1024));if(typeof msg.sourceURL==='string'&&msg.sourceURL.length<=8192)form.append('sourceURL',msg.sourceURL);if(Number.isInteger(msg.page)&&msg.page>0)form.append('page',String(msg.page));
        if(msg.type==='createDraft')form.append('draft','true');
        if(dictionary?.entries.length)form.append('dictionary',JSON.stringify(dictionary));
        return (await api('/api/jobs',{method:'POST',body:form})).json();
      }
      case 'status':return (await api(`/api/jobs/${msg.id}`)).json();
      case 'bubbles':try{return await(await MangaLibrary.request('/bubbles/'+msg.id)).json();}catch{return (await api(`/api/jobs/${msg.id}/bubbles`,{method:'POST'})).json();}
      case 'recognizeRegion':{
        if(!/^[0-9a-f-]+$/.test(msg.id))throw Error('잘못된 작업 ID입니다.');
        const saved=await MangaEditorSessions.load(msg.id,sender);
        const payload={box:msg.box,rotation:msg.rotation,type:msg.regionType};
        let pageURL=saved.pageURL;
        if(!pageURL)try{pageURL=(await chrome.tabs.get(saved.tabId)).url;}catch{}
        if(pageURL){const context=await nameContext(pageURL,saved.result?.target||'Korean');payload.dictionary=MangaNames.dictionary(context.work);}
        return (await api(`/api/jobs/${msg.id}/recognize-region`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),timeout:240000})).json();
      }
      case 'manualRestoration':return (await api(`/api/jobs/${msg.id}/restoration/manual`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(msg.mask),timeout:240000})).json();
      case 'restoration':try{return await(await MangaLibrary.request('/assets/'+msg.id+'/restoration-v1.json')).json();}catch{return (await api(`/api/jobs/${msg.id}/restoration`,{method:'POST',timeout:240000})).json();}
      case 'font':{
        if(!Object.hasOwn(MangaFonts.catalog,msg.id))throw Error('Invalid font');
        const response=await fetch(chrome.runtime.getURL('fonts/'+msg.id+'.woff'));if(!response.ok)throw Error('Font unavailable');return encoded(await response.blob());
      }
      case 'asset':{
        if(!['original.png','cleaned.png','mask.png','result.json','restored-v1.png'].includes(msg.name)&&!/^manual-[0-9a-f]{32}\.png$/.test(msg.name))throw Error('Invalid asset');
        let response;try{response=await MangaLibrary.request('/assets/'+msg.id+'/'+msg.name);}catch{response=await api(`/api/jobs/${msg.id}/${msg.name}`);}return encoded(await response.blob());
      }
      case 'edit':return MangaEditorSessions.open(msg,sender);
      case 'loadEdit':return MangaEditorSessions.load(msg.id,sender);
      case 'apply':{
        const saved=await MangaEditorSessions.route(msg.id,sender);
        if(!Number.isInteger(saved.tabId)||!saved.key)throw Error('원본 만화 탭에서 편집을 다시 열어주세요.');
        let applied;try{applied=await chrome.tabs.sendMessage(saved.tabId,{type:'applyEdited',id:msg.id,key:saved.key,result:msg.result});}catch{throw Error('원본 만화 탭에 연결하지 못했습니다. 편집 내용은 현재 창에 남아 있습니다. 원본 탭을 확인하세요.');}
        if(applied?.error)throw Error(applied.error);
        return applied?.result?applied:{result:msg.previewResult||msg.result,baseResult:msg.result};
      }
    }
    throw Error('Unknown request');
  })().then(value=>respond({ok:true,value}),error=>respond({ok:false,error:String(error.message||error)}));
  return true;
});
// Only the configured management origin may request pairing. The access token stays in the
// extension; it is never returned to the management page.
chrome.runtime.onMessageExternal.addListener((msg,sender,respond)=>{
 let origin;try{origin=new URL(sender.url).origin;}catch{return false;}
 (async()=>{
  if(!MangaServers.allowed(origin,await settings())){
   if(msg.type==='control-status')return {installed:true,connected:false,configurationRequired:true};
   if(msg.type!=='control-pair'||typeof msg.code!=='string'||!/^[a-f0-9]{64}$/.test(msg.code))throw Error('설정에 등록되지 않은 관리 서버입니다.');
   if(!['http:','https:'].includes(new URL(origin).protocol))throw Error('잘못된 관리 서버 주소');
   const old=(await chrome.storage.session.get('pendingServerConnection')).pendingServerConnection;
   if(old&&Date.now()-old.created<10000)throw Error('열린 확장 연결 화면에서 확인하세요.');
   const nonce=crypto.randomUUID();await chrome.storage.session.set({pendingServerConnection:{nonce,origin,code:msg.code,created:Date.now()}});
   await chrome.tabs.create({url:chrome.runtime.getURL('connect.html')+'?request='+encodeURIComponent(nonce)});
   return {installed:true,connected:false,pending:true};
  }
  if(msg.type==='control-read'){
   const u=new URL(msg.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('잘못된 회차 주소');
   const tab=await chrome.tabs.create({url:'about:blank'});await chrome.storage.session.set({['libraryTarget:'+tab.id]:{url:MangaReaders.pageIdentity(u.href),target:msg.target}});await chrome.tabs.update(tab.id,{url:u.href});return true;
  }
  if(msg.type==='control-cache-stats')return MangaJobCache.stats();
  if(msg.type==='control-cache-prune'){
   const task=cacheWrites.catch(()=>{}).then(async()=>{if(msg.all){const stored=await MangaJobCache.pages();for(const value of Object.values(stored))for(const item of value.items||[])discardedJobs.add(item.id);for(const key of await MangaJobCache.keys())if(key.startsWith('edit:'))discardedJobs.add(key.slice(5));}else for(const id of msg.ids||[])discardedJobs.add(id);while(discardedJobs.size>10000)discardedJobs.delete(discardedJobs.values().next().value);return MangaJobCache.prune(msg.ids,!!msg.all);});cacheWrites=task;const result=await task;
   for(const tab of await chrome.tabs.query({}))chrome.tabs.sendMessage(tab.id,{type:'jobsRemoved',ids:msg.ids||[],all:!!msg.all}).catch(()=>{});
   return result;
  }
  if(msg.type==='control-pair'){
   if(typeof msg.code!=='string'||!/^[a-f0-9]{64}$/.test(msg.code))throw Error('연결 코드가 올바르지 않습니다.');
   const response=await fetch(origin+'/api/extension/pair',{method:'POST',headers:{'Content-Type':'application/json','X-Manga-Extension':chrome.runtime.id},body:JSON.stringify({code:msg.code}),signal:AbortSignal.timeout(10000)});
   const data=await response.json();if(!response.ok)throw Error(data.error||'관리 앱에 연결하지 못했습니다.');
   if(MangaServers.origin(data.managementServer||origin)!==origin||!MangaServers.sameOrigin(MangaServers.origin(data.server),MangaServers.origin((await settings()).server))||typeof data.token!=='string'||data.token.length<32)throw Error('관리 앱의 연결 정보가 올바르지 않습니다.');
   await chrome.storage.local.set({server:data.server,managementServer:origin,token:data.token});
  }else if(msg.type!=='control-status')throw Error('지원하지 않는 관리 요청입니다.');
  const s=await settings();let connected=false,error='';
  try{if(!MangaServers.allowed(origin,s))throw Error('다른 관리 서버에 연결되어 있습니다.');if(!s.token)throw Error('API 연결 설정이 필요합니다.');await api('/api/ping');connected=true;}catch(e){error=e.message;}
  return {installed:true,version:chrome.runtime.getManifest().version,server:s.server,connected,error};
 })().then(value=>respond({ok:true,value}),e=>respond({ok:false,error:e.message}));
 return true;
});

// Reapply stored results on completed navigation; no panel is opened automatically.
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{
 if(change.status!=='complete'||!/^https?:/.test(tab.url||'')||/^http:\/\/(localhost|127\.0\.0\.1):8794/.test(tab.url||''))return;
 (async()=>{if(MangaServers.allowed(tab.url,await settings()))return;if(!await MangaLibrary.known(tab.url,tabId))return;const saved=await MangaLibrary.restore(tab.url,tabId);if(!saved.length)return;const current=await chrome.tabs.get(tabId);if(current.url!==tab.url)return;
 await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},files:['polygon.js','fonts.js','rotation.js','render.js','readers.js','names.js','content.js']});
 await chrome.tabs.sendMessage(tabId,{type:'control',action:'scan'});
 })().catch(error=>console.debug('저장 번역 불러오기:',error.message));
});
chrome.tabs.onRemoved.addListener(tabId=>chrome.storage.session.remove('libraryTarget:'+tabId));
