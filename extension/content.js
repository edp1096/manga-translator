(() => {
if(globalThis.__mangaTranslator)return;globalThis.__mangaTranslator=true;
const rpc=async msg=>{const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'확장 연결이 끊어졌습니다. 새로고침하세요.');return r.value;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pageIdentity=()=>{if(globalThis.MangaReaders)return MangaReaders.pageIdentity(location.href);const u=new URL(location.href);u.hash='';return u.href;};
const captureReader=async()=>{if((await rpc({type:'settings'})).captureFallback===false)throw Error('이 뷰어는 확장 설정의 화면 캡처 허용이 필요합니다.');return rpc({type:'capture'});};
let reader=globalThis.MangaReaders?.create({capture:captureReader,onWait:text=>status(text),cancelled:()=>running&&stopped})||null;
let pageCache=null,exportPosition=null;
const overlayInstance=crypto.randomUUID();
let entries=[],running=false,stopped=false,showOriginal=false,message='이미지를 탐지하세요.',scannedURL=pageIdentity();
const status=t=>message=t;
const updateRow=()=>{};
function urlOf(img){return img.currentSrc||img.getAttribute('data-src')||img.getAttribute('data-original')||img.src;}
function snapshot(){return {message,running,pageURL:location.href,reader:reader?.name,items:entries.map(e=>({key:e.key,index:e.index,state:e.state,done:!!e.result,error:e.error,preview:e.readerPage?(e.readerPreview||MangaReaders.placeholder(e.index)):(e.sourceURL||urlOf(e.img)),title:e.title||e.img?.alt||`이미지 ${e.index+1}`,width:e.readerWidth||e.img?.naturalWidth||e.img?.width||0,height:e.readerHeight||e.img?.naturalHeight||e.img?.height||0}))};}
function readerScan(options={}){
 const previous=new Map(entries.map(e=>[e.sourceURL,e]));
 const next=reader.pages().map(page=>{
  let e=previous.get(page.sourceURL);
  if(!e){const saved=pageCache.find(x=>x.sourceURL===page.sourceURL);e={key:saved?.key||crypto.randomUUID(),state:'대기'};if(saved){e.job=saved.id;e.result=saved.result;e.cachedRestore=saved;e.state='이전 결과 불러오는 중';}}
  Object.assign(e,{readerPage:page,index:page.index,sourceURL:page.sourceURL,title:`${reader.name} · ${page.index+1}페이지`,readerWidth:page.width||e.readerWidth,readerHeight:page.height||e.readerHeight});
  const node=reader.element(page);if(e.img!==node&&e.resizeObserver){e.resizeObserver.disconnect();if(node)e.resizeObserver.observe(node);}e.img=node;return e;
 });
 for(const e of entries)if(!next.includes(e)){e.overlay?.remove();e.resizeObserver?.disconnect();}
 entries=next;for(const e of entries){place(e);if(e.cachedRestore&&!e.restoring&&Date.now()>=(e.restoreRetryAt||0))restoreEntry(e);}
 if(!options.passive)status(`${reader.name} · 본문 ${entries.length}장 · 새로고침으로 페이지를 불러옵니다.`);return snapshot();
}

async function scan(options={}){
 if(running&&!options.loading)return snapshot();
 const samePage=scannedURL===pageIdentity();scannedURL=pageIdentity();if(!samePage){pageCache=null;for(const e of entries){e.overlay?.remove();e.resizeObserver?.disconnect();}entries=[];reader=globalThis.MangaReaders?.create({capture:captureReader,onWait:text=>status(text),cancelled:()=>running&&stopped})||null;}
 const settings=options.settings||await rpc({type:'settings'});
 if(pageCache===null){const saved=await rpc({type:'restore'}).catch(()=>[]);pageCache=Array.isArray(saved)?saved:[];}
 if(reader)return readerScan(options);
 let imgs;
 try{imgs=[...document.querySelectorAll(settings.selector||'img')].filter(i=>i instanceof HTMLImageElement);}catch{throw Error('CSS 선택자가 올바르지 않습니다.');}
 imgs=imgs.filter(i=>settings.selector||/^(page\s*\d+|.*chapter.*image\s*\d+)/i.test(i.alt)||(i.getBoundingClientRect().width>=350&&i.getBoundingClientRect().height>=180));
 if(pageCache===null){const saved=await rpc({type:'restore'}).catch(()=>[]);pageCache=Array.isArray(saved)?saved:[];}
 const previous=samePage?entries:[];
 const byNode=new Map(previous.map(e=>[e.img,e]));
 const byURL=new Map();for(const e of previous){const url=e.sourceURL||urlOf(e.img);if(!byURL.has(url))byURL.set(url,[]);byURL.get(url).push(e);}
 const used=new Set();
 const discovered=imgs.map(img=>{
  const url=urlOf(img);let e=byNode.get(img);if(e&&e.sourceURL!==url)e=null;
  if(!e||used.has(e))e=(byURL.get(url)||[]).find(candidate=>!used.has(candidate));
  if(!e){
   const saved=pageCache.find(item=>item.sourceURL===url);
   e={key:saved?.key||crypto.randomUUID(),state:'대기'};
   if([...used].some(other=>other.key===e.key))e.key=crypto.randomUUID();
   if(saved){e.job=saved.id;e.result=saved.result;e.cachedRestore=saved;e.state='이전 결과 불러오는 중';}
  }
  used.add(e);
  if(e.img!==img&&e.resizeObserver){e.resizeObserver.disconnect();e.resizeObserver.observe(img);}
  e.img=img;e.sourceURL=url;e.title=img.alt;return e;
 });
 // Keep entries discovered earlier while scrolling virtualized readers.
 entries=options.append&&samePage?[...previous,...discovered.filter(e=>!previous.includes(e))]:discovered;
 entries.forEach((e,index)=>{e.index=index;place(e);if(e.cachedRestore&&!e.restoring&&Date.now()>=(e.restoreRetryAt||0))restoreEntry(e);});
 status(`${entries.length}장 불러옴 · 번역할 이미지를 선택하세요.`);return snapshot();
}
async function preload(){
 if(reader)return preloadReader();
 if(running)return;running=true;stopped=false;
 const startX=scrollX,initialURL=pageIdentity();
 const scrollStyle=document.documentElement.style.scrollBehavior;document.documentElement.style.scrollBehavior='auto';
 let settings;
 try{
  settings=await rpc({type:'settings'});
  await scan({loading:true,append:true,settings});
  let bottomHits=0;
  for(let i=0;i<200&&!stopped;i++){
   if(pageIdentity()!==initialURL)break;
   status(`이미지 불러오는 중 · ${entries.length}장`);
   const bottom=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)-innerHeight;
   const next=Math.min(bottom,i===0?0:scrollY+Math.max(300,innerHeight*0.85));
   scrollTo({top:next,left:startX,behavior:'instant'});await sleep(300);
   await scan({loading:true,append:true,settings});
   status(`이미지 불러오는 중 · ${entries.length}장`);
   const after=Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)-innerHeight;
   if(scrollY>=after-5){bottomHits++;await sleep(700);if(bottomHits>=2)break;}else bottomHits=0;
  }
 }finally{
  document.documentElement.style.scrollBehavior=scrollStyle;running=false;
  await scan({append:pageIdentity()===initialURL,settings});
 }
}
async function preloadReader(){
 if(running)return;running=true;stopped=false;const active=reader,identity=pageIdentity();let loaded=0,failed=0;
 try{
  await scan({loading:true});
  for(const e of entries){if(stopped||pageIdentity()!==identity)break;status(`${active.name} · ${e.index+1}/${entries.length} 불러오는 중`);
   try{await readImage(e);loaded++;if(!e.result)e.state='대기';}catch(error){if(stopped)break;failed++;if(!e.result)e.state='읽기 실패: '+error.message;if(/활성화|activeTab|all_urls|화면 캡처 허용/.test(error.message))throw error;}
  }
 }finally{
  try{await scan({loading:true,append:true});}finally{running=false;status(`${stopped?'불러오기 중지':'불러오기 완료'} · ${loaded}장 · 읽기 실패 ${failed}장`);}
 }
}
async function restoreEntry(e){
 const saved=e.cachedRestore;e.restoring=true;
 try{
  const [original,cleaned]=await Promise.all(['original.png','cleaned.png'].map(name=>rpc({type:'asset',id:saved.id,name})));
  if(e.job!==saved.id||e.pendingJob||e.result!==saved.result)return;
  Object.assign(e,{original,cleaned});await overlay(e);e.state=e.result.regions.length?'완료 · 이전 결과 복원':'글자 없음 · 원본 유지';
 }catch(error){
  if(e.job===saved.id&&!e.pendingJob&&e.result===saved.result){
   if(/서버 404:/.test(error.message||'')){e.result=null;e.job=null;e.state='지난 결과 만료 · 다시 번역';}
   else{e.state='API 연결 후 결과 복원';e.restoreRetryAt=Date.now()+5000;}
  }
 }finally{if(e.state!=='API 연결 후 결과 복원')e.cachedRestore=null;e.restoring=false;}
}
function remember(e){const saved={sourceURL:e.sourceURL||urlOf(e.img),key:e.key,id:e.job,result:e.result,updated:Date.now()};pageCache=(pageCache||[]).filter(x=>x.sourceURL!==saved.sourceURL);pageCache.push(saved);rpc({type:'remember',...saved}).catch(()=>{});}
let rebindTimer=0,rebindPending=false;
function rebindKnownImages(){
 if(running){rebindPending=true;return;}clearTimeout(rebindTimer);
 rebindTimer=setTimeout(()=>{rebindPending=false;scan({append:true,passive:true}).catch(()=>{});},150);
}
function isKnownImage(img){const url=urlOf(img);return entries.some(e=>!e.readerPage&&e.sourceURL===url)||(pageCache||[]).some(e=>e.sourceURL===url);}
const ownNode=node=>node instanceof Element&&!!node.closest('[data-manga-translator-overlay],[data-manga-capture]');
new MutationObserver(changes=>{
 if(reader){
  const relevant=changes.some(c=>!ownNode(c.target)&&c.target instanceof Element&&(!!c.target.closest('.splide,.js-viewer,#book')||(c.type==='childList'&&[...c.addedNodes].some(n=>n instanceof Element&&!ownNode(n)&&(n.matches('.splide,.js-viewer,#book')||n.querySelector('[data-type=contents] canvas,.js-viewer,#book')))))&&(c.type!=='childList'||[...c.addedNodes,...c.removedNodes].some(n=>!ownNode(n))));
  if(relevant){entries.forEach(place);rebindKnownImages();}return;
 }
 for(const change of changes)for(const node of change.addedNodes){if(!(node instanceof Element)||ownNode(node))continue;const images=node instanceof HTMLImageElement?[node]:[...node.querySelectorAll('img')];if(images.some(isKnownImage)){rebindKnownImages();return;}}
}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['no','src','width','height','class','style','data-will-load']});


