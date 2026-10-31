// Reader adapters use only pages exposed by the open viewer and its own navigation.
// Tainted canvases are read through the existing visible-tab capture permission.
(()=>{
 if(globalThis.MangaReaders)return;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 function pageIdentity(value=location.href){const u=new URL(value);u.hash='';
  if(u.hostname==='vw.mangaz.com'&&/^\/virgo\/view\/\d+/.test(u.pathname)){u.pathname=u.pathname.match(/^\/virgo\/view\/\d+/)[0];u.search='';}
  if(u.hostname==='comic-walker.com'&&/\/episodes\//.test(u.pathname)||u.hostname==='tonarinoyj.jp'&&/^\/episode\//.test(u.pathname))u.search='';
  const old=u.hostname==='urasunday.com'&&u.pathname.match(/^\/title\/(\d+)\/(\d+)\/?$/);
  if(old){u.hostname='manga-one.com';u.pathname=`/manga/${old[1]}/chapter/${old[2]}`;}
  if(u.hostname==='manga-one.com'&&/^\/manga\/\d+\/chapter\/\d+\/?$/.test(u.pathname)){u.pathname=u.pathname.replace(/\/$/,'');u.search='';}
  if(u.hostname==='www.pixiv.net'&&/^\/(?:[a-z]{2}\/)?artworks\/\d+\/?$/.test(u.pathname)){u.pathname='/artworks/'+u.pathname.match(/artworks\/(\d+)/)[1];u.search='';}
  return u.href;
 }
 const placeholder=index=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="170"><rect width="120" height="170" fill="#e3e9ed"/><text x="60" y="91" text-anchor="middle" font-size="26" fill="#637383">${index+1}</text></svg>`);
 const visible=node=>{if(!node?.isConnected)return false;const r=node.getBoundingClientRect();return r.width>1&&r.height>1&&getComputedStyle(node).visibility!=='hidden';};
 const key=(node,name)=>node.dispatchEvent(new KeyboardEvent('keydown',{key:name,code:name,bubbles:true,cancelable:true}));
 function imageRecord(source,maximum=Infinity){const sw=source.naturalWidth||source.width,sh=source.naturalHeight||source.height,factor=Math.min(1,maximum/Math.max(sw,sh)),width=Math.max(1,Math.round(sw*factor)),height=Math.max(1,Math.round(sh*factor));const c=document.createElement('canvas');c.width=width;c.height=height;const context=c.getContext('2d');context.imageSmoothingQuality='high';context.drawImage(source,0,0,width,height);
  const scale=Math.min(1,120/width,170/height),thumb=document.createElement('canvas');thumb.width=Math.max(1,Math.round(width*scale));thumb.height=Math.max(1,Math.round(height*scale));thumb.getContext('2d').drawImage(c,0,0,thumb.width,thumb.height);
  return {data:c.toDataURL('image/png'),preview:thumb.toDataURL('image/jpeg',.7),width,height};
 }
 async function captureCanvas(source,capture,foreground){
  if(!capture)throw Error('이 뷰어는 활성 탭의 화면 읽기가 필요합니다.');
  const w=source.width,h=source.height;if(!w||!h||w*h>40000000)throw Error('읽을 수 없는 페이지 크기입니다.');
  const copy=document.createElement('canvas');copy.width=w;copy.height=h;copy.getContext('2d').drawImage(source,0,0);
  const cover=document.createElement('div');cover.dataset.mangaCapture='1';cover.setAttribute('popover','manual');cover.style.cssText='position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;background:white!important;overflow:hidden!important;z-index:2147483647!important';
  const ratio=devicePixelRatio||1;copy.style.cssText=`position:absolute!important;left:0;top:0;width:${w/ratio}px!important;height:${h/ratio}px!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;transform:none!important;opacity:1!important;visibility:visible!important`;
  cover.append(copy);document.documentElement.append(cover);if(cover.showPopover)cover.showPopover();
  const out=document.createElement('canvas');out.width=w;out.height=h;const ctx=out.getContext('2d');
  try{
   const tileW=Math.max(1,Math.floor(Math.min(innerWidth,document.documentElement.clientWidth||innerWidth)*ratio)),tileH=Math.max(1,Math.floor(Math.min(innerHeight,document.documentElement.clientHeight||innerHeight)*ratio));
   for(let y=0;y<h;y+=tileH)for(let x=0;x<w;x+=tileW){
    await foreground();copy.style.left=-x/ratio+'px';copy.style.top=-y/ratio+'px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const shot=await MangaRender.image(await capture()),actualX=shot.width/innerWidth,actualY=shot.height/innerHeight,tw=Math.min(tileW,w-x),th=Math.min(tileH,h-y);
    ctx.drawImage(shot,0,0,tw/ratio*actualX,th/ratio*actualY,x,y,tw,th);
   }
   return imageRecord(out);
  }finally{cover.remove();}
 }
 // Executed in the page's MAIN world by the background worker. Read only the
 // already-authorized viewer's page types/indices; never copy URLs, crypto
 // material, account data, or call the viewer's state/authorization functions.
 async function metadata(){
  if(location.hostname==='www.pixiv.net'&&/^\/(?:[a-z]{2}\/)?artworks\/\d+\/?$/.test(location.pathname)){const id=location.pathname.match(/artworks\/(\d+)/)[1],response=await fetch('/ajax/illust/'+id+'/pages',{credentials:'include',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Pixiv 원본 목록 HTTP '+response.status);const data=await response.json();if(data.error||!Array.isArray(data.body)||!data.body.length||data.body.length>2000)throw Error('Pixiv 원본 목록을 읽을 수 없습니다.');return {url:location.href,pages:data.body.map(p=>({url:p.urls?.original,width:p.width,height:p.height}))};}

  if(location.hostname!=='manga-one.com'||!/^\/manga\/\d+\/chapter\/\d+\/?$/.test(location.pathname))return null;
  const root=document.getElementById('viewerContainer');if(!root)return null;
  const props=root[Object.keys(root).find(key=>key.startsWith('__reactProps$'))],src=props?.children?.props?.src;
  if(!Array.isArray(src)||!src.length||src.length>2000)return null;
  // Linked image cards are viewer promotions, not chapter artwork.
  return {url:location.href,total:src.length,slots:src.flatMap((page,slot)=>page?.type==='image'&&!page.anchor?[slot]:[])};
 }
 function create({capture,fetchImage,onWait,cancelled,metadata:readMetadata}={}){
  const host=location.hostname;let kind,name;
  if(host==='comic-walker.com'&&/\/episodes\//.test(location.pathname)){kind='comicwalker';name='카도코미';}
  else if(host==='tonarinoyj.jp'&&/^\/episode\//.test(location.pathname)){kind='tonari';name='토나리노 영점프';}
  else if(host==='vw.mangaz.com'&&/^\/virgo\/view\/\d+/.test(location.pathname)){kind='mangaz';name='망가즈';}
  else if(host==='manga-one.com'&&/^\/manga\/\d+\/chapter\/\d+\/?$/.test(location.pathname)){kind='mangaone';name='망가원·우라선데이';}
  else if(host==='www.pixiv.net'&&/^\/(?:[a-z]{2}\/)?artworks\/\d+\/?$/.test(location.pathname)){kind='pixiv';name='Pixiv';}
  else return null;
  const identity=pageIdentity(),cache=new Map();let cachedBytes=0,chain=Promise.resolve(),mangaOne=null,pixivCount=0,pixivPages=null,preparing=null;
  const serial=fn=>{const pending=chain.catch(()=>{}).then(fn);chain=pending;return pending;};
  const checkCancelled=()=>{if(cancelled?.())throw Error('작업이 중지되었습니다.');};
  async function foreground(){
   let waiting=false;
   while(document.hidden){checkCancelled();if(!waiting){onWait?.(name+' 탭으로 돌아오면 페이지 읽기를 이어갑니다.');waiting=true;}await sleep(150);}
   checkCancelled();
  }
  async function until(test,message,timeout=18000){
   let remaining=timeout;
   while(remaining>0){
    await foreground();const start=performance.now(),value=test();if(value)return value;
    await sleep(100);if(!document.hidden)remaining-=performance.now()-start;
   }
   throw Error(message);
  }
  async function moveUntil(changed,move,moving=()=>false){
   let nextAttempt=0;
   return until(()=>{
    if(changed())return true;
    // Viewer keyboard/click handlers can ignore an input while busy. Retry
    // only if the page has not changed and its animation has settled.
    if(performance.now()>=nextAttempt&&!moving()){move();nextAttempt=performance.now()+700;}
    return changed();
   },'뷰어 페이지 이동 시간 초과',20000);
  }
  async function prepare(){
   if(kind==='pixiv'){
    if(pixivCount&&(!readMetadata||pixivPages))return;if(preparing)return preparing;
    preparing=(async()=>{await until(()=>{const slider=pixivSlider(),count=Number(slider?.max);if(Number.isInteger(count)&&count>0&&count<=2000&&Number(slider.min)===1){pixivCount=count;return true;}return false;},'Pixiv에서 작품 읽기 뷰어를 연 뒤 새로고침하세요.',6000);
     if(readMetadata){const value=await readMetadata();checkCancelled();if(pageIdentity()!==identity||pageIdentity(value?.url)!==identity||!Array.isArray(value?.pages)||value.pages.length!==pixivCount)throw Error('Pixiv 원본 목록이 현재 작품과 일치하지 않습니다.');const artwork=new URL(identity).pathname.match(/artworks\/(\d+)/)[1];for(let i=0;i<value.pages.length;i++){const p=value.pages[i];let valid=false;try{const u=new URL(p.url),m=u.pathname.match(/\/(\d+)_p(\d+)\.[A-Za-z0-9]+$/);valid=u.protocol==='https:'&&(u.hostname==='i.pximg.net'||u.hostname.endsWith('.pximg.net'))&&u.pathname.startsWith('/img-original/')&&m?.[1]===artwork&&Number(m[2])===i;}catch{}if(!valid||![p.width,p.height].every(n=>Number.isInteger(n)&&n>0&&n<=16000)||p.width*p.height>64000000)throw Error('Pixiv 원본 이미지 정보가 올바르지 않거나 너무 큽니다.');}pixivPages=value.pages;}
    })();try{await preparing;}finally{preparing=null;}return;
   }
   if(kind!=='mangaone'||mangaOne)return;
   if(preparing)return preparing;
   preparing=(async()=>{
    for(let attempt=0;attempt<40;attempt++){
     await foreground();const data=await readMetadata?.();
     if(pageIdentity()!==identity)throw Error('다른 회차로 이동했습니다. 새로고침을 눌러주세요.');
     if(data&&pageIdentity(data.url)===identity&&Number.isInteger(data.total)&&data.total>0&&data.total<=2000&&Array.isArray(data.slots)&&data.slots.length<=data.total&&data.slots.every((slot,i)=>Number.isInteger(slot)&&slot>=0&&slot<data.total&&(i===0||slot>data.slots[i-1]))){mangaOne=data;return;}
     await sleep(150);
    }
    throw Error('망가원 뷰어의 페이지 목록을 읽지 못했습니다. 회차를 연 뒤 새로고침하세요.');
   })().finally(()=>preparing=null);return preparing;
  }
  const mangaOneImages=()=>[...document.querySelectorAll('#viewerContainer img[alt^="page_"]')].filter(img=>/^page_\d+$/.test(img.alt));
  function mangaOneShown(node){
   if(!visible(node))return false;const r=node.getBoundingClientRect(),v=document.getElementById('viewerContainer')?.getBoundingClientRect();
   return !!v&&Math.min(r.right,v.right)-Math.max(r.left,v.left)>r.width*.95&&Math.min(r.bottom,v.bottom)-Math.max(r.top,v.top)>r.height*.95;
  }
  const mangaOneMoving=()=>!!document.querySelector('#viewerContainer [class$="_slide_container"]')?.getAnimations().some(a=>a.playState==='running');
  function mangaOneSlot(){
   const slots=mangaOneImages().filter(mangaOneShown).map(img=>Number(img.alt.slice(5)));if(slots.length)return Math.min(...slots);
   // At the final recommendation screens no manga image is visible. The public
   // seek thumb lets the reader navigate backwards without selecting a chapter.
   const thumb=document.querySelector('#viewerContainer [class$="_seek_area"] > div'),ratio=parseFloat(thumb?.style.right)/100;
   return Number.isFinite(ratio)?Math.round(ratio*((mangaOne?.total||1)-1)):0;
  }
  const pixivSlider=()=>document.querySelector('input.gtm-manga-viewer-change-page[type="range"]');
  function pixivImages(index){
   const artwork=new URL(identity).pathname.match(/artworks\/(\d+)/)?.[1];
   return [...document.querySelectorAll('.gtm-expand-full-size-illust[data-page] img')].filter(img=>{
    if(img.closest('[data-manga-translator-overlay],[data-manga-capture]')||Number(img.closest('[data-page]').dataset.page)!==index+1)return false;
    try{const u=new URL(img.currentSrc||img.src),m=u.pathname.match(/\/(\d+)_p(\d+)(?:_|\.)/);return u.protocol==='https:'&&(u.hostname==='i.pximg.net'||u.hostname.endsWith('.pximg.net'))&&m?.[1]===artwork&&Number(m[2])===index;}catch{return false;}
   });
  }
  function pixivViewport(node){for(let p=node?.parentElement;p&&p!==document.body;p=p.parentElement){const css=getComputedStyle(p);if(/auto|scroll/.test(css.overflowX+' '+css.overflowY))return p;}return null;}
  function pixivShown(node){if(!visible(node))return false;const r=node.getBoundingClientRect(),v=pixivViewport(node)?.getBoundingClientRect()||{left:0,top:0,right:innerWidth,bottom:innerHeight};return Math.min(r.right,v.right)-Math.max(r.left,v.left)>=Math.min(r.width,v.right-v.left)*.9&&Math.min(r.bottom,v.bottom)-Math.max(r.top,v.top)>=Math.min(r.height,v.bottom-v.top)*.8;}
  function comicCanvases(){return [...document.querySelectorAll('[data-type="contents"] canvas,canvas[mode="vertical"],canvas[mode="sp"],canvas[mode="pc"]')].filter(c=>!c.closest('[data-manga-translator-overlay],[data-manga-capture]'));}
  function tonariPages(){try{return JSON.parse(document.querySelector('#episode-json')?.dataset.value||'{}').readableProduct?.pageStructure?.pages||[];}catch{return [];}}
  function pages(){
   if(kind==='pixiv')return Array.from({length:pixivCount},(_,index)=>({index,sourceURL:`${identity}#manga-page=${index}`,width:0,height:0}));
   if(kind==='mangaone')return (mangaOne?.slots||[]).map((slot,index)=>({index,slot,sourceURL:`${identity}#manga-page=${slot}`,width:0,height:0}));
   if(kind==='comicwalker')return comicCanvases().map((node,index)=>({index,sourceURL:`${identity}#manga-page=${index}`,width:node.width,height:node.height}));
   if(kind==='tonari')return tonariPages().map((page,slot)=>({...page,slot})).filter(p=>p.type==='main'&&typeof p.src==='string').map((p,index)=>({index,slot:p.slot,sourceURL:`${identity}#manga-page=${index}`,width:p.width,height:p.height}));
   const count=Number(document.querySelector('.total-number')?.textContent);return Number.isInteger(count)&&count>0&&count<=2000?Array.from({length:count},(_,index)=>({index,sourceURL:`${identity}#manga-page=${index}`,width:0,height:0})):[];
  }
  function element(page){
   if(kind==='pixiv'){const nodes=pixivImages(page.index);return nodes.find(pixivShown)||nodes.find(visible)||nodes[0]||null;}
   if(kind==='mangaone')return mangaOneImages().find(img=>Number(img.alt.slice(5))===page.slot)||null;
   if(kind==='comicwalker')return comicCanvases()[page.index]||null;
   if(kind==='tonari')return document.querySelectorAll('.js-viewer .js-page-area')[page.slot]?.querySelector('canvas.js-page-image,img.js-page-image')||null;
   return [...document.querySelectorAll('#book .page_unit img.image[no]')].find(img=>Number(img.getAttribute('no'))===page.index&&visible(img))||null;
  }
  function currentIndex(){const all=pages();
   if(kind==='pixiv')return Math.max(0,Math.min(all.length-1,(Number(pixivSlider()?.value)||1)-1));
   if(kind==='mangaone'){const slot=mangaOneSlot(),index=all.findIndex(p=>p.slot>=slot);return index<0?Math.max(0,all.length-1):index;}
   if(kind==='comicwalker'){
    const first=element(all[0]||{});if(first?.getAttribute('mode')!=='vertical'){const i=all.findIndex(p=>element(p)?.closest('.splide__slide')?.classList.contains('is-active'));return Math.max(0,i);}
    const viewport=first?.closest('.splide__track,[data-radix-scroll-area-viewport]')?.getBoundingClientRect()||{left:0,right:innerWidth,top:0,bottom:innerHeight};let best=0,area=0;
    for(const p of all){const node=element(p);if(!node)continue;const r=node.getBoundingClientRect(),size=Math.max(0,Math.min(r.right,viewport.right)-Math.max(r.left,viewport.left))*Math.max(0,Math.min(r.bottom,viewport.bottom)-Math.max(r.top,viewport.top));if(size>area){best=p.index;area=size;}}return best;
   }
   if(kind==='mangaz'){const current=Number(document.querySelector('.current-number')?.textContent)-1;if(Number.isInteger(current)&&current>=0&&current<all.length)return current;const nums=[...document.querySelectorAll('#book img.image[no]')].filter(visible).map(x=>Number(x.getAttribute('no')));return nums.length?Math.min(...nums):0;}
   const viewer=document.querySelector('.js-viewer')?.getBoundingClientRect();if(!viewer)return 0;let best=0,area=0;for(const p of all){const node=element(p);if(!node)continue;const r=node.getBoundingClientRect(),size=Math.max(0,Math.min(r.right,viewer.right)-Math.max(r.left,viewer.left))*Math.max(0,Math.min(r.bottom,viewer.bottom)-Math.max(r.top,viewer.top));if(size>area){best=p.index;area=size;}}return best;
  }
  async function navigate(page){
   await foreground();
   if(pageIdentity()!==identity)throw Error('다른 회차로 이동했습니다. 새로고침을 눌러주세요.');
   if(kind==='pixiv'){
    await prepare();if(!pixivSlider())throw Error('Pixiv에서 작품 읽기 뷰어를 다시 열어주세요.');
    let attempts=0;await moveUntil(()=>pixivShown(element(page)),()=>{const slider=pixivSlider();if(!slider)throw Error('Pixiv 뷰어가 닫혔습니다.');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,String(page.index+1));slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));if(++attempts>1){const node=element(page)||document.querySelector(`.gtm-expand-full-size-illust[data-page="${page.index+1}"]`);node?.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'});}});
   }else if(kind==='comicwalker'){
    const node=element(page);if(!node)throw Error('뷰어 페이지를 찾지 못했습니다.');const slide=node.closest('.splide__slide'),root=node.closest('.splide');
    if(!slide||!root){node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});}
    else{
     root.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
     const slides=[...root.querySelectorAll('.splide__list > .splide__slide')],target=slides.indexOf(slide),vertical=node.getAttribute('mode')==='vertical'||root.classList.contains('splide--ttb');
     if(vertical){
      const track=node.closest('.splide__track');if(!track)throw Error('세로 뷰어 이동 요소를 찾지 못했습니다.');
      // The viewer loads pages on its wheel callback. Its keyboard-only move
      // changes the carousel index without notifying the page loader.
      const delta=slide.getBoundingClientRect().top-track.getBoundingClientRect().top+1;
      track.dispatchEvent(new WheelEvent('wheel',{deltaY:delta,bubbles:true,cancelable:true}));
      await until(()=>Math.abs(slide.getBoundingClientRect().top-track.getBoundingClientRect().top)<3,'세로 페이지 이동 시간 초과',5000);
     }else for(let n=0;n<slides.length+2;n++){
      const at=slides.findIndex(x=>x.classList.contains('is-active'));if(at===target)break;
      await moveUntil(()=>slides.findIndex(x=>x.classList.contains('is-active'))!==at,()=>key(root,target>at?'ArrowLeft':'ArrowRight'),()=>root.querySelector('.splide__list')?.getAnimations().some(a=>a.playState==='running'));
     }
    }
   }else if(kind==='tonari'){
    const slider=document.querySelector('input.js-slider'),viewer=document.querySelector('.js-viewer');if(!slider||!viewer)throw Error('뷰어 이동 요소를 찾지 못했습니다.');
    const spread=!!document.querySelector('.js-viewer-content.is-spread'),value=Math.max(Number(slider.min),Math.min(Number(slider.max),Math.ceil(page.slot/(spread?2:1))));
    slider.value=String(value);slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));viewer.scrollIntoView({block:'start',behavior:'instant'});
   }else if(kind==='mangaone'){
    await prepare();const viewer=document.getElementById('viewerContainer');if(!viewer)throw Error('뷰어 이동 요소를 찾지 못했습니다.');
    viewer.scrollIntoView({block:'start',behavior:'instant'});
    await until(()=>!mangaOneMoving(),'뷰어 페이지 이동 시간 초과');
    for(let n=0;n<mangaOne.total+2;n++){
     if(mangaOneShown(element(page)))break;const before=mangaOneSlot();
     await moveUntil(()=>!mangaOneMoving()&&(mangaOneShown(element(page))||mangaOneSlot()!==before),()=>key(viewer,page.slot>before?'ArrowLeft':'ArrowRight'),mangaOneMoving);
    }
   }else{
    for(let n=0;n<pages().length+2;n++){
     if(element(page))break;const before=currentIndex(),beforeURL=location.href,beforeNumber=document.querySelector('.current-number')?.textContent,forward=page.index>before,button=document.querySelector(forward?'.btnNext.next,.btnBack.next':'.btnNext.prev,.btnBack.prev')||document.querySelector(forward?'.btnNext':'.btnBack');if(!button)throw Error('뷰어 이동 요소를 찾지 못했습니다.');
     // The viewer can report the target page while a late paired-page load
     // leaves its image hidden. Ask its public resize handler to redraw it,
     // rather than trying to move backwards past page zero.
     await moveUntil(()=>element(page)||currentIndex()!==before,()=>{if(before===page.index)window.dispatchEvent(new Event('resize'));else button.click();},()=>location.href!==beforeURL||document.querySelector('.current-number')?.textContent!==beforeNumber);
    }
   }
   return until(()=>{const node=element(page);if(!node||!visible(node)||kind==='mangaone'&&(!mangaOneShown(node)||mangaOneMoving()))return null;if(node instanceof HTMLImageElement)return node.complete&&node.naturalWidth?node:null;
    if(!node.width||!node.height)return null;
    try{const c=node.getContext('2d');if(!c)return node;for(const [x,y]of [[.5,.5],[.1,.1],[.9,.9],[.9,.1]])if(c.getImageData(Math.floor(node.width*x),Math.floor(node.height*y),1,1).data[3])return node;return null;}catch{return node;}
   },'페이지 이미지가 아직 표시되지 않았습니다.');
  }
  function remember(index,record){
   const old=cache.get(index);if(old)cachedBytes-=old.data.length;cache.delete(index);cache.set(index,record);cachedBytes+=record.data.length;
   while(cachedBytes>256*1024*1024&&cache.size>1){const [key,value]=cache.entries().next().value;cache.delete(key);cachedBytes-=value.data.length;}return record;
  }
  return {kind,name,identity,prepare,pages,element,placeholder,currentIndex,
   localAnchor:page=>element(page)?.parentElement||null,
   position:()=>{const index=currentIndex(),node=element(pages()[index]||{}),track=node?.closest('.splide__track,[data-radix-scroll-area-viewport]');return {index,x:scrollX,y:scrollY,mode:node?.getAttribute('mode'),offset:track?node.getBoundingClientRect().top-track.getBoundingClientRect().top:null,...(kind==='pixiv'?{viewerX:pixivViewport(node)?.scrollLeft,viewerY:pixivViewport(node)?.scrollTop,direction:document.querySelector('.gtm-manga-viewer-change-direction [direction]')?.getAttribute('direction')}:{} )};},
   restore:position=>serial(async()=>{const p=pages()[position.index];if(p&&pageIdentity()===identity){await navigate(p);const node=element(p);if(kind==='pixiv'&&position.direction===document.querySelector('.gtm-manga-viewer-change-direction [direction]')?.getAttribute('direction')&&Number.isFinite(position.viewerX)&&Number.isFinite(position.viewerY))pixivViewport(node)?.scrollTo({left:position.viewerX,top:position.viewerY,behavior:'instant'});const track=node?.closest('.splide__track');if(kind==='comicwalker'&&position.mode==='vertical'&&node?.getAttribute('mode')==='vertical'&&track&&Number.isFinite(position.offset)){const delta=node.getBoundingClientRect().top-track.getBoundingClientRect().top-position.offset;if(Math.abs(delta)>.5)track.dispatchEvent(new WheelEvent('wheel',{deltaY:delta,bubbles:true,cancelable:true}));}scrollTo({left:position.x,top:position.y,behavior:'instant'});}}),
   locate:page=>serial(()=>navigate(page)),
   read:page=>serial(async()=>{if(pageIdentity()!==identity)throw Error('다른 회차로 이동했습니다. 새로고침을 눌러주세요.');const saved=cache.get(page.index);if(saved)return saved;const node=await navigate(page);if(kind==='pixiv'&&pixivPages){if(!fetchImage)throw Error('Pixiv 원본 이미지 읽기가 준비되지 않았습니다.');const source=pixivPages[page.index],data=await fetchImage(source.url);checkCancelled();if(pageIdentity()!==identity)throw Error('다른 작품으로 이동했습니다. 새로고침을 눌러주세요.');const image=new Image();try{image.src=data;await image.decode();if(image.naturalWidth!==source.width||image.naturalHeight!==source.height)throw Error('Pixiv 원본 이미지 크기가 목록과 일치하지 않습니다.');return remember(page.index,imageRecord(image,2400));}finally{image.src='';}}let record;try{record=imageRecord(node);}catch(error){if(kind==='pixiv'&&node instanceof HTMLImageElement&&fetchImage){const url=node.currentSrc||node.src;const data=await fetchImage(url);if(pageIdentity()!==identity)throw Error('다른 작품으로 이동했습니다. 새로고침을 눌러주세요.');const image=new Image();image.src=data;await image.decode();record=imageRecord(image);}else{if(!(node instanceof HTMLCanvasElement))throw error;record=await captureCanvas(node,capture,foreground);}}return remember(page.index,record);})
  };
 }
 globalThis.MangaReaders={create,pageIdentity,placeholder,metadata};
})();
