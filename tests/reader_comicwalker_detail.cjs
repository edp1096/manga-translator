const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 const page=await browser.newPage({viewport:{width:1100,height:800}}),source=process.env.MANGA_EXTENSION||path.resolve(__dirname,'../extension');
 await page.route('https://comic-walker.com/**',r=>r.fulfill({contentType:'text/html',body:'<img id="cover" alt="cover" width="400" height="600">'}));
 for(const pathname of ['/detail/KC_003525_S?episodeType=first','/detail/KC_003525_S?episodeType=latest','/detail/KC_003525_S','/detail/KC_003525_S/','/detail/KC_003525_S/episodes/KC_0035250000100011_E?co=true&episodeType=first','/episodes/test']){
  await page.goto('https://comic-walker.com'+pathname);
  for(const file of ['polygon.js','fonts.js','rotation.js','render.js','readers.js'])await page.addScriptTag({path:path.join(source,file)});
  await page.evaluate(()=>{
   window.messages=[];window.listeners=[];window.chrome={storage:{onChanged:{addListener(){}}},runtime:{onMessage:{addListener:f=>listeners.push(f)},sendMessage:async m=>{messages.push(m.type);if(m.type==='settings')return{ok:true,value:{lightweightDisplay:true}};if(m.type==='restore')return{ok:true,value:[]};throw Error(m.type)}}};
   window.call=m=>new Promise(resolve=>listeners[0]({type:'control',...m},null,resolve));
   window.reader=MangaReaders.create();
  });
  assert.equal(await page.evaluate(()=>reader?.kind),'comicwalker','detail URLs must use the comic reader even before lazy viewer mounts');
  await page.addScriptTag({path:path.join(source,'content.js')});
  await page.evaluate(()=>setTimeout(()=>{
   const root=document.createElement('div');root.className='splide';root.innerHTML='<style>.splide__slide{display:none}.splide__slide.is-active{display:block}</style><div class="splide__track"><div class="splide__list"><div class="splide__slide is-active"><canvas mode="pc" data-type="contents" width="400" height="600"></canvas></div><div class="splide__slide"><div data-type="contents"><canvas mode="pc" width="400" height="600"></canvas><canvas mode="pc" width="400" height="600"></canvas></div></div><div class="splide__slide"><canvas mode="pc" width="400" height="600"></canvas></div></div></div>';
   document.body.append(root);const all=[...root.querySelectorAll('canvas')];const fill=s=>{for(const c of s.querySelectorAll('canvas')){c.getContext('2d').fillStyle=['red','green','blue','black'][all.indexOf(c)];c.getContext('2d').fillRect(0,0,400,600);}};fill(root.querySelector('.is-active'));
   root.addEventListener('keydown',e=>{const slides=[...root.querySelectorAll('.splide__slide')],i=slides.findIndex(s=>s.classList.contains('is-active')),j=Math.max(0,Math.min(slides.length-1,i+(e.key==='ArrowLeft'?1:-1)));slides.forEach((s,k)=>s.classList.toggle('is-active',k===j));fill(slides[j]);});
   const ad=document.createElement('canvas');ad.width=200;ad.height=300;document.body.append(ad);
  },100));
  const status=await page.evaluate(()=>call({action:'scan'}));assert(!status.error,status.error);assert.equal(status.reader,'카도코미');assert.equal(status.items.length,4,'index must exclude cover and unrelated canvas');assert(status.items.every(i=>i.sourceURL.includes('#manga-page=')));
  const records=await page.evaluate(async()=>{await reader.prepare();const result=[];for(const p of reader.pages()){const data=await reader.read(p);result.push({width:data.width,height:data.height,data:data.data});}return result;});assert.equal(records.length,4);assert(records.every(r=>r.width===400&&r.height===600));assert.equal(new Set(records.map(r=>r.data)).size,4);
  assert.equal(await page.evaluate(()=>messages.includes('submit')),false,'indexing must not submit translation');
 }
 await page.goto('https://comic-walker.com/ranking');await page.addScriptTag({path:path.join(source,'readers.js')});assert.equal(await page.evaluate(()=>MangaReaders.create()),null);
 const identity=await page.evaluate(()=>({first:MangaReaders.pageIdentity('https://comic-walker.com/detail/KC_003525_S?episodeType=first#page=1'),latest:MangaReaders.pageIdentity('https://comic-walker.com/detail/KC_003525_S?episodeType=latest#page=2'),episode:MangaReaders.pageIdentity('https://comic-walker.com/detail/KC_003525_S/episodes/KC_0035250000100011_E?co=true')}));assert.notEqual(identity.first,identity.latest,'first/latest chapter caches must not mix');assert(!identity.first.includes('#'));assert(!identity.episode.includes('?'));
 console.log('PASS ComicWalker detail/episode routes, lazy viewer preparation, complete artwork indexing, RTL spread navigation, source reads, cover/ad exclusion and first/latest identity separation');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
