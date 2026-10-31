const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||process.env.PLAYWRIGHT_MODULE||'playwright');

const extensionRoot=process.env.MANGA_EXTENSION_ROOT||path.resolve(__dirname,'../extension');
const glyphRuns=Array.from({length:15},(_,i)=>[(10+i)*72+10,i<3?10:3]).flat();
const fixtures=[
 {name:'glyph-shape',regions:[{id:1,bbox:[100,100,200,250],hitMask:{version:1,kind:'detector-text-region',imageWidth:720,imageHeight:1020,width:72,height:102,sourceBox:[100,100,200,250],sourceText:'Source 1',runs:glyphRuns,pixels:66}}],points:[{position:[115,200],id:1},{position:[180,120],id:1},{position:[180,200],id:null}]},
 {name:'unrelated-over-direct',regions:[
  {id:1,bbox:[100,100,200,250],box:[100,100,200,250],fontSize:18,mode:'replace'},
  {id:2,bbox:[50,40,250,360]}
 ],tooltipCount:1,points:[{position:[150,170],id:null},{position:[70,70],id:2}]},
 {name:'duplicate-direct',regions:[
  {id:1,bbox:[100,100,200,250],box:[100,100,200,250],fontSize:18,mode:'replace'},
  {id:2,bbox:[50,40,250,360],translation:'Translation 1',text:'Source 1'},
  {id:3,bbox:[300,100,400,250]}
 ],tooltipCount:1,points:[{position:[150,170],id:null},{position:[350,170],id:3}]},
 {name:'page-one',regions:[
  {id:16,bbox:[529,370,628,545]},
  {id:17,bbox:[529,369,659,711]},
  {id:29,bbox:[481,585,559,773]},
  {id:33,bbox:[456,602,720,999]}
 ],points:[{position:[550,450],id:16},{position:[640,400],id:17},{position:[520,650],id:29},{position:[700,950],id:33}]},
 {name:'page-two',regions:[
  {id:1,bbox:[142,63,669,610]},
  {id:3,bbox:[571,108,594,179]},
  {id:4,bbox:[132,449,613,612]}
 ],points:[{position:[582,143],id:3},{position:[400,500],id:4},{position:[400,300],id:1}]}
];

fixtures.push({...fixtures[0],name:'glyph-hole-small-tooltip',regions:[...fixtures[0].regions,{id:2,bbox:[160,180,190,220]}],points:[{position:[115,200],id:1},{position:[180,200],id:2},{position:[145,230],id:1}]});

if(process.env.MANGA_TOOLTIP_FIXTURES){fixtures.splice(0,fixtures.length,...JSON.parse(require('node:fs').readFileSync(process.env.MANGA_TOOLTIP_FIXTURES)));}

