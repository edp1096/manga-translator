const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{fs.mkdirSync('research/page-fonts-2026-11-04',{recursive:true});const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 const page=await browser.newPage({viewport:{width:1300,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://pagefonts.test/**',route=>{const name=new URL(route.request().url()).pathname.slice(1);return route.fulfill({body:fs.readFileSync(path.join(__dirname,'../extension',name)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.woff')?'font/woff':'text/html;charset=utf-8'});});
 await page.addInitScript(()=>{const job='11111111-1111-4111-8111-111111111111';const initial={width:400,height:400,target:'Korean',regions:[0,1,2].map((n)=>({id:n+1,type:'text',mode:'replace',text:'原文',translation:'반가워, 오늘도!',bbox:[20,20+n*120,300,110+n*120],box:[20,20+n*120,300,110+n*120],fontSize:24,...(n===1?{fontChoice:'shower',fontWeight:400}:{})}))};window.chrome={storage:{onChanged:{addListener(){}},local:{get:async()=>({['edit:'+job]:{result:JSON.parse(localStorage.getItem('edited')||'null')||initial}})}},runtime:{sendMessage:async m=>{
 if(m.type==='settings')return {ok:true,value:{fontPolicy:{dialogue:{font:'dialogue',bold:false}}}};
 if(m.type==='font'){const bytes=new Uint8Array(await(await fetch('fonts/'+m.id+'.woff')).arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return {ok:true,value:'data:font/woff;base64,'+btoa(s)};}
 if(m.type==='asset'){const c=document.createElement('canvas');c.width=c.height=400;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,400,400);return {ok:true,value:c.toDataURL()};}
 if(m.type==='apply'){localStorage.setItem('edited',JSON.stringify(m.result));return {ok:true,value:{result:m.result,baseResult:m.result}};}return {ok:false,error:'Unsupported '+m.type};}}};});
 await page.goto('https://pagefonts.test/editor.html?job=11111111-1111-4111-8111-111111111111');await page.waitForFunction(()=>document.querySelector('#status').textContent==='3개 영역');
 const effective=()=>page.evaluate(()=>MangaFonts.decorate(result).regions.map(r=>[r._fontId,MangaFonts.weight(r)]));
 await page.locator('#page-font-settings summary').click();await page.selectOption('#page-font-family','serif');await page.selectOption('#page-font-weight','700');await page.evaluate(()=>draw());
 assert.deepEqual(await effective(),[['serif',700],['shower',400],['serif',700]]);
 const firstBoxes=await page.evaluate(()=>result.regions.map(r=>r.box));
 await page.locator('.box[data-region="2"]').click({modifiers:['Control']});assert.equal(await page.locator('.box.selected').count(),2);
 await page.selectOption('#font-family','stone');await page.selectOption('#font-weight','400');await page.evaluate(()=>draw());assert.deepEqual(await effective(),[['stone',400],['shower',400],['stone',400]]);
 assert.deepEqual(await page.evaluate(()=>result.regions.map(r=>r.box)),firstBoxes,'Selection must not move boxes');
 // Ctrl removes one member; then plain + Shift selects the full range.
 await page.locator('.box[data-region="0"]').click({modifiers:['Control']});assert.equal(await page.locator('.box.selected').count(),1);
 await page.locator('.box[data-region="0"]').click();await page.locator('.box[data-region="2"]').click({modifiers:['Shift']});assert.equal(await page.locator('.box.selected').count(),3);assert.equal(await page.locator('#font-family').inputValue(),'mixed');
 await page.selectOption('#font-family','auto');await page.selectOption('#font-weight','auto');await page.evaluate(()=>draw());assert.deepEqual(await effective(),[['serif',700],['serif',700],['serif',700]]);
 await page.locator('#select-single').click();assert.equal(await page.locator('.box.selected').count(),1);await page.locator('#select-all').click();assert.equal(await page.locator('.box.selected').count(),3);
 await page.selectOption('#font-family','handwritten');await page.evaluate(()=>draw());await page.click('#apply');await page.waitForFunction(()=>document.querySelector('#status').textContent==='원본 페이지에 적용했습니다.');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('edited')));assert.deepEqual(saved.fontDefaults,{font:'serif',weight:700});assert(saved.regions.every(r=>r.fontChoice==='handwritten'&&!('_pageFontDefaults'in r)));
 await page.reload();await page.waitForFunction(()=>document.querySelector('#status').textContent==='3개 영역');assert.deepEqual(await effective(),[['handwritten',700],['handwritten',700],['handwritten',700]]);
 await page.locator('#select-all').click();await page.selectOption('#font-family','auto');await page.evaluate(()=>draw());
 const normal=await page.evaluate(()=>document.querySelector('#canvas').toDataURL());
 await page.evaluate(async()=>{const out=document.createElement('canvas');await MangaRender.render(out,result,original,cleaned);window.exported=out.toDataURL();});assert.equal(await page.evaluate(()=>exported),normal,'Export must use page fonts');
 await page.evaluate(async()=>{lightweightDisplay=true;await draw();});assert((await page.evaluate(()=>result.regions.map(r=>r._fontId))).every(id=>id==='default'));
 await page.evaluate(async()=>{lightweightDisplay=false;await draw();});assert.deepEqual(await effective(),[['serif',700],['serif',700],['serif',700]]);
 await page.locator('#page-font-settings summary').click();await page.selectOption('#page-font-family','auto');await page.selectOption('#page-font-weight','auto');await page.evaluate(()=>draw());assert.deepEqual(await effective(),[['dialogue',400],['dialogue',400],['dialogue',400]]);assert.equal(await page.evaluate(()=>Object.hasOwn(result,'fontDefaults')),false);
 await page.screenshot({path:'research/page-fonts-2026-11-04/editor.png',fullPage:true});assert.deepEqual(errors,[]);console.log('PASS page font/weight precedence, Ctrl/Shift/all selection, selected-only changes, auto reset, save/reopen, export, lightweight, unmoved boxes');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
