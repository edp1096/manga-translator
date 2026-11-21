// A Comici page can finish restoring before the site creates its source canvas.
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.env.MANGA_PLAYWRIGHT || 'playwright');

(async () => {
 const browser = await chromium.launch({headless:true, channel:process.env.MANGA_BROWSER_CHANNEL || 'chromium'});
 try {
  const page = await browser.newPage();
  const url = 'https://younganimal.com/episodes/test';
  await page.route(url, r => r.fulfill({contentType:'text/html', body:
   '<div id="comici-viewer"><div id="xCVPages"><div class="-cv-page"><div class="-cv-page-content"><div class="-cv-page-canvas" style="width:200px;height:250px"></div></div></div></div></div>'}));
  await page.goto(url);
  await page.evaluate(() => {
   const original = document.createElement('canvas');
   original.width = 200;
   original.height = 250;
   const asset = original.toDataURL();
   window.chrome = {runtime:{
    onMessage:{addListener:listener => {window.scan = () => new Promise(resolve => listener({type:'control', action:'scan'}, null, resolve));}},
    sendMessage:async m => {
     if(m.type === 'restore') return {ok:true,value:[{key:'one',id:'job',sourceURL:location.href+'#manga-page=1',result:{width:200,height:250,regions:[]}}]};
     if(m.type === 'settings') return {ok:true,value:{lightweightDisplay:true}};
     if(m.type === 'asset') return {ok:true,value:asset};
     throw Error(m.type);
    }
   }};
  });
  for (const file of ['readers.js','polygon.js','render.js','content.js'])
   await page.addScriptTag({path:path.join(process.env.MANGA_EXTENSION_ROOT || path.resolve(__dirname,'../extension'),file)});
  await page.evaluate(() => window.scan());
  const overlay = page.locator('[data-manga-translator-overlay]');
  await overlay.waitFor({state:'attached'});
  assert.equal(await overlay.isVisible(), false);
  for(let paint=0; paint<2; paint++){
   // Let pending restore and resize callbacks settle before the site changes artwork.
   await page.waitForTimeout(750);
   await page.evaluate(() => {
    const holder=document.querySelector('.-cv-page-canvas'), canvas=document.createElement('canvas');
    canvas.width=200;canvas.height=250;holder.replaceChildren(canvas);
   });
   await page.locator('.-cv-page-canvas > [data-manga-translator-overlay]').waitFor({state:'visible',timeout:3000});
   assert.deepEqual(await overlay.boundingBox(),await page.locator('.-cv-page-canvas > canvas').boundingBox());
  }
  console.log('PASS cached translation follows lazy canvas creation and replacement without locate');
 } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
