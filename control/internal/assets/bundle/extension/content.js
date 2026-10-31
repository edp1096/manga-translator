(() => {
if(globalThis.__mangaTranslator)return;globalThis.__mangaTranslator=true;
const rpc=async msg=>{const r=await chrome.runtime.sendMessage(msg);if(!r?.ok)throw Error(r?.error||'확장 연결이 끊어졌습니다. 새로고침하세요.');return r.value;};
MangaRender.setAssetLoader((id,name)=>rpc({type:'asset',id,name}));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pageIdentity=()=>{if(globalThis.MangaReaders)return MangaReaders.pageIdentity(location.href);const u=new URL(location.href);u.hash='';return u.href;};
const captureReader=async()=>{if((await rpc({type:'settings'})).captureFallback===false)throw Error('이 뷰어는 확장 설정의 화면 캡처 허용이 필요합니다.');return rpc({type:'capture'});};
let reader=globalThis.MangaReaders?.create({fetchImage:url=>rpc({type:'fetchImage',url}),metadata:()=>rpc({type:'readerMetadata'}),capture:captureReader,onWait:text=>status(text),cancelled:()=>running&&stopped})||null;
let pageCache=null,exportPosition=null;
const overlayInstance=crypto.randomUUID();
let tooltipClipSequence=0;
let entries=[],running=false,stopped=false,showOriginal=false,message='이미지를 탐지하세요.',scannedURL=pageIdentity();
let displayMode='auto',outsideTextMode='tooltip',displayRevision=0,displayBusy=false,displayMessage='',displayPaused=false,displayTask=null,displayTimer=0,exporting=false,pendingDisplayMode;
let nameMessage='',nameBusy=false;
function presentation(entry){
 const restoration=entry.restored?entry.restoration:undefined;
 if(entry.presentationBase!==entry.result||entry.presentationGeometry!==entry.bubbles||entry.presentationMode!==displayMode||entry.presentationOutsideMode!==outsideTextMode||entry.presentationRestoration!==restoration){
  entry.presentation=MangaRender.presentation(entry.result,displayMode,entry.bubbles,outsideTextMode,restoration);entry.presentationRestoration=restoration;
  entry.presentationBase=entry.result;entry.presentationGeometry=entry.bubbles;entry.presentationMode=displayMode;entry.presentationOutsideMode=outsideTextMode;
 }
 return entry.presentation;
}
function setDisplayMode(mode,retry=false){setDisplayModes(mode,outsideTextMode,retry);}
function setDisplayModes(mode,outside,retry=false){
 mode=mode==='white'?'white':'auto';outside=['white','restore'].includes(outside)?outside:'tooltip';
 if(exporting){pendingDisplayMode={mode,outside};return;}
 if(mode===displayMode&&outside===outsideTextMode&&!retry)return;
 displayMode=mode;outsideTextMode=outside;displayRevision++;displayPaused=false;displayMessage='';clearTimeout(displayTimer);
 const paused=globalThis.__mangaPausedBatch;
 if(!running&&paused?.phase==='display'&&(retry||paused.reason==='display-error')){run(paused.keys).catch(error=>status(error.message));return;}
 if(!running&&paused?.phase==='display')displayPaused=true;
 for(const entry of entries)if(entry.result&&entry.original&&entry.cleaned&&!entry.restoring&&!entry.pendingJob)overlay(entry).catch(()=>{});
 queueDisplay();
}
const needsDisplay=entry=>entry.result&&entry.original&&entry.cleaned&&!entry.restoring&&!entry.cachedRestore&&!entry.pendingJob&&(entry.displayRevision!==displayRevision||entry.displayResult!==entry.result);
const needsGeometry=result=>displayMode==='white'&&result.regions.some(MangaRender.whiteCandidate)||outsideTextMode!=='tooltip'&&result.regions.some(MangaRender.outsideCandidate);
const restorationReady=entry=>outsideTextMode!=='restore'||!entry.result.regions.some(MangaRender.outsideCandidate)||!!entry.restored&&entry.restoration?.version===1;
const geometryReady=entry=>entry.bubbles&&(entry.bubbles.version>=3||entry.geometryChecked===entry.job);
async function applyEntryDisplay(entry,active=()=>true,progress=()=>{}){
 const revision=displayRevision,job=entry.job,result=entry.result;
 const current=()=>active()&&!displayPaused&&entries.includes(entry)&&entry.job===job&&entry.result===result&&revision===displayRevision&&pageIdentity()===scannedURL;
 const stage=text=>{displayMessage=`${text} · ${entry.index+1}/${entries.length}장`;progress(text);};
 if(!current())return false;
 try{
 if(needsGeometry(result)&&!geometryReady(entry)){
  stage('말풍선 경계 분석');const geometry=await rpc({type:'bubbles',id:job});
  if(!current())return false;
  if(geometry?.width!==result.width||geometry?.height!==result.height||!Array.isArray(geometry?.bubbles))throw Error('말풍선 경계 응답이 올바르지 않습니다.');
  entry.bubbles=geometry;entry.geometryChecked=job;remember(entry);
 }
 if(!restorationReady(entry)){
  stage('이미지 복원');const restoration=await rpc({type:'restoration',id:job});if(!current())return false;
  if(restoration?.version!==1||restoration.width!==result.width||restoration.height!==result.height||!Array.isArray(restoration.regions)||restoration.asset!=='restored-v1.png')throw Error('복원 응답이 올바르지 않습니다.');
  const restored=await rpc({type:'asset',id:job,name:restoration.asset});if(!current())return false;
  entry.restoration=restoration;entry.restored=restored;
 }
 if(!current())return false;
 stage('최종 표시 적용');await overlay(entry);if(!current())return false;
 entry.displayRevision=revision;entry.displayResult=result;
 if(entry.completionState){entry.state=entry.completionState;delete entry.completionState;}
 return true;
 }catch(error){if(!current())return false;throw error;}
}
function displaySummary(){
 const count=entries.reduce((sum,entry)=>sum+(entry.presentation?.regions.filter(region=>outsideTextMode==='restore'?region.automaticRestoration:region.automaticOutside).length||0),0);
 return (displayMode==='white'?'말풍선 흰 배경':'말풍선 기본 표시')+' · '+(outsideTextMode==='white'?`바깥 글자 흰 배경 ${count}곳`:outsideTextMode==='restore'?`대사·독백 이미지 복원 ${count}곳 · 나머지 툴팁`:'바깥 글자 툴팁')+' · 개별 편집 유지';
}
function queueDisplay(){
 if(displayTask||displayPaused||running||exporting||pageIdentity()!==scannedURL||!entries.some(needsDisplay))return;
 displayTask=Promise.resolve().then(async()=>{
  for(const entry of entries){
   if(displayPaused||running||exporting||pageIdentity()!==scannedURL)break;
   if(!needsDisplay(entry))continue;
   const revision=displayRevision,job=entry.job,result=entry.result;
   displayBusy=true;
   try{if(!await applyEntryDisplay(entry))break;}
   catch(error){
    if(displayPaused||entry.job!==job||entry.result!==result||revision!==displayRevision||pageIdentity()!==scannedURL)break;
    displayPaused=true;
    displayMessage=/서버 409:/.test(error.message)?'서버 작업이 끝나면 표시 적용을 계속합니다.':'표시 적용 대기 · '+error.message+' · 다시 적용을 누르세요.';
    if(/서버 409:/.test(error.message))displayTimer=setTimeout(()=>{displayPaused=false;queueDisplay();},5000);
    break;
   }
  }
  if(!displayPaused)displayMessage=displaySummary();
 }).catch(error=>{displayPaused=true;displayMessage='표시 적용 대기 · '+error.message;}).finally(()=>{
  displayBusy=false;displayTask=null;
  if(!displayPaused&&!running&&!exporting&&entries.some(needsDisplay))queueDisplay();
 });
}
chrome.storage?.onChanged?.addListener((changes,area)=>{if(area!=='local')return;if(changes.displayMode||changes.outsideTextMode)setDisplayModes(changes.displayMode?changes.displayMode.newValue:(pendingDisplayMode?.mode||displayMode),changes.outsideTextMode?changes.outsideTextMode.newValue:(pendingDisplayMode?.outside||outsideTextMode));if(changes.nameWorks||changes.target)nameMessage='';});
const status=t=>message=t;
const updateRow=()=>{};
function urlOf(img){return img.currentSrc||img.getAttribute('data-src')||img.getAttribute('data-original')||img.src;}
function snapshot(){return {message,running,nameMessage,nameBusy,displayMode,outsideTextMode,displayBusy:displayBusy||!!displayTask,displayMessage,displayPaused,pageURL:location.href,reader:reader?.name,items:entries.map(e=>({key:e.key,index:e.index,state:e.state,done:!!e.result,error:e.error,preview:e.readerPage?(e.readerPreview||MangaReaders.placeholder(e.index)):(e.sourceURL||urlOf(e.img)),title:e.title||e.img?.alt||`이미지 ${e.index+1}`,width:e.readerWidth||e.img?.naturalWidth||e.img?.width||0,height:e.readerHeight||e.img?.naturalHeight||e.img?.height||0}))};}
function readerScan(options={}){
 const previous=new Map(entries.map(e=>[e.sourceURL,e]));
 const next=reader.pages().map(page=>{
  let e=previous.get(page.sourceURL);
  if(!e){const saved=pageCache.find(x=>x.sourceURL===page.sourceURL);e={key:saved?.key||crypto.randomUUID(),state:'대기'};if(saved){e.job=saved.id;e.result=saved.result;e.bubbles=saved.bubbles;e.cachedRestore=saved;e.state='이전 결과 불러오는 중';}}
  Object.assign(e,{readerPage:page,index:page.index,sourceURL:page.sourceURL,title:`${reader.name} · ${page.index+1}페이지`,readerWidth:page.width||e.readerWidth,readerHeight:page.height||e.readerHeight});
  const node=reader.element(page);if(e.img!==node&&e.resizeObserver){e.resizeObserver.disconnect();if(node)e.resizeObserver.observe(node);}e.img=node;return e;
 });
 for(const e of entries)if(!next.includes(e)){e.overlay?.remove();e.resizeObserver?.disconnect();}
 entries=next;for(const e of entries){place(e);if(e.cachedRestore&&!e.restoring&&Date.now()>=(e.restoreRetryAt||0))restoreEntry(e);}
 queueDisplay();if(!options.passive)status(`${reader.name} · 본문 ${entries.length}장 · 새로고침으로 페이지를 불러옵니다.`);return snapshot();
}

async function scan(options={}){
 if(running&&!options.loading)return snapshot();
 const samePage=scannedURL===pageIdentity();scannedURL=pageIdentity();if(!samePage){pageCache=null;for(const e of entries){e.overlay?.remove();e.resizeObserver?.disconnect();}entries=[];reader=globalThis.MangaReaders?.create({fetchImage:url=>rpc({type:'fetchImage',url}),metadata:()=>rpc({type:'readerMetadata'}),capture:captureReader,onWait:text=>status(text),cancelled:()=>running&&stopped})||null;}
 const settings=options.settings||await rpc({type:'settings'});
 setDisplayModes(settings.displayMode,settings.outsideTextMode);
 if(pageCache===null){const saved=await rpc({type:'restore'}).catch(()=>[]);pageCache=Array.isArray(saved)?saved:[];}
 if(reader){const active=reader;await active.prepare?.();if(reader!==active||active.identity!==pageIdentity())return snapshot();return readerScan(options);}
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
   if(saved){e.job=saved.id;e.result=saved.result;e.bubbles=saved.bubbles;e.cachedRestore=saved;e.state='이전 결과 불러오는 중';}
  }
  used.add(e);
  if(e.img!==img&&e.resizeObserver){e.resizeObserver.disconnect();e.resizeObserver.observe(img);}
  e.img=img;e.sourceURL=url;e.title=img.alt;return e;
 });
 // Keep entries discovered earlier while scrolling virtualized readers.
 entries=options.append&&samePage?[...previous,...discovered.filter(e=>!previous.includes(e))]:discovered;
 if(entries.every(entry=>entry.img?.isConnected))entries.sort((first,second)=>{const position=first.img.compareDocumentPosition(second.img);return position&Node.DOCUMENT_POSITION_FOLLOWING?-1:position&Node.DOCUMENT_POSITION_PRECEDING?1:0;});
 entries.forEach((e,index)=>{e.index=index;place(e);if(e.cachedRestore&&!e.restoring&&Date.now()>=(e.restoreRetryAt||0))restoreEntry(e);});
 queueDisplay();status(`${entries.length}장 불러옴 · 번역할 이미지를 선택하세요.`);return snapshot();
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
// Cached pages used to restore simultaneously, delivering all layout/image
// work in one burst. Serialize them and let input/paint run between pages.
let cachedRestoreQueue=Promise.resolve();
function restoreEntry(e){
 if(e.restoring)return;
 const saved=e.cachedRestore;e.restoring=true;
 const task=cachedRestoreQueue.then(async()=>{
  await sleep(0);
  if(!entries.includes(e)||e.cachedRestore!==saved||e.pendingJob){e.restoring=false;return;}
  await restoreEntryNow(e,saved);
 });
 cachedRestoreQueue=task.catch(()=>{e.restoring=false;});
 return task;
}
async function restoreEntryNow(e,saved){
 try{
  const [original,cleaned]=await Promise.all(['original.png','cleaned.png'].map(name=>rpc({type:'asset',id:saved.id,name})));
  if(e.job!==saved.id||e.pendingJob||e.result!==saved.result)return;
  Object.assign(e,{original,cleaned});await overlay(e);e.completionState=e.result.nameWarnings?.length?'명칭 확인 필요 · 이전 결과 복원':e.result.regions.length?'완료 · 이전 결과 복원':'글자 없음 · 원본 유지';e.state=e.displayRevision===displayRevision&&e.displayResult===e.result?e.completionState:'이전 결과 표시 준비';if(e.state===e.completionState)delete e.completionState;
 }catch(error){
  if(e.job===saved.id&&!e.pendingJob&&e.result===saved.result){
   if(/서버 404:/.test(error.message||'')){e.result=null;e.job=null;e.state='지난 결과 만료 · 다시 번역';}
   else{e.state='API 연결 후 결과 복원';e.restoreRetryAt=Date.now()+5000;}
  }
 }finally{if(e.state!=='API 연결 후 결과 복원')e.cachedRestore=null;e.restoring=false;queueDisplay();}
}
function remember(e){const saved={sourceURL:e.sourceURL||urlOf(e.img),key:e.key,id:e.job,result:e.result,...(e.bubbles?{bubbles:e.bubbles}:{}),updated:Date.now()};pageCache=(pageCache||[]).filter(x=>x.sourceURL!==saved.sourceURL);pageCache.push(saved);rpc({type:'remember',...saved}).catch(()=>{});}
let rebindTimer=0,rebindPending=false;
function rebindKnownImages(){
 if(running){rebindPending=true;return;}clearTimeout(rebindTimer);
 rebindTimer=setTimeout(()=>{rebindPending=false;scan({append:true,passive:true}).catch(()=>{});},150);
}
function isKnownImage(img){const url=urlOf(img);return entries.some(e=>!e.readerPage&&e.sourceURL===url)||(pageCache||[]).some(e=>e.sourceURL===url);}
const ownNode=node=>node instanceof Element&&!!node.closest('[data-manga-translator-overlay],[data-manga-capture]');
new MutationObserver(changes=>{
 if(reader){
  const relevant=changes.some(c=>!ownNode(c.target)&&c.target instanceof Element&&(!!c.target.closest('.splide,.js-viewer,#book,#viewerContainer,.gtm-expand-full-size-illust,input.gtm-manga-viewer-change-page')||(c.type==='childList'&&[...c.addedNodes].some(n=>n instanceof Element&&!ownNode(n)&&(n.matches('.splide,.js-viewer,#book,#viewerContainer,.gtm-expand-full-size-illust,input.gtm-manga-viewer-change-page')||n.querySelector('[data-type=contents] canvas,.js-viewer,#book,#viewerContainer,.gtm-expand-full-size-illust,input.gtm-manga-viewer-change-page')))))&&(c.type!=='childList'||[...c.addedNodes,...c.removedNodes].some(n=>!ownNode(n))));
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
 const epoch=e.renderEpoch=(e.renderEpoch||0)+1,job=e.job,result=e.result,shown=presentation(e),revision=displayRevision;
 const original=e.original||await rpc({type:'asset',id:job,name:'original.png'});
 const cleaned=e.cleaned||await rpc({type:'asset',id:job,name:'cleaned.png'});
 if(e.renderEpoch!==epoch||e.job!==job||e.result!==result)return;
 const canvas=document.createElement('canvas');
 try{await MangaRender.render(canvas,shown,original,cleaned,e.restored);
 if(e.renderEpoch!==epoch||e.job!==job||e.result!==result)return;
 e.original=original;e.cleaned=cleaned;
 if(!e.overlay){e.overlay=document.createElement('div');e.overlay.dataset.mangaTranslatorOverlay=overlayInstance;e.overlay.style.cssText='position:absolute;z-index:999;pointer-events:auto;display:none';e.canvas=document.createElement('canvas');e.canvas.style.cssText='display:block;width:100%;height:100%';e.overlay.append(e.canvas);document.body.append(e.overlay);e.resizeObserver=new ResizeObserver(()=>place(e));if(e.img)e.resizeObserver.observe(e.img);}
 e.overlay.dataset.mangaSource=e.sourceURL||urlOf(e.img);
 e.canvas.width=canvas.width;e.canvas.height=canvas.height;e.canvas.getContext('2d',{willReadFrequently:true}).drawImage(canvas,0,0);
 }finally{canvas.width=0;canvas.height=0;}
 document.querySelectorAll('[data-manga-translator-overlay]').forEach(node=>{if(node.dataset.mangaTranslatorOverlay!==overlayInstance&&node.dataset.mangaSource===e.overlay.dataset.mangaSource)node.remove();});
 e.overlay.querySelectorAll('[data-tip],[data-manga-tooltip-geometry]').forEach(n=>n.remove());
 const svgNS='http://www.w3.org/2000/svg',tooltipGeometry=document.createElementNS(svgNS,'svg');
 tooltipGeometry.dataset.mangaTooltipGeometry='';tooltipGeometry.setAttribute('aria-hidden','true');tooltipGeometry.style.cssText='position:absolute;width:0;height:0;pointer-events:none';
 const tooltipRegions=MangaRender.tooltipRegions(shown);
 const tooltipArea=region=>(region.bbox[2]-region.bbox[0])*(region.bbox[3]-region.bbox[1]);
 tooltipRegions.sort((left,right)=>tooltipArea(right)-tooltipArea(left));
 for(const r of tooltipRegions){
  const tip=document.createElement('span');tip.dataset.tip='1';const [x1,y1,x2,y2]=r.bbox;
  tip.style.cssText=`position:absolute;left:${x1/e.result.width*100}%;top:${y1/e.result.height*100}%;width:${(x2-x1)/e.result.width*100}%;height:${(y2-y1)/e.result.height*100}%;border-bottom:1px dotted #078b9f;cursor:help`;
  const contours=MangaRender.tooltipContours(r,shown);
  if(contours!==null){
   const clip=document.createElementNS(svgNS,'clipPath'),path=document.createElementNS(svgNS,'path'),id=`manga-tip-${overlayInstance}-${++tooltipClipSequence}`;
   clip.id=id;clip.setAttribute('clipPathUnits','objectBoundingBox');path.setAttribute('clip-rule','evenodd');
   path.setAttribute('d',contours.filter(c=>c.length).map(c=>'M'+c.map(([x,y])=>`${x} ${y}`).join('L')+'Z').join(''));
   clip.append(path);tooltipGeometry.append(clip);tip.style.clipPath=`url("#${id}")`;
  }
  if(e.readerPage)tip.style.pointerEvents='auto';
  tip.title='원문 보존 · 번역: '+r.translation+'\n원문: '+r.text;e.overlay.append(tip);
 }
 if(tooltipGeometry.childElementCount)e.overlay.append(tooltipGeometry);
 place(e);
 if(revision===displayRevision&&(!needsGeometry(result)||geometryReady(e))&&restorationReady(e)){e.displayRevision=revision;e.displayResult=result;}
}
async function correctNames(undo=false){
 if(running||exporting||displayBusy)return;
 const context=await rpc({type:'namesContext'}),work=context?.work;
 if(running||exporting||displayBusy)return;
 if(!undo&&!work?.entries?.some(entry=>entry.kind!=='honorific'))throw Error('현재 작품의 명칭 사전을 먼저 저장하세요.');
 const selected=entries.filter(entry=>entry.result&&(entry.result.target||'Korean')===(context.target||'Korean')&&!entry.pendingJob&&!entry.restoring&&!entry.cachedRestore);
 const cached=await rpc({type:'namesTargets'}),other=(cached||[]).filter(target=>!(target.pageURL===pageIdentity()&&selected.some(entry=>entry.job===target.id&&entry.sourceURL===target.sourceURL)));
 if(running||exporting||displayBusy)return;
 if(!selected.length&&!other.length)throw Error('이전 번역 결과를 먼저 불러오세요.');
 const identity=pageIdentity();running=true;nameBusy=true;stopped=false;let changed=0,failed=0,done=0,interrupted='';
 try{
  for(const entry of selected){
   if(stopped||pageIdentity()!==identity)break;
   nameMessage=`${undo?'명칭 교정 되돌리는 중':'명칭 통일 중'} · ${++done}/${selected.length+other.length}장`;status(nameMessage);
   const before=entry.result,job=entry.job;
   try{
    const response=undo?MangaNames.undo(before,work?.id):await rpc({type:'namesCorrect',result:before,revision:work.revision});
    if(stopped||pageIdentity()!==identity)break;
    if(entry.result!==before||entry.job!==job){interrupted='작업 중 번역 결과가 바뀌어 새 편집을 유지했습니다.';break;}
    if(!response?.result||response.result.regions.length!==before.regions.length)throw Error('명칭 교정 응답이 올바르지 않습니다.');
    entry.result=response.result;
    try{await overlay(entry);}catch(error){entry.result=before;await overlay(entry).catch(()=>{});throw error;}
    remember(entry);changed+=response.changed||0;failed+=response.warnings?.length||0;
    entry.state=response.warnings?.length?'명칭 확인 필요 · 기존 대사 유지':undo?'명칭 교정 되돌림':'명칭 통일 완료';
   }catch(error){failed++;nameMessage='명칭 교정 대기 · '+error.message;entry.state='명칭 교정 실패 · 기존 결과 유지';if(/서버 409:|사전이 바뀌/.test(error.message)){interrupted=error.message;status(nameMessage);break;}}
  }
  for(const target of other){
   if(stopped||interrupted||pageIdentity()!==identity)break;
   nameMessage=`${undo?'명칭 교정 되돌리는 중':'명칭 통일 중'} · ${++done}/${selected.length+other.length}장 · 저장된 다른 페이지`;status(nameMessage);
   try{const response=undo?MangaNames.undo(target.result,work?.id):await rpc({type:'namesCorrect',result:target.result,revision:work.revision});if(stopped||pageIdentity()!==identity)break;if(await rpc({type:'namesRememberTarget',target,result:response.result})){const visible=entries.find(entry=>entry.job===target.id&&entry.sourceURL===target.sourceURL&&JSON.stringify(entry.result)===JSON.stringify(target.result));if(visible){const before=visible.result;visible.result=response.result;try{await overlay(visible);}catch(error){visible.result=before;await overlay(visible).catch(()=>{});throw error;}}changed+=response.changed||0;failed+=response.warnings?.length||0;}else failed++;}catch(error){failed++;if(/서버 409:|사전이 바뀌/.test(error.message)){interrupted=error.message;break;}}
  }
  nameMessage=`${stopped?'중지됨':interrupted?'명칭 교정 대기':undo?'되돌림 완료':'명칭 통일 완료'} · ${changed}곳 변경 · ${failed}곳 확인 필요${interrupted?' · '+interrupted:''}`;status(nameMessage);
 }finally{running=false;nameBusy=false;queueDisplay();}
}
async function run(keys){
 if(running||displayTask||exporting)return;
 const requested=entries.filter(e=>keys.includes(e.key));
 if(!requested.length){status(keys.length?'선택한 이미지를 찾지 못했습니다. 새로고침을 눌러주세요.':'번역할 이미지를 선택하세요.');return;}
 const paused=globalThis.__mangaPausedBatch;
 const sameBatch=paused&&paused.remaining.length>0&&paused.keys.length===keys.length&&paused.keys.every(key=>keys.includes(key));
 const selected=sameBatch?requested.filter(e=>paused.remaining.includes(e.key)):requested;
 globalThis.__mangaPausedBatch=null;running=true;stopped=false;displayPaused=false;clearTimeout(displayTimer);const batchIdentity=pageIdentity();
 const active=()=>!stopped&&pageIdentity()===batchIdentity;
 const completed=new Set();let done=0,failed=0,interrupted='',displayEntry=null;
 try{
  for(const e of selected){
   if(!active()){stopped=true;break;}
   try{
    e.error=null;
    // A completed translation awaiting display is resumed without another OCR/LLM job.
    if(!(e.pendingJob&&e.job===e.pendingJob&&e.result&&e.original&&e.cleaned)){
     e.state=e.result?'재번역 준비':'이미지 읽기';status(`${e.index+1}번 ${e.state}`);
     if(!e.pendingJob&&!e.result&&e.job)e.pendingJob=e.job;
     if(!e.pendingJob){const data=await readImage(e);if(!active()){stopped=true;break;}e.pendingJob=(await rpc({type:'submit',data})).id;}
     const start=Date.now();
     for(;;){
      if(!active()){stopped=true;break;}
      const response=await rpc({type:'status',id:e.pendingJob});
      if(!active()){stopped=true;break;}
      if(response.status==='error'){e.pendingJob=null;if(!e.result)e.job=null;throw Error(response.error);}
      if(response.status==='done'){
       const [original,cleaned]=await Promise.all(['original.png','cleaned.png'].map(name=>rpc({type:'asset',id:e.pendingJob,name})));
       if(!active()){stopped=true;break;}
       Object.assign(e,{job:e.pendingJob,result:response.result,original,cleaned,bubbles:undefined,restoration:undefined,restored:undefined});
       remember(e);break;
      }
      const phases={queued:'대기열',loading_models:'모델 준비',detecting:'영역 탐지',detecting_dark_text:'검은 배경 글자 탐지',ocr:'글자 인식',translating:'번역'};
      e.state=phases[response.status]||response.status;status(`${done}/${selected.length} 완료 · ${e.index+1}번 ${e.state}`);
      if(Date.now()-start>900000)throw Error('처리 대기 시간 초과. 다시 실행하면 기존 작업을 확인합니다.');
      await sleep(1500);
     }
    }
    if(stopped)break;
    displayEntry=e;e.completionState=e.result.nameWarnings?.length?'완료 · 명칭 확인 필요':e.result.regions.length?'완료':'글자 없음 · 원본 유지';
    const displayStart=Date.now();let applied=false;
    while(active()&&!applied){
     displayBusy=true;
     try{
      applied=await applyEntryDisplay(e,active,stage=>{e.state=stage;status(`${done}/${selected.length} 완료 · ${e.index+1}번 ${stage}`);});
      if(!applied&&active()&&Date.now()-displayStart>900000)throw Error('표시 적용 대기 시간 초과');
     }catch(error){
      if(!active())break;
      if(/서버 409:/.test(error.message)&&Date.now()-displayStart<900000){e.state='번역 완료 · 서버 대기';displayMessage='현재 페이지 표시 적용을 위해 서버 작업이 끝나기를 기다립니다.';status(`${done}/${selected.length} 완료 · ${e.index+1}번 서버 대기`);await sleep(1000);continue;}
      interrupted=error.message;displayPaused=true;e.state='번역 완료 · 표시 적용 대기';displayMessage='번역 결과 유지 · '+error.message+' · 다시 적용으로 계속';break;
     }finally{displayBusy=false;}
    }
    if(!active()){stopped=true;e.state='번역 완료 · 표시 적용 중지';break;}
    if(interrupted)break;
    e.pendingJob=null;remember(e);done++;completed.add(e.key);displayEntry=null;displayMessage=displaySummary();
   }catch(error){if(!active()){stopped=true;break;}e.error=error.message;e.state='실패: '+error.message;failed++;}
  }
  if(stopped||interrupted)globalThis.__mangaPausedBatch={keys:[...keys],remaining:selected.filter(e=>!completed.has(e.key)).map(e=>e.key),phase:displayEntry?'display':'translation',reason:interrupted?'display-error':'stopped'};
  status(`${stopped?'중지됨':interrupted?'표시 적용 대기':'처리 종료'} · ${done}장 완료 · ${failed}장 실패${interrupted?' · '+interrupted:''}`);
 }finally{displayBusy=false;running=false;queueDisplay();if(rebindPending)rebindKnownImages();}
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
   if(m.action==='status')queueDisplay();
   if(m.action==='displayMode'){
    if(exporting)throw Error('저장이 끝난 뒤 표시 방식을 바꾸세요.');
    const mode=await rpc({type:'displayMode',mode:m.mode});setDisplayMode(mode);queueDisplay();
   }
   if(m.action==='outsideTextMode'){
    if(exporting)throw Error('저장이 끝난 뒤 표시 방식을 바꾸세요.');
    const mode=await rpc({type:'outsideTextMode',mode:m.mode});setDisplayModes(displayMode,mode);queueDisplay();
   }
   if(m.action==='displayRetry')setDisplayMode(displayMode,true);
   if(['run','preload','edit','export','exportStart','namesCorrect','namesUndo'].includes(m.action)&&(displayBusy||displayTask))throw Error('표시 적용이 끝난 뒤 실행하세요.');
   if(m.action==='nameRegions')return {regions:entries.flatMap(entry=>entry.result?(entry.result.regions||[]).filter(region=>region.text?.trim()&&region.text.length<=100).map(region=>({id:entry.job,region:region.id,page:entry.index+1,text:region.text})):[])};
   if(m.action==='namesCorrect'||m.action==='namesUndo')correctNames(m.action==='namesUndo').catch(error=>{nameMessage=error.message;status(error.message);});
   if(m.action==='preload')preload().catch(e=>status(e.message));
   if(m.action==='run'){displayPaused=false;run(m.keys||[]).catch(e=>status(e.message));}
   if(m.action==='stop'){stopped=true;displayPaused=true;clearTimeout(displayTimer);displayMessage='표시 적용 중지 · 다시 적용으로 계속';status('중지 요청됨 · 현재 서버 작업은 보존합니다.');}
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
   if(m.action==='exportStart'){if(running)throw Error('작업이 끝난 뒤 저장하세요.');exporting=true;exportPosition=reader?{reader,position:reader.position(),identity:pageIdentity()}:null;return snapshot();}
   if(m.action==='exportEnd'){const saved=exportPosition;exportPosition=null;exporting=false;if(pendingDisplayMode!==undefined){const pending=pendingDisplayMode;pendingDisplayMode=undefined;setDisplayModes(pending.mode,pending.outside);}if(saved&&saved.identity===pageIdentity())await saved.reader.restore(saved.position);queueDisplay();return snapshot();}
   if(m.action==='export'){
    if(running)throw Error('작업이 끝난 뒤 저장하세요.');
    const e=entries.find(e=>e.key===m.key);if(!e)throw Error('목록의 이미지를 찾지 못했습니다.');
    const original=e.original||await readImage(e,false);let data=original,kind='original',warning='';
    if(!e.error&&e.result?.regions.length){try{
     const cleaned=e.cleaned||await rpc({type:'asset',id:e.job,name:'cleaned.png'});
     const canvas=document.createElement('canvas');await MangaRender.render(canvas,presentation(e),original,cleaned,e.restored);data=canvas.toDataURL('image/png');kind='translated';
    }catch(error){warning='번역 이미지 렌더링 실패 · 원본 저장: '+error.message;}}
    return {data,kind,warning,state:e.state};
   }
   if(m.action==='edit'){const e=entries.find(e=>e.key===m.key);if(e?.result)await rpc({type:'edit',id:e.job,key:e.key,result:presentation(e),baseResult:e.result,geometry:e.bubbles,restoration:e.restoration,displayMode,outsideTextMode});}
   return snapshot();
  })().then(reply,e=>reply({error:e.message}));return true;
 }
 if(m.type==='applyEdited'){const e=entries.find(e=>e.key===m.key);if(e){e.result=m.result;overlay(e).then(()=>{remember(e);queueDisplay();reply({result:presentation(e),baseResult:e.result,geometry:e.bubbles,restoration:e.restoration,displayMode,outsideTextMode});}).catch(err=>reply({error:err.message}));}else reply({error:'페이지를 다시 열어 원본 이미지 연결이 끊어졌습니다.'});return true;}
 if(m.type==='namesApplied'){const entry=entries.find(entry=>entry.job===m.id&&entry.sourceURL===m.sourceURL);if(entry&&!running&&JSON.stringify(entry.result)===JSON.stringify(m.before)){const before=entry.result;entry.result=m.result;overlay(entry).then(()=>{entry.state='명칭 통일 완료';queueDisplay();reply({ok:true});}).catch(error=>{entry.result=before;overlay(entry).catch(()=>{});reply({error:error.message});});return true;}reply({ok:false});}
});
})();
