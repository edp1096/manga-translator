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
   const context=canvas.getContext('2d');context.fillStyle='#456';context.fillRect(0,0,400,600);
   const original=canvas.toDataURL(),runs=[];for(let row=11;row<25;row++)runs.push(row*40+6,23);
   const geometry={version:3,width:400,height:600,bubbles:[{width:40,height:60,runs,bbox:[48,98,302,262],confidence:.96}]};
   const result={width:400,height:600,regions:[
    {id:1,type:'text',bbox:[110,135,250,195],box:[110,135,250,195],mode:'tooltip',fontSize:24,text:'Original',translation:'Translated'},
    {id:2,type:'effect',bbox:[310,300,390,370],box:[310,300,390,370],mode:'tooltip',fontSize:24,text:'Effect',translation:'Sound'},
    {id:3,type:'text',bbox:[10,400,100,470],box:[10,400,100,470],mode:'tooltip',fontSize:24,text:'Uncertain',translation:'Uncertain'}
   ]};
   const stored=JSON.parse(localStorage.getItem('fixture')||'null');
   window.fixture={original,geometry,result,mode:stored?.mode||'auto',outside:stored?.outside||'tooltip',items:stored?.items||[1,2].map(index=>({id:'job'+index,key:'key'+index,sourceURL:original+'#'+index,result:structuredClone(result)})),restores:0,holdRestore:false,failRestore:false,requests:0,submits:0,concurrent:0,maximum:0,hold:false,fail:false,listeners:[],changes:[],edited:null};
   const persist=()=>localStorage.setItem('fixture',JSON.stringify({mode:fixture.mode,outside:fixture.outside,items:fixture.items}));
   window.call=message=>new Promise(resolve=>fixture.listeners[0]({type:'control',...message},null,resolve));
   window.chrome={storage:{onChanged:{addListener:listener=>fixture.changes.push(listener)}},runtime:{onMessage:{addListener:listener=>fixture.listeners.push(listener)},sendMessage:async message=>{
    let value;
    if(message.type==='settings')value={selector:'#manga img',displayMode:fixture.mode,outsideTextMode:fixture.outside};
    else if(message.type==='restore')value=structuredClone(fixture.items);
    else if(message.type==='asset'||message.type==='thumbnail')value=original;
    else if(message.type==='remember'){fixture.items=fixture.items.filter(item=>item.sourceURL!==message.sourceURL);fixture.items.push(structuredClone(message));persist();value=true;}
    else if(message.type==='displayMode'){fixture.mode=message.mode;persist();fixture.changes.forEach(listener=>listener({displayMode:{newValue:message.mode}},'local'));value=message.mode;}
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
   for(const file of ['render.js','content.js','panel.js'])await page.addScriptTag({path:path.join(extension,file)});
   await page.waitForFunction(async()=>{const state=await call({action:'status'});return state.items.filter(item=>item.done).every(item=>item.state.includes('복원'))&&!state.displayBusy;});
  }
  const settled=async()=>{
   const mode=await page.locator('#display-mode').inputValue(),outside=await page.locator('#outside-text-mode').inputValue();let stable=0;
   for(let attempt=0;attempt<300;attempt++){
    const state=await page.evaluate(()=>call({action:'status'}));
    if(state.displayMode===mode&&state.outsideTextMode===outside&&!state.running&&!state.displayBusy&&!state.displayPaused&&!state.items.some(item=>item.state.includes('불러오는 중'))){if(++stable===3)return;}else stable=0;
    await page.waitForTimeout(50);
   }
   throw Error('Display did not settle');
  };
  const canvas=()=>page.locator('[data-manga-translator-overlay] canvas').first().evaluate(node=>node.toDataURL());
  await load();const before=await canvas();
  await page.locator('#all input').uncheck();
  await page.locator('#display-mode').selectOption('white');await settled();
  await page.waitForFunction(()=>document.querySelectorAll('[data-tip]').length===4);
  const after=await canvas();assert.notEqual(after,before);
  assert.equal(await page.evaluate(()=>fixture.requests),2);assert.equal(await page.evaluate(()=>fixture.maximum),1);
  assert.equal(await page.evaluate(()=>fixture.submits),0);
  assert(await page.evaluate(()=>fixture.items.every(item=>item.result.regions[0].mode==='tooltip'&&item.bubbles)),'Automatic display overwrote saved modes');
  const exported=await page.evaluate(()=>call({action:'export',key:'key1'}));assert.equal(exported.data,after);
  await page.evaluate(()=>call({action:'edit',key:'key1'}));
  assert.deepEqual(await page.evaluate(()=>[fixture.edited.result.regions[0].mode,fixture.edited.baseResult.regions[0].mode]),['white','tooltip']);
  const editing=await page.evaluate(()=>{
   const edited=structuredClone(fixture.edited.result);edited.regions[0].translation='Changed';
   const preserved=MangaRender.editedBase(edited,fixture.edited.baseResult);
   edited.regions[0].displayOverride=true;edited.regions[0].mode='tooltip';
   const overridden=MangaRender.editedBase(edited,fixture.edited.baseResult);
   return {preserved,overridden,display:MangaRender.presentation(overridden,'white',fixture.geometry)};
  });
  assert.equal(editing.preserved.regions[0].translation,'Changed');assert.equal(editing.preserved.regions[0].mode,'tooltip');
  assert.equal(editing.display.regions[0].mode,'tooltip');
  await load();await settled();assert.equal(await canvas(),after);assert.equal(await page.evaluate(()=>fixture.requests),0);
  await page.locator('#display-mode').selectOption('auto');await settled();assert.equal(await canvas(),before);
  await page.locator('#display-mode').selectOption('white');await settled();
  await page.evaluate(async()=>{const state=await call({action:'status'});await call({action:'run',keys:[state.items[2].key]});});
  await page.waitForFunction(()=>fixture.submits===1);await settled();
  await page.waitForFunction(()=>document.querySelectorAll('[data-tip]').length===6);assert.equal(await page.evaluate(()=>fixture.requests),1);
  await page.evaluate(()=>{localStorage.removeItem('fixture');});await load();
  await page.evaluate(()=>fixture.hold=true);await page.locator('#display-mode').selectOption('white');
  await page.waitForFunction(()=>fixture.requests===1);await page.locator('#display-mode').selectOption('auto');
  await page.evaluate(()=>fixture.hold=false);await settled();assert.equal(await canvas(),before);
  await page.evaluate(()=>fixture.fail=true);await page.locator('#display-mode').selectOption('white');
  await page.waitForFunction(async()=>(await call({action:'status'})).displayPaused);
  assert.equal(await canvas(),before);assert.equal(await page.evaluate(async()=>(await call({action:'status'})).items.filter(item=>item.error).length),0);
  await page.waitForFunction(()=>!document.getElementById('display-retry').hidden&&!document.getElementById('display-retry').disabled);
  await page.evaluate(()=>fixture.fail=false);await page.locator('#display-retry').click();await settled();
  assert(await canvas()===after,'Retry did not restore white output');
  await page.evaluate(()=>{const saved=JSON.parse(localStorage.getItem('fixture'));saved.items[0].bubbles.version=2;localStorage.setItem('fixture',JSON.stringify(saved));});
  await load();await settled();assert.equal(await page.evaluate(()=>fixture.requests),1,'Legacy geometry was not refreshed exactly once');
  await load();await settled();assert.equal(await page.evaluate(()=>fixture.requests),0,'Current geometry was unnecessarily refreshed');
  // The panel switch changes cached results, independently of bubble display.
  const requestsBefore=await page.evaluate(()=>fixture.requests);
  await page.selectOption('#outside-text-mode','white');await settled();
  await page.waitForFunction(()=>document.querySelectorAll('[data-tip]').length===2);
  const both=await canvas();assert.notEqual(both,after);assert.equal(await page.evaluate(()=>fixture.requests),requestsBefore);
  assert.equal(await page.evaluate(()=>fixture.submits),0);
  assert.equal((await page.evaluate(()=>call({action:'export',key:'key1'}))).data,both);
  await page.evaluate(()=>call({action:'edit',key:'key1'}));
  assert.deepEqual(await page.evaluate(()=>[fixture.edited.outsideTextMode,fixture.edited.result.regions[2].mode,fixture.edited.baseResult.regions[2].mode]),['white','white','tooltip']);
  await load();await settled();assert.equal(await page.locator('#outside-text-mode').inputValue(),'white');assert.equal(await canvas(),both);
  await page.locator('#display-mode').selectOption('auto');await settled();
  const outsideOnly=await canvas();assert.notEqual(outsideOnly,both);assert.notEqual(outsideOnly,before);
  await page.selectOption('#outside-text-mode','tooltip');await settled();assert.equal(await canvas(),before);
  // Other-tab changes must not produce a mixture of settings during ZIP export.
  await page.evaluate(async()=>{await call({action:'exportStart'});fixture.changes.forEach(listener=>listener({outsideTextMode:{newValue:'white'}},'local'));fixture.changes.forEach(listener=>listener({displayMode:{newValue:'white'}},'local'));});
  assert.equal(await canvas(),before);
  const deferred=await page.evaluate(()=>call({action:'exportEnd'}));assert.equal(deferred.outsideTextMode,'white');assert.equal(deferred.displayMode,'white');
  await page.waitForFunction(()=>document.querySelectorAll('[data-tip]').length===2);assert.equal(await canvas(),both);
  await page.evaluate(()=>{localStorage.removeItem('fixture');});await load();
  await page.evaluate(()=>fixture.hold=true);await page.selectOption('#outside-text-mode','white');
  await page.waitForFunction(()=>fixture.requests===1);await page.selectOption('#outside-text-mode','tooltip');
  await page.evaluate(()=>fixture.hold=false);await settled();assert.equal(await canvas(),before);
  await page.selectOption('#outside-text-mode','white');await settled();
  await page.evaluate(async()=>{const state=await call({action:'status'});await call({action:'run',keys:[state.items[2].key]});});
  await page.waitForFunction(()=>fixture.submits===1);await settled();
  await page.waitForFunction(()=>document.querySelectorAll('[data-tip]').length===6);
  assert.equal(await canvas(),outsideOnly);
  await page.evaluate(()=>{localStorage.removeItem('fixture');});await load();
  await page.selectOption('#outside-text-mode','restore');await settled();
  const restored=await canvas();assert.notEqual(restored,before);assert.notEqual(restored,outsideOnly);
  assert.equal(await page.evaluate(()=>fixture.restores),2);assert.equal(await page.evaluate(()=>fixture.submits),0);
  assert.equal((await page.evaluate(()=>call({action:'export',key:'key1'}))).data,restored);
  await page.evaluate(()=>call({action:'edit',key:'key1'}));assert.equal(await page.evaluate(()=>fixture.edited.result.regions[2].mode),'restore');
  await page.selectOption('#outside-text-mode','tooltip');await settled();assert.equal(await canvas(),before);
  await page.selectOption('#outside-text-mode','restore');await settled();assert.equal(await canvas(),restored);assert.equal(await page.evaluate(()=>fixture.restores),2);
  await load();await settled();if((await canvas())!==restored){console.log('RELOAD_DEBUG',JSON.stringify(await page.evaluate(async()=>({state:await call({action:'status'}),restores:fixture.restores,outside:fixture.outside,items:fixture.items.map(i=>({key:i.key,regions:i.result.regions}))}))));fs.mkdirSync(path.join(__dirname,'../research/manga-lama-auto-2026-10-28/results'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../research/manga-lama-auto-2026-10-28/results/reload-actual.png'),Buffer.from((await canvas()).split(',')[1],'base64'));fs.writeFileSync(path.join(__dirname,'../research/manga-lama-auto-2026-10-28/results/reload-expected.png'),Buffer.from(restored.split(',')[1],'base64'));throw Error('Restoration reload pixels differ');}
  await page.evaluate(()=>{localStorage.removeItem('fixture');});await load();await page.evaluate(()=>fixture.holdRestore=true);
  await page.selectOption('#outside-text-mode','restore');await page.waitForFunction(()=>fixture.restores===1);
  await page.selectOption('#outside-text-mode','tooltip');await page.evaluate(()=>fixture.holdRestore=false);await settled();assert.equal(await canvas(),before);
  await page.evaluate(()=>fixture.failRestore=true);await page.selectOption('#outside-text-mode','restore');await page.waitForFunction(async()=>(await call({action:'status'})).displayPaused);assert.equal(await canvas(),before);
  await page.evaluate(()=>fixture.failRestore=false);await page.locator('#display-retry').click();await settled();assert.equal(await canvas(),restored);
  await page.evaluate(async()=>{const state=await call({action:'status'});await call({action:'run',keys:[state.items[2].key]});});await page.waitForFunction(()=>fixture.submits===1);await settled();
  assert.equal(await canvas(),restored);
  console.log(JSON.stringify({ok:true,browser:browser.version(),allPagesWithoutSelection:true,sequential:true,noRetranslation:true,basePreserved:true,exportParity:true,editorPreservesOverrides:true,reloadCached:true,reversible:true,newTranslationInherits:true,staleReplyIgnored:true,busyRetry:true,outsideSwitch:true,independentModes:true,outsideExportEditorParity:true,deferredSettings:true,outsideStaleReplyIgnored:true,restorationCached:true,restorationExportEditorParity:true,restorationStaleReplyIgnored:true,restorationBusyRetry:true,restorationNewTranslation:true}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