async function readImage(e,allowCapture=true){
 if(e.readerPage){const record=await reader.read(e.readerPage);e.readerPreview=record.preview;e.readerWidth=record.width;e.readerHeight=record.height;e.img=reader.element(e.readerPage);return record.data;}
 const img=e.img;
 if(e.sourceURL&&urlOf(img)!==e.sourceURL)return rpc({type:'fetchImage',url:e.sourceURL});
 img.loading='eager';
 if(!img.currentSrc && img.dataset.src)img.src=img.dataset.src;
 if(!img.complete||!img.naturalWidth){await Promise.race([new Promise((resolve,reject)=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',()=>reject(Error('이미지 로드 실패')),{once:true});}),sleep(15000)]);}
 try{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;if(!c.width)throw Error();c.getContext('2d').drawImage(img,0,0);return c.toDataURL('image/png');}catch{}
 try{const response=await fetch(urlOf(img),{credentials:'include',signal:AbortSignal.timeout(15000)});if(response.ok){const blob=await response.blob();if(blob.type.startsWith('image/'))return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob);});}}catch{}
 try{return await rpc({type:'fetchImage',url:urlOf(img)});}catch(error){
  if(!allowCapture||!(await rpc({type:'settings'})).captureFallback)throw error;
  e.state='화면 캡처';updateRow(e);return capture(img);
 }
}
async function capture(img){
 if(!img.naturalWidth)throw Error('아직 표시되지 않은 이미지입니다. 해당 위치까지 스크롤한 뒤 재시도하세요.');
 if(img.naturalHeight/img.naturalWidth>5)throw Error('긴 세로 이미지는 화면 캡처 해상도가 부족합니다. 원본 접근을 허용하거나 분할하세요.');
 // Clone only the already-rendered image, over a neutral background. The
 // original layout and scroll position are never changed by capture.
 const cover=document.createElement('div');cover.style.cssText='position:fixed;inset:0;background:white;z-index:2147483646;display:flex;align-items:center;justify-content:center';
 const clone=img.cloneNode();clone.removeAttribute('id');clone.style.cssText='display:block!important;position:static!important;max-width:100vw!important;max-height:100vh!important;width:auto!important;height:auto!important;object-fit:contain!important;margin:0!important;opacity:1!important;visibility:visible!important';cover.append(clone);document.documentElement.append(cover);
 try{await clone.decode();await sleep(200);const rect=clone.getBoundingClientRect();const shot=await MangaRender.image(await rpc({type:'capture'}));const ratio=shot.width/innerWidth;const c=document.createElement('canvas');c.width=Math.round(rect.width*ratio);c.height=Math.round(rect.height*ratio);c.getContext('2d').drawImage(shot,rect.x*ratio,rect.y*ratio,c.width,c.height,0,0,c.width,c.height);return c.toDataURL('image/png');}
 finally{cover.remove();}
}
function place(e){
 if(!e.overlay)return;
 if(e.readerPage){
  if(reader?.identity!==pageIdentity()){e.overlay.style.display='none';return;}
  const node=reader?.element(e.readerPage);if(e.img!==node){e.resizeObserver?.disconnect();e.img=node;if(node)e.resizeObserver?.observe(node);}
  if(!node?.isConnected){e.overlay.style.display='none';return;}
  const r=node.getBoundingClientRect(),anchor=node.parentElement,ar=anchor.getBoundingClientRect();if(!r.width||!r.height||!ar.width||!ar.height){e.overlay.style.display='none';return;}
  if(getComputedStyle(anchor).position==='static')anchor.style.position='relative';if(e.overlay.parentElement!==anchor)anchor.append(e.overlay);
  const sx=ar.width/(anchor.offsetWidth||ar.width),sy=ar.height/(anchor.offsetHeight||ar.height);
  Object.assign(e.overlay.style,{left:(r.left-ar.left)/sx+'px',top:(r.top-ar.top)/sy+'px',width:r.width/sx+'px',height:r.height/sy+'px',display:showOriginal?'none':'block',pointerEvents:'none'});return;
 }
 const r=e.img.getBoundingClientRect();Object.assign(e.overlay.style,{left:`${r.left+scrollX}px`,top:`${r.top+scrollY}px`,width:`${r.width}px`,height:`${r.height}px`,display:showOriginal||r.width===0||(e.sourceURL&&urlOf(e.img)!==e.sourceURL)?'none':'block'});
}

async function overlay(e){
 const epoch=e.renderEpoch=(e.renderEpoch||0)+1,job=e.job,result=e.result;
 const original=e.original||await rpc({type:'asset',id:job,name:'original.png'});
 const cleaned=e.cleaned||await rpc({type:'asset',id:job,name:'cleaned.png'});
 if(e.renderEpoch!==epoch||e.job!==job||e.result!==result)return;
 const canvas=document.createElement('canvas');await MangaRender.render(canvas,result,original,cleaned);
 if(e.renderEpoch!==epoch||e.job!==job||e.result!==result)return;
 e.original=original;e.cleaned=cleaned;
 if(!e.overlay){e.overlay=document.createElement('div');e.overlay.dataset.mangaTranslatorOverlay=overlayInstance;e.overlay.style.cssText='position:absolute;z-index:999;pointer-events:auto;display:none';e.canvas=document.createElement('canvas');e.canvas.style.cssText='display:block;width:100%;height:100%';e.overlay.append(e.canvas);document.body.append(e.overlay);e.resizeObserver=new ResizeObserver(()=>place(e));if(e.img)e.resizeObserver.observe(e.img);}
 e.overlay.dataset.mangaSource=e.sourceURL||urlOf(e.img);
 e.canvas.width=canvas.width;e.canvas.height=canvas.height;e.canvas.getContext('2d').drawImage(canvas,0,0);
 document.querySelectorAll('[data-manga-translator-overlay]').forEach(node=>{if(node.dataset.mangaTranslatorOverlay!==overlayInstance&&node.dataset.mangaSource===e.overlay.dataset.mangaSource)node.remove();});
 e.overlay.querySelectorAll('[data-tip]').forEach(n=>n.remove());
 const tooltipRegions=e.result.regions.filter(region=>region.mode!=='replace'&&region.translation);
 const tooltipArea=region=>(region.bbox[2]-region.bbox[0])*(region.bbox[3]-region.bbox[1]);
 tooltipRegions.sort((left,right)=>tooltipArea(right)-tooltipArea(left));
 for(const r of tooltipRegions){
  const tip=document.createElement('span');tip.dataset.tip='1';const [x1,y1,x2,y2]=r.bbox;
  tip.style.cssText=`position:absolute;left:${x1/e.result.width*100}%;top:${y1/e.result.height*100}%;width:${(x2-x1)/e.result.width*100}%;height:${(y2-y1)/e.result.height*100}%;border-bottom:1px dotted #078b9f;cursor:help`;
  if(e.readerPage)tip.style.pointerEvents='auto';
  tip.title='원문 보존 · 번역: '+r.translation+'\n원문: '+r.text;e.overlay.append(tip);
 }
 place(e);
}
async function run(keys){
 if(running)return;
 const requested=entries.filter(e=>keys.includes(e.key));
 if(!requested.length){status(keys.length?'선택한 이미지를 찾지 못했습니다. 새로고침을 눌러주세요.':'번역할 이미지를 선택하세요.');return;}
 const paused=globalThis.__mangaPausedBatch;
 const sameBatch=paused&&paused.remaining.length>0&&paused.keys.length===keys.length&&paused.keys.every(key=>keys.includes(key));
 const selected=sameBatch?requested.filter(e=>paused.remaining.includes(e.key)):requested;
 globalThis.__mangaPausedBatch=null;running=true;stopped=false;const batchIdentity=pageIdentity();
 const completed=new Set();let done=0,failed=0;
 try{
  for(const e of selected){
   if(stopped||pageIdentity()!==batchIdentity){stopped=true;break;}
   try{
    e.error=null;e.state=e.result?'재번역 준비':'이미지 읽기';status(`${e.index+1}번 ${e.state}`);
    // Keep the last successful image/result while a replacement is processing.
    // A completed job is never mistaken for an in-flight job to resume.
    if(!e.pendingJob&&!e.result&&e.job)e.pendingJob=e.job;
    if(!e.pendingJob)e.pendingJob=(await rpc({type:'submit',data:await readImage(e)})).id;
    const start=Date.now();
    for(;;){
     if(stopped||pageIdentity()!==batchIdentity){stopped=true;break;}
     const response=await rpc({type:'status',id:e.pendingJob});
     if(response.status==='error'){e.pendingJob=null;if(!e.result)e.job=null;throw Error(response.error);}
     if(response.status==='done'){
      const [original,cleaned]=await Promise.all(['original.png','cleaned.png'].map(name=>rpc({type:'asset',id:e.pendingJob,name})));
      const prior={job:e.job,result:e.result,original:e.original,cleaned:e.cleaned};
      Object.assign(e,{job:e.pendingJob,result:response.result,original,cleaned});
      try{await overlay(e);}catch(error){
       Object.assign(e,prior);
       if(e.result){try{await overlay(e);}catch{}}
       else{e.overlay?.remove();e.overlay=null;e.canvas=null;e.resizeObserver?.disconnect();}
       throw error;
      }
      e.pendingJob=null;remember(e);e.state=e.result.regions.length?'완료':'글자 없음 · 원본 유지';done++;completed.add(e.key);break;
     }
     const phases={queued:'대기열',loading_models:'모델 준비',detecting:'영역 탐지',detecting_dark_text:'검은 배경 글자 탐지',ocr:'글자 인식',translating:'번역'};
     e.state=phases[response.status]||response.status;status(`${done}/${selected.length} 완료 · ${e.index+1}번 ${e.state}`);
     if(Date.now()-start>900000)throw Error('처리 대기 시간 초과. 다시 실행하면 기존 작업을 확인합니다.');
     await sleep(1500);
    }
   }catch(error){if(stopped)break;e.error=error.message;e.state='실패: '+error.message;failed++;}
  }
  if(stopped)globalThis.__mangaPausedBatch={keys:[...keys],remaining:selected.filter(e=>!completed.has(e.key)).map(e=>e.key)};
  status(`${stopped?'중지됨':'처리 종료'} · ${done}장 완료 · ${failed}장 실패`);
 }finally{running=false;if(rebindPending)rebindKnownImages();}
}
new ResizeObserver(()=>entries.forEach(place)).observe(document.body);
document.addEventListener('load',ev=>{if(ev.target instanceof HTMLImageElement){entries.forEach(place);if(isKnownImage(ev.target)&&!entries.some(e=>e.img===ev.target&&e.sourceURL===urlOf(ev.target)))rebindKnownImages();}},true);
document.addEventListener('scroll',()=>{if(reader)entries.forEach(place);},{passive:true,capture:true});
addEventListener('resize',()=>entries.forEach(place));addEventListener('scroll',()=>entries.forEach(place),{passive:true});
chrome.runtime.onMessage.addListener((m,s,reply)=>{
 if(m.type==='control'){
  (async()=>{
   if(pageIdentity()!==scannedURL&&!running)await scan();
   if(m.action==='scan'||(m.action==='status'&&!running&&!entries.length))await scan();
   if(m.action==='status'&&!running)for(const e of entries)if(e.cachedRestore&&!e.restoring&&Date.now()>=(e.restoreRetryAt||0))restoreEntry(e);
   if(m.action==='preload')preload().catch(e=>status(e.message));
   if(m.action==='run')run(m.keys||[]).catch(e=>status(e.message));
   if(m.action==='stop'){stopped=true;status('중지 요청됨 · 현재 서버 작업은 보존합니다.');}
   if(m.action==='toggle'){showOriginal=!showOriginal;entries.forEach(place);}
   if(m.action==='locate'){
    const e=entries.find(e=>e.key===m.key)||entries.find(e=>!e.readerPage&&m.sourceURL&&urlOf(e.img)===m.sourceURL);
    if(!e)throw Error('해당 이미지를 찾지 못했습니다. 새로고침을 눌러주세요.');
    if(e.readerPage){await reader.locate(e.readerPage);place(e);status(`${e.index+1}번 페이지로 이동했습니다.`);return snapshot();}
    if(!e.img.isConnected){const replacement=[...document.images].find(img=>urlOf(img)===urlOf(e.img));if(!replacement)throw Error('페이지에서 이미지가 변경되었습니다. 새로고침을 눌러주세요.');e.img=replacement;}
    e.img.loading='eager';const margin=e.img.style.scrollMarginTop;e.img.style.scrollMarginTop='80px';
    e.img.scrollIntoView({block:'start',behavior:'instant'});requestAnimationFrame(()=>{e.img.style.scrollMarginTop=margin;place(e);});
    const el=showOriginal?e.img:(e.overlay||e.img);const old=el.style.outline;el.style.outline='5px solid #f08a24';setTimeout(()=>el.style.outline=old,2200);
    status(`${e.index+1}번 이미지로 이동했습니다.`);
   }
   if(m.action==='exportStart'){if(running)throw Error('작업이 끝난 뒤 저장하세요.');exportPosition=reader?{reader,position:reader.position(),identity:pageIdentity()}:null;return snapshot();}
   if(m.action==='exportEnd'){const saved=exportPosition;exportPosition=null;if(saved&&saved.identity===pageIdentity())await saved.reader.restore(saved.position);return snapshot();}
   if(m.action==='export'){
    if(running)throw Error('작업이 끝난 뒤 저장하세요.');
    const e=entries.find(e=>e.key===m.key);if(!e)throw Error('목록의 이미지를 찾지 못했습니다.');
    const original=e.original||await readImage(e,false);let data=original,kind='original',warning='';
    if(!e.error&&e.result?.regions.length){try{
     const cleaned=e.cleaned||await rpc({type:'asset',id:e.job,name:'cleaned.png'});
     const canvas=document.createElement('canvas');await MangaRender.render(canvas,e.result,original,cleaned);data=canvas.toDataURL('image/png');kind='translated';
    }catch(error){warning='번역 이미지 렌더링 실패 · 원본 저장: '+error.message;}}
    return {data,kind,warning,state:e.state};
   }
   if(m.action==='edit'){const e=entries.find(e=>e.key===m.key);if(e?.result)await rpc({type:'edit',id:e.job,key:e.key,result:e.result});}
   return snapshot();
  })().then(reply,e=>reply({error:e.message}));return true;
 }
 if(m.type==='applyEdited'){const e=entries.find(e=>e.key===m.key);if(e){e.result=m.result;overlay(e).then(()=>{remember(e);reply(true);}).catch(err=>reply({error:err.message}));}else reply({error:'페이지를 다시 열어 원본 이미지 연결이 끊어졌습니다.'});return true;}
});
})();
