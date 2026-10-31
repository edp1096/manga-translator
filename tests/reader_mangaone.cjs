// Virtualized images, recommendation slots, delayed loads and ignored keys.
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT);
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.MANGA_BROWSER_CHANNEL?{channel:process.env.MANGA_BROWSER_CHANNEL}:{})});try{
 const page=await browser.newPage({viewport:{width:1000,height:800}});
 await page.route('https://manga-one.com/**',r=>r.fulfill({contentType:'text/html',body:'<style>body{margin:0}#viewerContainer{position:relative;width:1000px;height:600px;overflow:hidden}.test_slide_container{height:100%}.sheet{position:absolute;width:400px;height:600px;top:0}.sheet img{width:400px;height:600px}</style><div id="viewerContainer"><div class="test_slide_container"></div><div class="test_seek_area"><div style="right:0%"></div></div></div>'}));
 await page.goto('https://manga-one.com/manga/1/chapter/2?sort_type=desc');
 await page.evaluate(async()=>{
  window.slot=0;window.inputs=0;window.moves=[];window.drop=true;window.busy=false;window.hidden=false;window.cancel=false;window.waits=[];
  Object.defineProperty(document,'hidden',{get:()=>hidden,configurable:true});
  const root=document.getElementById('viewerContainer');root.__reactProps$fixture={children:{props:{src:[{type:'image',crypto:'do-not-export'},{type:'image'},{type:'embedded_element'},{type:'image'},{type:'image',anchor:{url:'/manga/99/chapter/999'}}]}}};
  window.show=async()=>{
   const list=root.querySelector('.test_slide_container');list.replaceChildren();
   for(const index of [0,1,3].filter(index=>Math.abs(index-slot)<=1)){
    const anchor=document.createElement('div');anchor.className='sheet';anchor.style.left=300+(slot-index)*1000+'px';const canvas=document.createElement('canvas');canvas.width=400;canvas.height=600;canvas.getContext('2d').fillStyle=['red','green','blue','purple'][index];canvas.getContext('2d').fillRect(0,0,400,600);
    const img=new Image();img.alt='page_'+index;img.src=URL.createObjectURL(await new Promise(resolve=>canvas.toBlob(resolve)));anchor.append(img);list.append(anchor);await img.decode();
   }
   root.querySelector('.test_seek_area>div').style.right=slot/4*100+'%';
  };await show();
  window.addEventListener('keydown',async e=>{
   if(!['ArrowLeft','ArrowRight'].includes(e.key))return;inputs++;if(drop){drop=false;return;}if(busy)return;busy=true;
   await root.querySelector('.test_slide_container').animate([{opacity:1},{opacity:1}],{duration:950}).finished;
   slot=Math.max(0,Math.min(4,slot+(e.key==='ArrowLeft'?1:-1)));moves.push(slot);await show();busy=false;
  });
 });
 await page.addScriptTag({path:path.resolve(__dirname,'../extension/readers.js')});
 const data=await page.evaluate(async()=>{window.reader=MangaReaders.create({metadata:()=>MangaReaders.metadata(),cancelled:()=>cancel,onWait:x=>waits.push(x)});await reader.prepare();return {metadata:await MangaReaders.metadata(),pages:reader.pages()};});
 assert.deepEqual(Object.keys(data.metadata).sort(),['slots','total','url']);assert.deepEqual(data.metadata.slots,[0,1,3]);assert.equal(data.pages.length,3);assert(data.pages.every(p=>!p.sourceURL.includes('blob:')));
 assert.equal(data.pages[2].sourceURL,'https://manga-one.com/manga/1/chapter/2#manga-page=3');
 await page.evaluate(()=>reader.locate(reader.pages()[2]));assert.equal(await page.evaluate(()=>slot),3);assert.deepEqual(await page.evaluate(()=>moves),[1,2,3],'ignored key or slow animation skipped a page');assert((await page.evaluate(()=>inputs))>=4,'dropped input was not retried');
 const record=await page.evaluate(()=>reader.read(reader.pages()[2]));assert(record.data.startsWith('data:image/png;base64,'));assert.equal(record.width,400);
 await page.evaluate(async()=>{slot=4;await show();});await page.evaluate(()=>reader.locate(reader.pages()[0]));assert.equal(await page.evaluate(()=>slot),0,'could not return from recommendation screen');
 const before=await page.evaluate(()=>inputs);await page.evaluate(()=>{hidden=true;window.blocked=reader.locate(reader.pages()[2]).then(()=>({ok:true}),error=>({error:error.message}));});await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>inputs),before);await page.evaluate(()=>cancel=true);assert.match((await page.evaluate(()=>blocked)).error,/중지/);assert.equal(await page.evaluate(()=>waits.length),1);
 await page.evaluate(()=>{hidden=false;cancel=false;history.replaceState(null,'','/manga/1/chapter/2?page=3');});assert.equal(await page.evaluate(()=>MangaReaders.pageIdentity()),'https://manga-one.com/manga/1/chapter/2');
 const old=await page.evaluate(()=>MangaReaders.pageIdentity('https://urasunday.com/title/1/2'));assert.equal(old,'https://manga-one.com/manga/1/chapter/2');
 await page.evaluate(()=>history.replaceState(null,'','/manga/1/chapter/3'));assert.match(await page.evaluate(()=>reader.read(reader.pages()[2]).then(()=>'',error=>error.message)),/다른 회차/,'cached pixels leaked into another chapter');
 await page.evaluate(()=>{window.delayed=MangaReaders.create({metadata:async()=>{await new Promise(r=>setTimeout(r,100));return MangaReaders.metadata();}}).prepare().then(()=>'',error=>error.message);history.replaceState(null,'','/manga/1/chapter/4');});assert.match(await page.evaluate(()=>delayed),/다른 회차/);
 await page.evaluate(()=>{document.getElementById('viewerContainer').__reactProps$fixture.children.props.src=[{type:'embedded_element'}];});assert.deepEqual(await page.evaluate(async()=>(await MangaReaders.metadata()).slots),[],'a locked/promotion page became a manga page');
 console.log(JSON.stringify({ok:true,publicImageSlotsOnly:true,metadataMinimal:true,stableChapterKeys:true,offscreenPagesNotMisread:true,droppedKeyRecovered:true,slowAnimationNotSkipped:true,returnFromRecommendation:true,hiddenCancellation:true,crossChapterGuard:true}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
