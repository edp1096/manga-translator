// Reader adapters use only pages exposed by the open viewer and its own navigation.
// Tainted canvases are read through the existing visible-tab capture permission.
(()=>{
 if(globalThis.MangaReaders)return;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 function pageIdentity(value=location.href){const u=new URL(value);u.hash='';
  if(u.hostname==='vw.mangaz.com'&&/^\/virgo\/view\/\d+/.test(u.pathname)){u.pathname=u.pathname.match(/^\/virgo\/view\/\d+/)[0];u.search='';}
  if(u.hostname==='comic-walker.com'&&/\/episodes\//.test(u.pathname)||u.hostname==='tonarinoyj.jp'&&/^\/episode\//.test(u.pathname))u.search='';
  return u.href;
 }
 const placeholder=index=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="170"><rect width="120" height="170" fill="#e3e9ed"/><text x="60" y="91" text-anchor="middle" font-size="26" fill="#637383">${index+1}</text></svg>`);
 const visible=node=>{if(!node?.isConnected)return false;const r=node.getBoundingClientRect();return r.width>1&&r.height>1&&getComputedStyle(node).visibility!=='hidden';};
 const key=(node,name)=>node.dispatchEvent(new KeyboardEvent('keydown',{key:name,code:name,bubbles:true,cancelable:true}));
 async function until(test,message,timeout=18000){const end=Date.now()+timeout;while(Date.now()<end){const value=test();if(value)return value;await sleep(100);}throw Error(message);}
 function imageRecord(source){const width=source.naturalWidth||source.width,height=source.naturalHeight||source.height;const c=document.createElement('canvas');c.width=width;c.height=height;c.getContext('2d').drawImage(source,0,0,width,height);
  const scale=Math.min(1,120/width,170/height),thumb=document.createElement('canvas');thumb.width=Math.max(1,Math.round(width*scale));thumb.height=Math.max(1,Math.round(height*scale));thumb.getContext('2d').drawImage(c,0,0,thumb.width,thumb.height);
  return {data:c.toDataURL('image/png'),preview:thumb.toDataURL('image/jpeg',.7),width,height};
 }
 async function captureCanvas(source,capture){
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
    copy.style.left=-x/ratio+'px';copy.style.top=-y/ratio+'px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const shot=await MangaRender.image(await capture()),actualX=shot.width/innerWidth,actualY=shot.height/innerHeight,tw=Math.min(tileW,w-x),th=Math.min(tileH,h-y);
    ctx.drawImage(shot,0,0,tw/ratio*actualX,th/ratio*actualY,x,y,tw,th);
   }
   return imageRecord(out);
  }finally{cover.remove();}
 }
 function create({capture}={}){
  const host=location.hostname;let kind,name;
  if(host==='comic-walker.com'&&/\/episodes\//.test(location.pathname)){kind='comicwalker';name='카도코미';}
  else if(host==='tonarinoyj.jp'&&/^\/episode\//.test(location.pathname)){kind='tonari';name='토나리노 영점프';}
  else if(host==='vw.mangaz.com'&&/^\/virgo\/view\/\d+/.test(location.pathname)){kind='mangaz';name='망가즈';}
  else return null;
  const identity=pageIdentity(),cache=new Map();let cachedBytes=0,chain=Promise.resolve();
  const serial=fn=>{const pending=chain.catch(()=>{}).then(fn);chain=pending;return pending;};
  function comicCanvases(){return [...document.querySelectorAll('[data-type="contents"] canvas,canvas[mode="vertical"],canvas[mode="sp"],canvas[mode="pc"]')].filter(c=>!c.closest('[data-manga-translator-overlay],[data-manga-capture]'));}
  function tonariPages(){try{return JSON.parse(document.querySelector('#episode-json')?.dataset.value||'{}').readableProduct?.pageStructure?.pages||[];}catch{return [];}}
  function pages(){
   if(kind==='comicwalker')return comicCanvases().map((node,index)=>({index,sourceURL:`${identity}#manga-page=${index}`,width:node.width,height:node.height}));
   if(kind==='tonari')return tonariPages().map((page,slot)=>({...page,slot})).filter(p=>p.type==='main'&&typeof p.src==='string').map((p,index)=>({index,slot:p.slot,sourceURL:`${identity}#manga-page=${index}`,width:p.width,height:p.height}));
   const count=Number(document.querySelector('.total-number')?.textContent);return Number.isInteger(count)&&count>0&&count<=2000?Array.from({length:count},(_,index)=>({index,sourceURL:`${identity}#manga-page=${index}`,width:0,height:0})):[];
  }
  function element(page){
   if(kind==='comicwalker')return comicCanvases()[page.index]||null;
   if(kind==='tonari')return document.querySelectorAll('.js-viewer .js-page-area')[page.slot]?.querySelector('canvas.js-page-image,img.js-page-image')||null;
   return [...document.querySelectorAll('#book .page_unit img.image[no]')].find(img=>Number(img.getAttribute('no'))===page.index&&visible(img))||null;
  }
  function currentIndex(){const all=pages();
   if(kind==='comicwalker'){
    const first=element(all[0]||{});if(first?.getAttribute('mode')!=='vertical'){const i=all.findIndex(p=>element(p)?.closest('.splide__slide')?.classList.contains('is-active'));return Math.max(0,i);}
    const viewport=first?.closest('.splide__track,[data-radix-scroll-area-viewport]')?.getBoundingClientRect()||{left:0,right:innerWidth,top:0,bottom:innerHeight};let best=0,area=0;
    for(const p of all){const node=element(p);if(!node)continue;const r=node.getBoundingClientRect(),size=Math.max(0,Math.min(r.right,viewport.right)-Math.max(r.left,viewport.left))*Math.max(0,Math.min(r.bottom,viewport.bottom)-Math.max(r.top,viewport.top));if(size>area){best=p.index;area=size;}}return best;
   }
   if(kind==='mangaz'){const nums=[...document.querySelectorAll('#book img.image[no]')].filter(visible).map(x=>Number(x.getAttribute('no')));return nums.length?Math.min(...nums):0;}
   const viewer=document.querySelector('.js-viewer')?.getBoundingClientRect();if(!viewer)return 0;let best=0,area=0;for(const p of all){const node=element(p);if(!node)continue;const r=node.getBoundingClientRect(),size=Math.max(0,Math.min(r.right,viewer.right)-Math.max(r.left,viewer.left))*Math.max(0,Math.min(r.bottom,viewer.bottom)-Math.max(r.top,viewer.top));if(size>area){best=p.index;area=size;}}return best;
  }
  async function navigate(page){
   if(pageIdentity()!==identity)throw Error('다른 회차로 이동했습니다. 새로고침을 눌러주세요.');
   if(kind==='comicwalker'){
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
      key(root,target>at?'ArrowLeft':'ArrowRight');await until(()=>slides.findIndex(x=>x.classList.contains('is-active'))!==at,'뷰어 페이지 이동 시간 초과',5000);
     }
    }
   }else if(kind==='tonari'){
    const slider=document.querySelector('input.js-slider'),viewer=document.querySelector('.js-viewer');if(!slider||!viewer)throw Error('뷰어 이동 요소를 찾지 못했습니다.');
    const spread=!!document.querySelector('.js-viewer-content.is-spread'),value=Math.max(Number(slider.min),Math.min(Number(slider.max),Math.ceil(page.slot/(spread?2:1))));
    slider.value=String(value);slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));viewer.scrollIntoView({block:'start',behavior:'instant'});
   }else{
    for(let n=0;n<pages().length+2;n++){
     if(element(page))break;const before=currentIndex(),button=document.querySelector(page.index>before?'.btnNext':'.btnBack');if(!button)throw Error('뷰어 이동 요소를 찾지 못했습니다.');button.click();
     await until(()=>element(page)||currentIndex()!==before,'뷰어 페이지 이동 시간 초과',12000);
    }
   }
   return until(()=>{const node=element(page);if(!node||!visible(node))return null;if(node instanceof HTMLImageElement)return node.complete&&node.naturalWidth?node:null;
    if(!node.width||!node.height)return null;
    try{const c=node.getContext('2d');if(!c)return node;for(const [x,y]of [[.5,.5],[.1,.1],[.9,.9],[.9,.1]])if(c.getImageData(Math.floor(node.width*x),Math.floor(node.height*y),1,1).data[3])return node;return null;}catch{return node;}
   },'페이지 이미지가 아직 표시되지 않았습니다.');
  }
  function remember(index,record){
   const old=cache.get(index);if(old)cachedBytes-=old.data.length;cache.delete(index);cache.set(index,record);cachedBytes+=record.data.length;
   while(cachedBytes>256*1024*1024&&cache.size>1){const [key,value]=cache.entries().next().value;cache.delete(key);cachedBytes-=value.data.length;}return record;
  }
  return {kind,name,identity,pages,element,placeholder,currentIndex,
   localAnchor:page=>element(page)?.parentElement||null,
   position:()=>{const index=currentIndex(),node=element(pages()[index]||{}),track=node?.closest('.splide__track,[data-radix-scroll-area-viewport]');return {index,x:scrollX,y:scrollY,mode:node?.getAttribute('mode'),offset:track?node.getBoundingClientRect().top-track.getBoundingClientRect().top:null};},
   restore:position=>serial(async()=>{const p=pages()[position.index];if(p&&pageIdentity()===identity){await navigate(p);const node=element(p),track=node?.closest('.splide__track');if(kind==='comicwalker'&&position.mode==='vertical'&&node?.getAttribute('mode')==='vertical'&&track&&Number.isFinite(position.offset)){const delta=node.getBoundingClientRect().top-track.getBoundingClientRect().top-position.offset;if(Math.abs(delta)>.5)track.dispatchEvent(new WheelEvent('wheel',{deltaY:delta,bubbles:true,cancelable:true}));}scrollTo({left:position.x,top:position.y,behavior:'instant'});}}),
   locate:page=>serial(()=>navigate(page)),
   read:page=>serial(async()=>{if(pageIdentity()!==identity)throw Error('다른 회차로 이동했습니다. 새로고침을 눌러주세요.');const saved=cache.get(page.index);if(saved)return saved;const node=await navigate(page);let record;try{record=imageRecord(node);}catch(error){if(!(node instanceof HTMLCanvasElement))throw error;record=await captureCanvas(node,capture);}return remember(page.index,record);})
  };
 }
 globalThis.MangaReaders={create,pageIdentity,placeholder};
})();
