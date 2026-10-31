const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
const extension=path.resolve(__dirname,'../extension');
(async()=>{
 const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});
 try{
  const page=await browser.newPage();await page.route('https://names.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="manga"></div>'}));
  await page.addInitScript(()=>{
   const canvas=document.createElement('canvas');canvas.width=400;canvas.height=600;const drawing=canvas.getContext('2d');drawing.fillStyle='white';drawing.fillRect(0,0,400,600);
   const original=canvas.toDataURL(),result={width:400,height:600,target:'Korean',regions:[{id:1,type:'text',bbox:[100,100,240,180],box:[100,100,240,180],mode:'white',fontSize:22,text:'チロル',translation:'치로루'}]};
   const previous=JSON.parse(localStorage.getItem('names-fixture')||'null');
   window.fixture={original,work:{id:'work',title:'Test',revision:'one',entries:[{source:'チロル',translation:'티롤'}]},items:previous||[1,2].map(index=>({key:'key'+index,id:'job'+index,sourceURL:original+'#'+index,result:structuredClone(result)})),other:{id:'other-job',result:structuredClone(result)},listeners:[],changes:[],requests:0,submits:0,hold:false,fail:false,remembered:0};
   window.call=message=>new Promise(resolve=>fixture.listeners[0]({type:'control',...message},null,resolve));
   window.deliver=message=>new Promise(resolve=>fixture.listeners[0](message,null,resolve));
   window.chrome={storage:{onChanged:{addListener:listener=>fixture.changes.push(listener)}},runtime:{onMessage:{addListener:listener=>fixture.listeners.push(listener)},sendMessage:async message=>{
    let value;
    if(message.type==='settings')value={selector:'#manga img',displayMode:'auto'};
    else if(message.type==='restore')value=structuredClone(fixture.items);
    else if(message.type==='namesContext')value={work:fixture.work};
    else if(message.type==='namesTargets')value=[structuredClone(fixture.other)];
    else if(message.type==='namesRememberTarget'){fixture.other.result=message.result;value=true;}
    else if(message.type==='namesCorrect'){
     fixture.requests++;while(fixture.hold)await new Promise(resolve=>setTimeout(resolve,10));if(fixture.fail)return{ok:false,error:'서버 409: busy'};
     const copy=structuredClone(message.result);let changed=0;for(const region of copy.regions)if(region.translation==='치로루'){region.nameEdit={before:region.translation,after:'티롤',work:'work'};region.translation='티롤';changed++;}value={result:copy,changed,warnings:[]};
    }else if(message.type==='asset'||message.type==='thumbnail')value=original;
    else if(message.type==='remember'){fixture.items=fixture.items.filter(item=>item.key!==message.key);fixture.items.push(structuredClone(message));fixture.remembered++;localStorage.setItem('names-fixture',JSON.stringify(fixture.items));value=true;}
    else if(message.type==='connect')value=await call({action:'scan'});
    else if(message.type==='control')value=await call(message);
    else if(message.type==='submit'){fixture.submits++;throw Error('Unexpected OCR submission');}
    else throw Error(message.type);
    return {ok:true,value};
   }}};window.MangaPagePanel={root:document,tabId:1,isOpen:()=>true};
  });
  async function load(){await page.goto('https://names.test/work-chapter-1.html');await page.evaluate(html=>{document.body.prepend(new DOMParser().parseFromString(html,'text/html').querySelector('main'));for(let index=1;index<=2;index++){const image=document.createElement('img');image.src=fixture.original+'#'+index;image.width=400;image.height=600;image.alt='Page '+index;document.getElementById('manga').append(image);}},fs.readFileSync(path.join(extension,'panel.html'),'utf8'));for(const file of ['names.js','render.js','content.js','panel.js'])await page.addScriptTag({path:path.join(extension,file)});await page.waitForFunction(async()=>{const state=await call({action:'status'});return state.items.length===2&&state.items.every(item=>item.state.includes('복원'))&&!state.displayBusy;});await page.waitForFunction(()=>!document.getElementById('names-correct').disabled);}
  async function settle(){await page.waitForTimeout(250);await page.waitForFunction(async()=>{const state=await call({action:'status'});return !state.running&&!state.nameBusy&&!state.displayBusy&&state.nameMessage;});await page.waitForTimeout(100);}
  const translations=()=>page.evaluate(()=>fixture.items.sort((first,second)=>first.key.localeCompare(second.key)).map(item=>item.result.regions[0].translation));
  await load();await page.locator('#all input').uncheck();await page.locator('#names-correct').click();await settle();assert.deepEqual(await translations(),['티롤','티롤']);assert.equal(await page.evaluate(()=>fixture.other.result.regions[0].translation),'티롤');assert.equal(await page.evaluate(()=>fixture.submits),0);
  const exported=await page.evaluate(()=>call({action:'export',key:'key1'}));assert(exported.data.startsWith('data:image/png'));
  await load();assert.deepEqual(await translations(),['티롤','티롤']);await page.locator('#names-undo').click();await settle();assert.deepEqual(await translations(),['치로루','치로루']);
  await page.evaluate(()=>{fixture.hold=true;});await page.locator('#names-correct').click();await page.waitForFunction(()=>fixture.requests>0);await page.locator('#stop').click();await page.evaluate(()=>fixture.hold=false);await settle();assert.deepEqual(await translations(),['치로루','치로루']);
  await page.evaluate(()=>{fixture.fail=true;});await page.locator('#names-correct').click();await settle();assert.deepEqual(await translations(),['치로루','치로루']);assert.match((await page.evaluate(()=>call({action:'status'}))).nameMessage,/409|대기/);
  await page.evaluate(()=>{fixture.fail=false;fixture.hold=true;fixture.requests=0;});await page.locator('#names-correct').click();await page.waitForFunction(()=>fixture.requests>0);await page.evaluate(async()=>{const edited=structuredClone(fixture.items.find(item=>item.key==='key1').result);edited.regions[0].translation='수동 편집';await deliver({type:'applyEdited',key:'key1',result:edited});fixture.hold=false;});await settle();assert.deepEqual(await translations(),['수동 편집','치로루']);
  await page.locator('#names-correct').click();await settle();assert.deepEqual(await translations(),['수동 편집','티롤']);await page.evaluate(async()=>{const edited=structuredClone(fixture.items.find(item=>item.key==='key2').result);edited.regions[0].translation='교정 후 편집';await deliver({type:'applyEdited',key:'key2',result:edited});});await page.locator('#names-undo').click();await settle();assert.deepEqual(await translations(),['수동 편집','교정 후 편집']);
  console.log('PASS browser correction/reflow/export/reload, all pages regardless of selection, other cached chapter, undo, cancellation, busy failure/retry and manual edit races');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
