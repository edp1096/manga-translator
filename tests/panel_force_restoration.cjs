const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
const extension=path.resolve(__dirname,'../extension');
(async()=>{
 const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:process.env.MANGA_HEADED!=='1'});
 try{
  const page=await browser.newPage();
  page.on('pageerror',error=>console.error('Page error:',error));
  await page.route('https://display.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="manga"></div>'}));
  await page.addInitScript(()=>{
   const canvas=document.createElement('canvas');canvas.width=400;canvas.height=600;
   const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,400,600);context.fillStyle='#111';context.font='18px sans-serif';context.fillText('Original',120,170);context.fillText('Sound',320,335);context.fillText('Outside',20,440);
   const original=canvas.toDataURL(),runs=[];for(let row=11;row<25;row++)runs.push(row*40+6,23);
   const geometry={version:3,width:400,height:600,bubbles:[{width:40,height:60,runs,bbox:[48,98,302,262],confidence:.96}]};
   const result={width:400,height:600,regions:[
    {id:1,type:'text',bbox:[110,135,250,195],box:[110,135,250,195],mode:'tooltip',fontSize:24,text:'Original',translation:'Translated'},
    {id:2,type:'effect',bbox:[310,300,390,370],box:[310,300,390,370],mode:'tooltip',fontSize:24,text:'Effect',translation:'Sound'},
    {id:3,type:'text',bbox:[10,400,100,470],box:[10,400,100,470],mode:'tooltip',fontSize:24,text:'Uncertain',translation:'Uncertain'}
   ]};
   const stored=JSON.parse(localStorage.getItem('fixture')||'null');
   window.fixture={original,geometry,result,mode:stored?.mode||'auto',outside:stored?.outside||'tooltip',light:stored?.light||false,force:stored?.force||false,manualCalls:0,patches:stored?.patches||{},items:stored?.items||[1,2].map(index=>({id:'11111111-1111-4111-8111-'+String(index).padStart(12,'0'),key:'key'+index,sourceURL:original+'#'+index,result:structuredClone(result)})),restores:0,holdRestore:false,failRestore:false,requests:0,submits:0,concurrent:0,maximum:0,hold:false,fail:false,listeners:[],changes:[],edited:null};
   const persist=()=>localStorage.setItem('fixture',JSON.stringify({mode:fixture.mode,outside:fixture.outside,light:fixture.light,force:fixture.force,patches:fixture.patches,items:fixture.items}));
   window.call=message=>new Promise(resolve=>fixture.listeners[0]({type:'control',...message},null,resolve));
   window.chrome={storage:{onChanged:{addListener:listener=>fixture.changes.push(listener)}},runtime:{onMessage:{addListener:listener=>fixture.listeners.push(listener)},sendMessage:async message=>{
    let value;
    if(message.type==='settings')value={selector:'#manga img',displayMode:fixture.mode,outsideTextMode:fixture.outside,lightweightDisplay:fixture.light,forceTooltipRestoration:fixture.force};
    else if(message.type==='restore')value=structuredClone(fixture.items);
    else if(message.type==='asset'||message.type==='thumbnail')value=fixture.patches[message.name]||original;
    else if(message.type==='forceTooltipRestoration'){fixture.force=message.enabled;persist();fixture.changes.forEach(listener=>listener({forceTooltipRestoration:{newValue:fixture.force}},'local'));value=fixture.force;}
    else if(message.type==='manualRestoration'){
     fixture.manualCalls++;while(fixture.holdManual)await new Promise(resolve=>setTimeout(resolve,10));if(fixture.failManual)return {ok:false,error:'test restoration failed'};
     const mask=message.mask,b=mask.bounds,c=document.createElement('canvas');c.width=b[2]-b[0];c.height=b[3]-b[1];const ctx=c.getContext('2d');ctx.fillStyle='#abc';ctx.fillRect(0,0,c.width,c.height);const asset='manual-'+fixture.manualCalls.toString(16).padStart(32,'0')+'.png';fixture.patches[asset]=c.toDataURL();value={version:1,width:400,height:600,mask,asset};persist();
    }
    else if(message.type==='remember'){fixture.items=fixture.items.filter(item=>item.sourceURL!==message.sourceURL);fixture.items.push(structuredClone(message));persist();value=true;}
    else if(message.type==='displayMode'){fixture.mode=message.mode;persist();fixture.changes.forEach(listener=>listener({displayMode:{newValue:message.mode}},'local'));value=message.mode;}
    else if(message.type==='lightweightDisplay'){fixture.light=message.enabled;persist();fixture.changes.forEach(listener=>listener({lightweightDisplay:{newValue:fixture.light}},'local'));value=fixture.light;}
    else if(message.type==='outsideTextMode'){fixture.outside=message.mode;persist();fixture.changes.forEach(listener=>listener({outsideTextMode:{newValue:message.mode}},'local'));value=message.mode;}
    else if(message.type==='restoration'){
     fixture.restores++;while(fixture.holdRestore)await new Promise(resolve=>setTimeout(resolve,10));if(fixture.failRestore)return {ok:false,error:'서버 409: busy'};
     const bounds=[10,400,100,470],runs=[];for(let y=0;y<70;y++)runs.push(y*90,25);value={version:1,width:400,height:600,asset:'restored-v1.png',regions:[{id:3,sourceText:result.regions[2].text,sourceBox:result.regions[2].bbox,bounds,runs}]};
    }
    else if(message.type==='bubbles'){
     fixture.requests++;fixture.concurrent++;fixture.maximum=Math.max(fixture.maximum,fixture.concurrent);
     while(fixture.hold)await new Promise(resolve=>setTimeout(resolve,10));
     await new Promise(resolve=>setTimeout(resolve,70));fixture.concurrent--;
     if(fixture.fail)return {ok:false,error:'서버 409: busy'};
     value=geometry;
    }
    else if(message.type==='connect')value=await call({action:'scan'});
    else if(message.type==='control')value=await call(message);
    else if(message.type==='edit'){fixture.edited=structuredClone(message);value=true;}
    else if(message.type==='submit'){fixture.submits++;value={id:'new-job'};}
    else if(message.type==='status')value={status:'done',result:structuredClone(result)};
    else throw Error(message.type);
    return {ok:true,value};
   }}};
   window.MangaPagePanel={root:document,tabId:1,isOpen:()=>true};
  });
  async function load(){
   await page.goto('https://display.test/chapter');
   await page.evaluate(html=>{
    const parsed=new DOMParser().parseFromString(html,'text/html');document.body.prepend(parsed.querySelector('main'));
    for(let index=1;index<=3;index++){const image=document.createElement('img');image.src=fixture.original+'#'+index;image.alt='Page '+index;image.width=400;image.height=600;document.getElementById('manga').append(image);}
   },fs.readFileSync(path.join(extension,'panel.html'),'utf8'));
   for(const file of ['polygon.js','rotation.js','render.js','content.js','panel.js'])await page.addScriptTag({path:path.join(extension,file)});
   await page.waitForFunction(async()=>{const state=await call({action:'status'});return state.items.filter(item=>item.done).every(item=>item.state.includes('복원'))&&!state.displayBusy;});
  }
  const settled=async()=>{
   const mode=await page.locator('#display-mode').inputValue(),outside=await page.locator('#outside-text-mode').inputValue();let stable=0;
   for(let attempt=0;attempt<300;attempt++){
    const state=await page.evaluate(()=>call({action:'status'}));
    if(state.forceTooltipRestoration===await page.locator('#force-tooltip-restoration').isChecked()&&state.displayMode===mode&&state.outsideTextMode===outside&&!state.running&&!state.displayBusy&&!state.displayPaused&&!state.items.some(item=>item.state.includes('불러오는 중'))){if(++stable===3)return;}else stable=0;
    await page.waitForTimeout(50);
   }
   throw Error('Display did not settle');
  };
  const canvas=()=>page.locator('[data-manga-translator-overlay] canvas').first().evaluate(node=>node.toDataURL());
  await load();await settled();
  // The opt-in covers inside and outside dialogue, never effects; disabling is reversible.
  await page.evaluate(()=>localStorage.removeItem('fixture'));await load();await settled();const fallback=await canvas();
  await page.locator('#force-tooltip-restoration').check();await settled();
  assert.equal(await page.evaluate(()=>fixture.manualCalls),4);assert.notEqual(await canvas(),fallback);
  const forcedCanvas=await canvas();assert(await page.evaluate(()=>fixture.items.every(x=>Object.keys(x.result.forcedRestorations).length===2)));
  assert(await page.evaluate(()=>fixture.items.every(x=>x.result.regions.every(r=>r.mode==='tooltip'))),'Base display modes mutated');
  await page.locator('#force-tooltip-restoration').uncheck();await settled();assert.equal(await canvas(),fallback);
  await page.locator('#force-tooltip-restoration').check();await settled();assert.equal(await canvas(),forcedCanvas);assert.equal(await page.evaluate(()=>fixture.manualCalls),4);
  await page.locator('#lightweight-display').check();await settled();assert(await page.locator('#force-tooltip-restoration').isDisabled());assert.equal(await canvas(),fallback);
  await page.locator('#lightweight-display').uncheck();await settled();assert.equal(await canvas(),forcedCanvas);
  await load();await settled();assert(await page.locator('#force-tooltip-restoration').isChecked());assert.equal(await page.evaluate(()=>fixture.manualCalls),0);assert.equal(await canvas(),forcedCanvas);
  await page.evaluate(()=>localStorage.removeItem('fixture'));await load();await settled();await page.evaluate(()=>fixture.holdManual=true);
  await page.locator('#force-tooltip-restoration').check();await page.waitForFunction(()=>fixture.manualCalls===1);await page.locator('#force-tooltip-restoration').uncheck();await page.evaluate(()=>fixture.holdManual=false);await settled();assert.equal(await canvas(),fallback);assert.equal(await page.evaluate(()=>fixture.manualCalls),1);
  await page.evaluate(()=>fixture.failManual=true);await page.locator('#force-tooltip-restoration').check();await settled();assert.equal(await canvas(),fallback);assert.match((await page.evaluate(()=>call({action:'status'}))).displayMessage,/보류 4곳/);
  if(process.env.MANGA_TEST_SCREENSHOT){await page.evaluate(({html,css})=>{const doc=new DOMParser().parseFromString(html,'text/html'),style=document.createElement('style');style.textContent=css+doc.querySelector('style').textContent;document.head.append(style);}, {html:fs.readFileSync(path.join(extension,'panel.html'),'utf8'),css:fs.readFileSync(path.join(extension,'ui.css'),'utf8')});await page.setViewportSize({width:420,height:900});await page.waitForTimeout(1700);await page.screenshot({path:process.env.MANGA_TEST_SCREENSHOT});}
  console.log('PASS forced inside/outside dialogue, effect exclusion, reversible toggle, cache reload, lightweight suppression, stale reply, failure fallback');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
