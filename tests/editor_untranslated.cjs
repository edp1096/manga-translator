const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://draft.test/**',r=>r.fulfill({contentType:'text/html',body:'<img id="one"><img id="two">'}));await page.goto('https://draft.test/');
 await page.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=400;c.height=600;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,400,600);const data=c.toDataURL();for(const img of document.images){img.src=data;await img.decode();}
  window.listeners=[];window.fixture={calls:[],fail:true,wait:false,saved:[],edits:[]};
  window.chrome={storage:{onChanged:{addListener(){}}},runtime:{onMessage:{addListener:f=>listeners.push(f)},sendMessage:async m=>{
   fixture.calls.push(m.type);let value;
   if(m.type==='settings')value={selector:'img',target:'Korean',lightweightDisplay:true};
   else if(m.type==='restore')value=[];
   else if(m.type==='createDraft'){
    if(fixture.wait)await new Promise(resolve=>fixture.release=resolve);
    if(fixture.fail){fixture.fail=false;return{ok:false,error:'draft upload failed'};}
    value={id:crypto.randomUUID(),result:{width:400,height:600,target:'Korean',regions:[],manualDraft:true,displayVersion:2}};
   }else if(m.type==='submit')value={id:'automatic-translation'};
   else if(m.type==='status')value={status:'done',result:{width:400,height:600,target:'Korean',regions:[{id:1,type:'text',bbox:[40,40,200,140],box:[40,40,200,140],text:'source',translation:'자동 번역',mode:'replace',fontSize:24,color:'#111'}]}};
   else if(m.type==='asset')value=data;
   else if(m.type==='remember'){fixture.saved.push(structuredClone(m));value=true;}
   else if(m.type==='edit'){fixture.edits.push(structuredClone(m));value=true;}
   else throw Error('Unexpected '+m.type);
   return{ok:true,value};
  }}};
  window.call=m=>new Promise(resolve=>listeners[0]({type:'control',...m},null,resolve));
 });
 for(const file of ['polygon.js','rotation.js','fonts.js','render.js','content.js'])await page.addScriptTag({path:path.join(__dirname,'../extension',file)});
 let status=await page.evaluate(()=>call({action:'scan'}));assert.equal(status.items.length,2);assert(status.items.every(i=>!i.done));const key=status.items[0].key;
 const failed=await page.evaluate(key=>call({action:'edit',key}),key);assert.equal(failed.error,'draft upload failed');status=await page.evaluate(()=>call({action:'status'}));assert(!status.editing&&!status.items[0].done);assert.equal(status.items[0].state,'대기');assert.equal(await page.evaluate(()=>fixture.saved.length),0);
 await page.evaluate(key=>{fixture.wait=true;window.pendingEdit=call({action:'edit',key})},key);await page.waitForFunction(()=>fixture.release);
 status=await page.evaluate(()=>call({action:'status'}));assert(status.editing);assert.match((await page.evaluate(key=>call({action:'edit',key}),key)).error,/준비/);assert.match((await page.evaluate(key=>call({action:'run',keys:[key]}),key)).error,/준비/);
 await page.evaluate(()=>fixture.release());await page.evaluate(()=>pendingEdit);await page.waitForFunction(async()=>!(await call({action:'status'})).displayBusy);
 const edit=await page.evaluate(()=>fixture.edits[0]);assert(edit.result.manualDraft);assert.deepEqual(edit.result.regions,[]);assert.deepEqual(edit.baseResult.regions,[]);assert.equal(await page.evaluate(()=>fixture.calls.filter(t=>t==='submit').length),0);
 status=await page.evaluate(()=>call({action:'status'}));assert(!status.items[0].done);assert.match(status.items[0].state,/미번역/);
 await page.evaluate(key=>call({action:'edit',key}),key);assert.equal(await page.evaluate(()=>fixture.calls.filter(t=>t==='createDraft').length),2,'reopen reuses draft; count includes failed request');
 const applied=await page.evaluate(async key=>{const result=structuredClone(fixture.edits[0].result);result.regions.push({id:'manual',manual:true,bbox:[40,40,200,140],box:[40,40,200,140],text:'',translation:'수동 번역',fontSize:24,color:'#111',mode:'replace'});return call({type:'applyEdited',key,result});},key);assert(!applied.error,applied.error);
 status=await page.evaluate(()=>call({action:'status'}));assert(status.items[0].done);assert(!status.items[1].done);assert.equal(await page.evaluate(()=>fixture.saved.at(-1).result.regions[0].translation),'수동 번역');
 await page.evaluate(key=>call({action:'run',keys:[key]}),key);await page.waitForFunction(async()=>!(await call({action:'status'})).running&&fixture.saved.at(-1).id==='automatic-translation');assert.equal(await page.evaluate(()=>fixture.calls.filter(t=>t==='submit').length),1);assert.equal(await page.evaluate(()=>fixture.saved.at(-1).result.manualDraft),undefined);await page.waitForFunction(async()=>!(await call({action:'status'})).displayBusy);await page.evaluate(key=>call({action:'edit',key}),key);assert.equal(await page.evaluate(()=>fixture.calls.filter(t=>t==='createDraft').length),2);
 assert.deepEqual(errors,[]);console.log('PASS untranslated editor, failed upload rollback, duplicate/busy guard, draft reuse, zero-region state and manual apply, full translation afterward and existing-result reuse');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
