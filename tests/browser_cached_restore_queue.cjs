const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 const page=await browser.newPage();await page.route('https://reader.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('https://reader.test/cache');
 await page.evaluate(()=>{
  window.createdCanvases=[];const create=document.createElement.bind(document);document.createElement=function(tag,...args){const e=create(tag,...args);if(tag==='canvas')createdCanvases.push(e);return e;};window.listeners=[];window.activeAssets=0;window.maximumAssets=0;window.beats=0;
  window.timer=setInterval(()=>beats++,0);
  const items=[];for(let i=0;i<12;i++){const src='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1020"><rect width="720" height="1020" fill="white"/><text x="20" y="20">${i}</text></svg>`);const img=new Image();img.src=src;img.alt='Page '+(i+1);img.style.width='720px';document.body.append(img);items.push({sourceURL:src,key:'page'+i,id:'job'+i,result:{width:720,height:1020,regions:[]}});}
  window.chrome={runtime:{onMessage:{addListener:l=>listeners.push(l)},sendMessage:async m=>{
   if(m.type==='settings')return{ok:true,value:{selector:'img'}};
   if(m.type==='restore')return{ok:true,value:items};
   if(m.type==='asset'){maximumAssets=Math.max(maximumAssets,++activeAssets);await new Promise(r=>setTimeout(r,15));activeAssets--;return{ok:true,value:items.find(x=>x.id===m.id).sourceURL};}
   if(m.type==='remember')return{ok:true,value:true};throw Error('Unexpected '+m.type);
  }}};window.send=m=>new Promise(r=>listeners[0](m,null,r));
 });
 for(const f of ['polygon.js','render.js','content.js'])await page.addScriptTag({path:path.join(process.env.MANGA_EXTENSION_ROOT||path.resolve(__dirname,'../extension'),f)});
 await page.evaluate(()=>send({type:'control',action:'scan'}));
 await page.waitForFunction(()=>document.querySelectorAll('[data-manga-translator-overlay]').length===12);
 const report=await page.evaluate(async()=>{clearInterval(timer);const s=await send({type:'control',action:'status'});return{software:[...document.querySelectorAll('[data-manga-translator-overlay] canvas')].every(c=>c.getContext('2d').getContextAttributes().willReadFrequently),temporary:createdCanvases.filter(c=>!c.isConnected&&c.width===720&&c.height===1020).length,maximumAssets,beats,overlays:document.querySelectorAll('[data-manga-translator-overlay]').length,done:s.items.filter(x=>x.done).length};});
 assert.equal(report.temporary,0,'Full-page temporary canvases retained');assert(report.software,'Overlay canvas competes with inference GPU');assert.equal(report.maximumAssets,2,'Cached pages fetch/render simultaneously');assert.equal(report.done,12);assert(report.beats>=12,'Page did not yield between cached restores');console.log(JSON.stringify(report));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