(async()=>{
 const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:process.env.MANGA_HEADED!=='1'});
 try{
  for(const fixture of fixtures)for(const reversed of [false,true])for(const readerMode of [false,true]){
   const page=await browser.newPage({viewport:{width:1000,height:850}});
   await page.route('https://reader.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;padding:24px}#anchor{width:720px}img{display:block;width:100%;height:auto}</style><div id="anchor"><img id="source" alt="Page 1" width="720" height="1020"></div>'}));
   await page.goto('https://reader.test/'+fixture.name);
   const regions=fixture.regions.map(region=>({mode:'tooltip',translation:'Translation '+region.id,text:'Source '+region.id,...region}));
   if(reversed)regions.reverse();
   await page.evaluate(({regions,readerMode})=>{
    const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1020"><rect width="720" height="1020" fill="white"/></svg>');
    document.getElementById('source').src=image;
    window.fixtureResult={width:720,height:1020,regions};
    window.originalResult=JSON.stringify(fixtureResult);
    window.messages=[];
    window.listeners=[];
    const sourceURL=readerMode?'reader-page:one':image;
    if(readerMode)window.MangaReaders={pageIdentity:()=>location.href,create:()=>({identity:location.href,name:'Test reader',pages:()=>[{index:0,sourceURL,width:720,height:1020}],element:()=>document.getElementById('source')})};
    window.chrome={runtime:{onMessage:{addListener:listener=>listeners.push(listener)},sendMessage:async message=>{
     messages.push(message.type);
     if(message.type==='settings')return {ok:true,value:{selector:''}};
     if(message.type==='restore')return {ok:true,value:[{sourceURL,key:'cached-page',id:'cached-job',result:fixtureResult}]};
     if(message.type==='asset')return {ok:true,value:image};
     if(message.type==='remember')return {ok:true,value:true};
     throw Error('Unexpected request: '+message.type);
    }}};
    window.send=message=>new Promise(resolve=>listeners[0](message,null,resolve));
   },{regions,readerMode});
   await page.addScriptTag({path:path.join(extensionRoot,'polygon.js')});
   await page.addScriptTag({path:path.join(extensionRoot,'render.js')});
   await page.addScriptTag({path:path.join(extensionRoot,'content.js')});
   await page.evaluate(()=>send({type:'control',action:'scan'}));
   await page.waitForFunction(count=>document.querySelectorAll('[data-tip]').length===count,fixture.tooltipCount??regions.length);
   const canvasBefore=await page.locator('[data-manga-translator-overlay] canvas').evaluate(canvas=>canvas.toDataURL());
   async function checkPoints(){
    for(const point of fixture.points){
     const position=await page.locator('[data-manga-translator-overlay]').evaluate((overlay,point)=>{
      const bounds=overlay.getBoundingClientRect();
      const top=scrollY+bounds.top+point[1]*bounds.height/1020;
      scrollTo({top:Math.max(0,top-innerHeight/2),behavior:'instant'});
      const moved=overlay.getBoundingClientRect();
      return {x:moved.left+point[0]*moved.width/720,y:moved.top+point[1]*moved.height/1020};
     },point.position);
     await page.mouse.move(position.x,position.y);
     const hit=await page.evaluate(({x,y})=>{
      const element=document.elementFromPoint(x,y);
      return {tip:!!element?.closest('[data-tip]'),title:element?.title,hover:element?.matches(':hover'),cursor:element&&getComputedStyle(element).cursor};
     },position);
     if(point.id===null){assert.equal(hit.tip,false,'duplicate tooltip covers direct translation');continue;}
     assert.deepEqual(hit,{tip:true,title:`원문 보존 · 번역: Translation ${point.id}\n원문: Source ${point.id}`,hover:true,cursor:'help'},`${fixture.name}, reversed=${reversed}, reader=${readerMode}, point=${point.position}`);
    }
   }
   await checkPoints();
   assert.equal(await page.evaluate(()=>JSON.stringify(fixtureResult)),await page.evaluate(()=>originalResult),'tooltip order changed the cached result');
   await page.evaluate(()=>document.getElementById('anchor').style.width='360px');
   await page.waitForFunction(()=>Math.abs(document.querySelector('[data-manga-translator-overlay]').getBoundingClientRect().width-360)<1);
   await checkPoints();
   await page.evaluate(()=>send({type:'control',action:'toggle'}));
   assert.equal(await page.locator('[data-manga-translator-overlay]').isVisible(),false);
   await page.evaluate(()=>send({type:'control',action:'toggle'}));
   const edited=await page.evaluate(()=>send({type:'applyEdited',key:'cached-page',result:{...fixtureResult,regions:[...fixtureResult.regions].reverse()}}));
   assert.deepEqual(edited.baseResult,await page.evaluate(()=>({...fixtureResult,regions:[...fixtureResult.regions].reverse()})));
   assert.deepEqual(edited.result,edited.baseResult);
   await checkPoints();
   assert.equal(await page.locator('[data-tip]').count(),fixture.tooltipCount??regions.length,'editing duplicated tooltip regions');
   const clipping=await page.evaluate(()=>({tips:[...document.querySelectorAll('[data-tip]')].map(t=>t.style.clipPath),defs:document.querySelectorAll('[data-manga-tooltip-geometry]').length,clips:[...document.querySelectorAll('clipPath')].map(c=>({units:c.getAttribute('clipPathUnits'),rule:c.firstElementChild?.getAttribute('clip-rule')}))}));
   assert(clipping.tips.every(c=>!c||c.startsWith('url(')),'Live CSS polygon can stall Edge native HitTest');
   assert(clipping.defs<=1,'Editing retained old clip definitions');
   assert(clipping.clips.every(c=>c.units==='objectBoundingBox'&&c.rule==='evenodd'),'Tooltip holes or responsive coordinates lost');
   assert.equal(await page.locator('[data-manga-translator-overlay] canvas').evaluate(canvas=>canvas.toDataURL()),canvasBefore,'tooltip ordering changed rendered pixels');
   assert.equal(await page.evaluate(()=>messages.includes('submit')),false,'restored result was submitted again');
   await page.close();
  }
  console.log(JSON.stringify({ok:true,browser:browser.version(),cases:fixtures.length*4,actualPageGeometry:true,smallRegionsAccessible:true,largeRegionsAccessible:true,reversedInput:true,readerPointerEvents:true,resized:true,originalToggle:true,editedResults:true,cachedResultUnchanged:true,renderedPixelsUnchanged:true,noInference:true}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
