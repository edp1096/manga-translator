// Reader navigation regressions with deterministic dropped input and slow transitions.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT);
const source=process.env.MANGA_EXTENSION||path.resolve(__dirname,'../extension');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.route('https://comic-walker.com/**',r=>r.fulfill({contentType:'text/html',body:'<div class="splide"><div class="splide__track"><div class="splide__list"><div class="splide__slide is-active" data-type="contents"><canvas mode="pc" width="400" height="600"></canvas></div><div class="splide__slide" data-type="contents"><canvas mode="pc" width="400" height="600"></canvas></div></div></div></div>'}));
  await page.goto('https://comic-walker.com/episodes/test');
  await page.evaluate(()=>{
   for(const c of document.querySelectorAll('canvas')){c.getContext('2d').fillStyle='white';c.getContext('2d').fillRect(0,0,400,600);}
   window.inputs=0;window.drop=true;window.moving=false;window.cancel=false;window.hidden=false;window.waits=[];
   Object.defineProperty(document,'hidden',{get:()=>window.hidden,configurable:true});
   window.addEventListener('keydown',()=>{
    inputs++;if(drop){drop=false;return;}if(moving)return;moving=true;
    const list=document.querySelector('.splide__list'),slides=[...list.children];
    list.animate([{opacity:1},{opacity:1}],{duration:1200}).finished.then(()=>{slides.forEach(x=>x.classList.remove('is-active'));slides[1].classList.add('is-active');moving=false;});
   });
  });
  for(const file of ['render.js','readers.js'])await page.addScriptTag({path:path.join(source,file)});
  await page.evaluate(()=>{window.reader=MangaReaders.create({onWait:x=>waits.push(x),cancelled:()=>cancel});window.navigation=reader.locate(reader.pages()[1]).then(()=>true);});
  assert.equal(await page.evaluate(()=>navigation),true);
  assert.equal(await page.evaluate(()=>inputs),2,'retries overshot an accepted slow transition');
  assert.equal(await page.evaluate(()=>reader.currentIndex()),1);

  await page.evaluate(()=>{
   document.querySelectorAll('.splide__slide').forEach((s,i)=>s.classList.toggle('is-active',i===0));
   inputs=0;hidden=true;
   window.blocked=reader.locate(reader.pages()[1]).then(()=>({ok:true}),e=>({error:e.message}));
  });
  await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>inputs),0,'hidden viewer received navigation');
  await page.evaluate(()=>cancel=true);
  assert.match((await page.evaluate(()=>blocked)).error,/중지/);
  assert.equal(await page.evaluate(()=>waits.length),1);
  await page.evaluate(()=>{hidden=false;cancel=false;});

  // Translate one page, then read a different page while the API is still busy.
  await page.evaluate(()=>{
   window.listeners=[];window.release=false;window.submitted=false;
   const data=document.querySelector('canvas').toDataURL();
   window.chrome={runtime:{onMessage:{addListener:f=>listeners.push(f)},sendMessage:async m=>{
    let value;if(m.type==='settings')value={selector:''};
    else if(m.type==='restore')value=[];
    else if(m.type==='submit'){submitted=true;value={id:'job'};}
    else if(m.type==='status')value=release?{status:'done',result:{width:400,height:600,regions:[]}}:{status:'translating'};
    else if(m.type==='asset')value=data;
    else if(m.type==='remember')value=true;
    else throw Error(m.type);
    return {ok:true,value};
   }}};
   window.control=m=>new Promise(resolve=>listeners[0]({...m,type:'control'},null,resolve));
   document.querySelectorAll('.splide__slide').forEach((s,i)=>s.classList.toggle('is-active',i===0));inputs=0;
  });
  await page.addScriptTag({path:path.join(source,'content.js')});
  const state=await page.evaluate(()=>control({action:'scan'}));
  await page.evaluate(key=>control({action:'run',keys:[key]}),state.items[0].key);
  await page.waitForFunction(()=>submitted);
  const moved=await page.evaluate(key=>control({action:'locate',key}),state.items[1].key);
  assert.equal(moved.running,true,'navigation waited for the whole translation');
  assert.equal(await page.evaluate(()=>reader.currentIndex()),1);
  await page.evaluate(()=>release=true);
  for(let n=0;n<60;n++){if(!(await page.evaluate(()=>control({action:'status'}))).running)break;await page.waitForTimeout(100);}
  const done=await page.evaluate(()=>control({action:'status'}));
  assert.equal(done.running,false);assert.equal(done.items[0].done,true);
  assert.equal(await page.evaluate(()=>reader.currentIndex()),1,'translation completion reset the reader position');

  const manga=await browser.newPage();
  await manga.route('https://vw.mangaz.com/**',r=>r.fulfill({contentType:'text/html',body:'<span class="total-number">2</span><span class="current-number">1</span><div id="book"><div class="page_unit"></div></div><button class="btnNext">Next</button><button class="btnBack">Back</button>'}));
  await manga.goto('https://vw.mangaz.com/virgo/view/1');
  await manga.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=400;canvas.height=600;canvas.getContext('2d').fillRect(0,0,400,600);
   const data=canvas.toDataURL();window.clicks=0;
   window.show=index=>{document.querySelector('.page_unit').innerHTML='';const img=new Image();img.className='image';img.setAttribute('no',index);img.src=data;document.querySelector('.page_unit').append(img);};
   show(0);document.querySelector('.btnNext').onclick=()=>{if(++clicks>1){document.querySelector('.current-number').textContent='2';setTimeout(()=>show(1),1400);}};
  });
  await manga.addScriptTag({path:path.join(source,'readers.js')});
  await manga.evaluate(async()=>{const r=MangaReaders.create();await r.locate(r.pages()[1]);});
  assert.equal(await manga.evaluate(()=>clicks),2,'Mangaz did not retry an ignored click');
  await manga.evaluate(async()=>{
   // Mirror the observed real viewer: page counter is 1, but only page 2's
   // image has a visible rectangle after its paired-page loader finishes.
   document.querySelector('.current-number').textContent='1';
   window.addEventListener('resize',()=>setTimeout(()=>show(0),150),{once:true});
   const r=MangaReaders.create();await r.locate(r.pages()[0]);
   if(r.currentIndex()!==0)throw Error('Wrong logical first page');
  });
  assert.equal(await manga.locator('img.image').getAttribute('no'),'0','hidden first page was not redrawn');
  console.log(JSON.stringify({ok:true,droppedKeyboardRecovered:true,slowTransitionNotSkipped:true,hiddenNavigationWaits:true,cancellable:true,moveDuringTranslation:true,noCompletionJump:true,droppedMangazClickRecovered:true,slowMangazLoadNotSkipped:true,mangazLogicalPageRedrawn:true}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
