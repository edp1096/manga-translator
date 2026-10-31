// Real public viewers; local API is mocked so translations do not leave this test.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {chromium}=require(process.env.MANGA_PLAYWRIGHT);
const sites=[['comicwalker','https://comic-walker.com/detail/KC_021514_S/episodes/KC_0215140000200011_E?episodeType=latest',18],['tonari','https://tonarinoyj.jp/episode/12207421983972478434',38],['mangaz','https://vw.mangaz.com/virgo/view/287048/i:0',7],['urasunday','https://urasunday.com/title/28501/359545',38],['mangaone','https://manga-one.com/manga/1924/chapter/354658',23]];
async function idle(page,timeout=180000){const end=Date.now()+timeout;let last=0;while(Date.now()<end){const s=await page.evaluate(()=>control({action:'status'}));if(!s.running)return s;if(Date.now()-last>6000){console.log(s.message);last=Date.now();}await page.waitForTimeout(200);}throw Error('Reader task timeout');}
(async()=>{const browser=await chromium.launch({headless:process.env.MANGA_HEADED!=='1',...(process.env.MANGA_BROWSER_CHANNEL?{channel:process.env.MANGA_BROWSER_CHANNEL}:{})});try{for(const [name,url,count]of sites.filter(s=>!process.env.MANGA_READER_TEST_SITE||process.env.MANGA_READER_TEST_SITE.split(',').includes(s[0]))){
 const page=await browser.newPage({viewport:{width:1400,height:1000},locale:'ja-JP'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('__captureTest',async()=>{await page.waitForTimeout(580);return 'data:image/png;base64,'+(await page.screenshot()).toString('base64');});
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForTimeout(1800);
 await page.evaluate(()=>{window.listeners=[];window.chrome={runtime:{onMessage:{addListener:f=>listeners.push(f)},sendMessage:async m=>{
  if(m.type==='readerMetadata')return {ok:true,value:MangaReaders.metadata()};
  if(m.type==='settings')return {ok:true,value:{selector:'',captureFallback:true}};
  if(m.type==='restore')return {ok:true,value:[]};if(m.type==='remember')return {ok:true,value:true};if(m.type==='capture')return {ok:true,value:await __captureTest()};
  if(m.type==='submit'){window.__submitted=m.data;const i=await MangaRender.image(m.data);window.__result={width:i.width,height:i.height,regions:[{id:'check',manual:true,text:'test',translation:'번역 위치 확인',bbox:[40,40,320,150],box:[40,40,320,150],fontSize:24,mode:'replace'}]};return {ok:true,value:{id:'reader-test'}};}
  if(m.type==='status')return {ok:true,value:{status:'done',result:__result}};
  if(m.type==='asset')return {ok:true,value:__submitted};
  throw Error('Unexpected RPC '+m.type);
 }}};window.control=m=>new Promise(resolve=>listeners[0]({...m,type:'control'},null,resolve));});
 for(const file of ['render.js','readers.js','content.js'])await page.addScriptTag({path:path.join(__dirname,'../extension',file)});
 await page.evaluate(async()=>{window.testReader=MangaReaders.create({metadata:()=>MangaReaders.metadata()});await testReader.prepare();});
 let state=await page.evaluate(()=>control({action:'scan'}));assert.equal(state.items.length,count,name+' body count');const keys=state.items.map(i=>i.key);
 const selected=[0,Math.floor(count/2),count-1];const samples=[];
 for(const index of selected){await page.evaluate(key=>control({action:'locate',key}),keys[index]);const result=await page.evaluate(key=>control({action:'export',key}),keys[index]);assert(!result.error,result.error);assert(result.data.startsWith('data:image/png;base64,'));
  const dimensions=await page.evaluate(async data=>{const image=await MangaRender.image(data);const c=document.createElement('canvas');c.width=32;c.height=32;c.getContext('2d').drawImage(image,0,0,32,32);const p=c.getContext('2d').getImageData(0,0,32,32).data;return {width:image.width,height:image.height,nonwhite:[...p].filter((v,i)=>i%4!==3&&v<220).length};},result.data);assert(dimensions.width>500&&dimensions.height>700);assert(dimensions.nonwhite>8,'blank capture');samples.push({index,...dimensions});
 }
 await page.evaluate(key=>control({action:'locate',key}),keys[0]);
 await page.evaluate(key=>control({action:'run',keys:[key]}),keys[0]);assert((await idle(page,60000)).items[0].done);
 const alignment=()=>page.evaluate(()=>{const adapter=testReader,source=adapter.element(adapter.pages()[0]),overlay=[...document.querySelectorAll('[data-manga-translator-overlay]')].find(e=>e.dataset.mangaSource===MangaReaders.pageIdentity()+'#manga-page=0');if(!source||!overlay||getComputedStyle(overlay).display==='none')return false;const a=source.getBoundingClientRect(),b=overlay.getBoundingClientRect();return overlay.parentElement===source.parentElement&&['x','y','width','height'].every(k=>Math.abs(a[k]-b[k])<2);});
 assert(await alignment(),'translated overlay is not aligned inside reader');
 await page.evaluate(()=>control({action:'toggle'}));assert.equal(await page.locator('[data-manga-translator-overlay]').evaluate(e=>getComputedStyle(e).display),'none');await page.evaluate(()=>control({action:'toggle'}));
 if(name==='comicwalker'){await page.getByRole('button',{name:'タテ読み',exact:true}).click();await page.waitForTimeout(1200);state=await page.evaluate(()=>control({action:'scan'}));assert.deepEqual(state.items.map(i=>i.key),keys,'changing reading mode changed page keys');await page.evaluate(key=>control({action:'locate',key}),keys[4]);assert(await page.locator('[data-type=contents] canvas[mode=vertical]').count()>0);}
 await page.evaluate(key=>control({action:'locate',key}),keys[0]);await page.waitForTimeout(250);assert(await alignment(),'mode/navigation lost translated overlay alignment');
 if(name==='comicwalker')await page.evaluate(()=>document.querySelector('canvas[mode=vertical]').closest('.splide__track').dispatchEvent(new WheelEvent('wheel',{deltaY:280,bubbles:true,cancelable:true})));
 const beforePosition=await page.evaluate(()=>testReader.position());const before=beforePosition.index;await page.evaluate(()=>control({action:'preload'}));await idle(page);
 state=await page.evaluate(()=>control({action:'status'}));assert.match(state.message,/읽기 실패 0장/);assert.equal(state.items.length,count);assert(state.items.every(e=>e.preview.startsWith('data:image/jpeg')),'missing page thumbnail');assert((await page.evaluate(()=>testReader.currentIndex()))>before,'preload jumped back to its starting page');await page.evaluate(key=>control({action:'locate',key}),keys[0]);
 assert.deepEqual(state.items.map(i=>i.key),keys,'page navigation discarded results');assert(state.items[0].done,'preload discarded translation');assert(await alignment(),'preload displaced translated overlay');
 fs.mkdirSync(process.env.MANGA_SITE_PROBE,{recursive:true});fs.writeFileSync(path.join(process.env.MANGA_SITE_PROBE,name+'-adapter.json'),JSON.stringify({name,count,samples,allPagesLoaded:true,overlayAligned:true,noCompletionJump:true,errors},null,2));console.log(JSON.stringify({name,count,samples,allPagesLoaded:true,overlayAligned:true,noCompletionJump:true,errors}));assert.deepEqual(errors,[]);
 await page.close();
 }}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
