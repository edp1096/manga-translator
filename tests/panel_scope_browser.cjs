// Run with MANGA_PLAYWRIGHT pointing to a Playwright installation.
// Uses an isolated Chromium profile and a temporary copy of the extension.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'manga-panel-scope-')),extension=path.join(root,'extension');fs.cpSync(path.join(__dirname,'../extension'),extension,{recursive:true});
 const scope=path.join(extension,'panel_scope.js');fs.writeFileSync(scope,fs.readFileSync(scope,'utf8').replace('chrome.action.onClicked.addListener(openPanel);','globalThis.__testOpenPanel=openPanel;chrome.action.onClicked.addListener(openPanel);').replace('  ready.then(async()=>{','  globalThis.__testScopeReady=ready.then(async()=>{'));
 fs.writeFileSync(path.join(extension,'background.js'),`globalThis.__testEvents=[];chrome.sidePanel.onOpened.addListener(info=>__testEvents.push({type:'opened',info}));chrome.sidePanel.onClosed.addListener(info=>__testEvents.push({type:'closed',info}));globalThis.__testErrors=[];console.error=(...args)=>__testErrors.push(args.join(' '));importScripts('panel_scope.js');chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.type==='test-open-panel'){__testOpenPanel(sender.tab).then(()=>reply({done:true}));return true;}});`);
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Panel scope test</title><h1>Test manga page</h1>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let context;
 try{
  context=await chromium.launchPersistentContext(path.join(root,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const base='http://127.0.0.1:'+server.address().port;
  const first=await context.newPage();await first.goto(base+'/a');await first.bringToFront();
  const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,base+'/a');
  const fullWidth=await worker.evaluate(async id=>(await chrome.tabs.get(id)).width,tabId);
  const visible=async(id,open)=>worker.evaluate(async({id,open,fullWidth})=>{for(let n=0;n<100;n++){const w=(await chrome.tabs.get(id)).width;if(open?w<fullWidth:w===fullWidth)return;await new Promise(r=>setTimeout(r,50));}throw Error('Panel visibility timeout: '+id+' '+open);},{id,open,fullWidth});
  const closePanel=async id=>{
   // close() resolves before Chrome's closing animation and onClosed event.
   // Wait for the completed native close before testing a later tab switch.
   await worker.evaluate(async id=>{
    const count=()=>__testEvents.filter(e=>e.type==='closed'&&e.info.tabId===id).length,before=count();
    await chrome.sidePanel.close({tabId:id});
    for(let n=0;n<100;n++){if(count()>before)return;await new Promise(r=>setTimeout(r,50));}
    throw Error('Native close event timeout');
   },id);
   await visible(id,false);
  };
  await worker.evaluate(async id=>chrome.scripting.executeScript({target:{tabId:id},func:()=>{let button=document.createElement('button');button.id='open-panel-test';button.textContent='Open panel';button.onclick=()=>{chrome.runtime.sendMessage({type:'test-open-panel'},()=>button.dataset.done='true')};document.body.append(button);}}),tabId);
  await first.locator('#open-panel-test').click();await first.waitForFunction(()=>document.querySelector('#open-panel-test')?.dataset.done==='true');
  let options=await worker.evaluate(id=>chrome.sidePanel.getOptions({tabId:id}),tabId);let errors=await worker.evaluate(()=>__testErrors);assert.equal(options.enabled,true,JSON.stringify(errors));
  assert.equal(options.path,`panel.html?tab=${tabId}`);await visible(tabId,true);
  const second=await context.newPage();await second.goto(base+'/b');await second.bringToFront();await second.waitForTimeout(300);
  const secondId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(t=>t.url===url).id,base+'/b');
  await visible(secondId,false);
  options=await worker.evaluate(id=>chrome.sidePanel.getOptions({tabId:id}),tabId);assert.equal(options.enabled,true,'switching tabs discarded a user-opened panel');
  assert.equal((await worker.evaluate(id=>chrome.sidePanel.getOptions({tabId:id}),secondId)).enabled,false,'unopened tab inherited another tab panel');
  await first.bringToFront();await visible(tabId,true);assert.equal((await worker.evaluate(id=>chrome.sidePanel.getOptions({tabId:id}),tabId)).enabled,true);
  for(let n=0;n<20;n++){await second.bringToFront();await first.bringToFront();}
  await first.waitForTimeout(300);await visible(tabId,true);
  assert.equal((await worker.evaluate(id=>chrome.sidePanel.getOptions({tabId:id}),tabId)).enabled,true,'rapid tab switching discarded panel availability');
  await closePanel(tabId);
  assert.equal((await worker.evaluate(id=>chrome.sidePanel.getOptions({tabId:id}),tabId)).enabled,true,'closing visibility unnecessarily disabled the tab');
  for(let n=0;n<5;n++){await second.bringToFront();await first.bringToFront();}
  await first.waitForTimeout(200);await visible(tabId,false);
  await first.locator('#open-panel-test').evaluate(button=>delete button.dataset.done);await first.locator('#open-panel-test').click();await first.waitForFunction(()=>document.querySelector('#open-panel-test')?.dataset.done==='true');
  options=await worker.evaluate(id=>chrome.sidePanel.getOptions({tabId:id}),tabId);assert.equal(options.enabled,true,'explicit reopen failed');
  await worker.evaluate(async id=>chrome.scripting.executeScript({target:{tabId:id},func:()=>{const button=document.createElement('button');button.id='second-open';button.textContent='Open';button.onclick=()=>chrome.runtime.sendMessage({type:'test-open-panel'},()=>button.dataset.done='true');document.body.append(button);}}),secondId);
  await second.bringToFront();await second.locator('#second-open').click();await second.waitForFunction(()=>document.querySelector('#second-open').dataset.done==='true');await visible(secondId,true);
  await first.bringToFront();await visible(tabId,true);await closePanel(tabId);
  await second.bringToFront();await visible(secondId,true);assert.equal((await worker.evaluate(id=>chrome.sidePanel.getOptions({tabId:id}),secondId)).enabled,true,'closing one tab affected another opened tab');
  // Re-run the same startup initializer used when the background worker wakes.
  // Availability restoration must not change Chrome's own visibility state.
  await worker.evaluate(async()=>{importScripts('panel_scope.js');await __testScopeReady;});
  await first.bringToFront();await visible(tabId,false);
  await second.bringToFront();await visible(secondId,true);
  assert.equal((await worker.evaluate(id=>chrome.sidePanel.getOptions({tabId:id}),tabId)).enabled,true,'startup discarded previously enabled tab');
  errors=await worker.evaluate(()=>__testErrors);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,browser:context.browser()?.version(),realUserGesture:true,userOpenedTabPreserved:true,unopenedTabStaysClosed:true,userClosedTabStaysClosed:true,manualReopen:true,actualPanelVisibility:true,twoOpenedTabsIndependent:true,rapidTabRoundTrips:20,closedTabRoundTrips:5,startupReinitialization:true}));
 }finally{if(context)await context.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
