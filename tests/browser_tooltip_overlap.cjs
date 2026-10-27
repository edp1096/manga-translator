const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||process.env.PLAYWRIGHT_MODULE||'playwright');

const fixtures=[
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

(async()=>{
 const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:process.env.MANGA_HEADED!=='1'});
 try{
  for(const fixture of fixtures)for(const reversed of [false,true])for(const readerMode of [false,true]){
   const page=await browser.newPage({viewport:{width:1000,height:850}});
   await page.route('https://reader.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;padding:24px}#anchor{width:720px}img{display:block;width:100%;height:auto}</style><div id="anchor"><img id="source" alt="Page 1" width="720" height="1020"></div>'}));
   await page.goto('https://reader.test/'+fixture.name);
   const regions=fixture.regions.map(region=>({...region,mode:'tooltip',translation:'Translation '+region.id,text:'Source '+region.id}));
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
   await page.addScriptTag({path:path.resolve(__dirname,'../extension/render.js')});
   await page.addScriptTag({path:path.resolve(__dirname,'../extension/content.js')});
   await page.evaluate(()=>send({type:'control',action:'scan'}));
   await page.waitForFunction(()=>document.querySelectorAll('[data-tip]').length===fixtureResult.regions.length);
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
      return {title:element?.title,hover:element?.matches(':hover'),cursor:element&&getComputedStyle(element).cursor};
     },position);
     assert.deepEqual(hit,{title:`원문 보존 · 번역: Translation ${point.id}\n원문: Source ${point.id}`,hover:true,cursor:'help'},`${fixture.name}, reversed=${reversed}, reader=${readerMode}, point=${point.position}`);
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
   assert.equal(edited,true);
   await checkPoints();
   assert.equal(await page.locator('[data-tip]').count(),regions.length,'editing duplicated tooltip regions');
   assert.equal(await page.locator('[data-manga-translator-overlay] canvas').evaluate(canvas=>canvas.toDataURL()),canvasBefore,'tooltip ordering changed rendered pixels');
   assert.equal(await page.evaluate(()=>messages.includes('submit')),false,'restored result was submitted again');
   await page.close();
  }
  console.log(JSON.stringify({ok:true,browser:browser.version(),cases:8,actualPageGeometry:true,smallRegionsAccessible:true,largeRegionsAccessible:true,reversedInput:true,readerPointerEvents:true,resized:true,originalToggle:true,editedResults:true,cachedResultUnchanged:true,renderedPixelsUnchanged:true,noInference:true}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
