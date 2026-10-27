const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'manga-page-panel-')),extension=path.join(root,'extension');
 fs.cpSync(path.resolve(__dirname,'../extension'),extension,{recursive:true});
 const script=path.join(extension,'panel_scope.js');
 fs.writeFileSync(script,fs.readFileSync(script,'utf8').replace('chrome.action.onClicked.addListener(tab=>{','chrome.action.onClicked.addListener(globalThis.__testOpenPanel=tab=>{'));
 const server=http.createServer((request,response)=>{
  if(request.url.endsWith('.svg')){response.writeHead(200,{'Content-Type':'image/svg+xml'});response.end('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="600"><rect width="500" height="600" fill="white"/><text x="50" y="100">Test page</text></svg>');return;}
  response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>Page panel test</title><style>body{margin:0}img{display:block;width:500px;height:600px}button{background:red!important}</style><img src="/one.svg" alt="Page 1"><img src="/two.svg" alt="Page 2">');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let context;
 try{
  context=await chromium.launchPersistentContext(path.join(root,'profile'),{channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:process.env.MANGA_HEADED!=='1',viewport:{width:1280,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>{if(typeof MangaPagePanels!=='object')throw Error('Shared page panel not active');});
  const base='http://127.0.0.1:'+server.address().port;
  const first=await context.newPage(),second=await context.newPage();
  await first.goto(base+'/a');await second.goto(base+'/b');await first.bringToFront();
  const tabId=async page=>worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,page.url());
  const firstId=await tabId(first),secondId=await tabId(second);
  const execute=async(tabId,func,args=[])=>{
   const [result]=await worker.evaluate(({tabId,source,args})=>chrome.scripting.executeScript({target:{tabId},func:async(source,args)=>{
    if(source==='state')return {open:globalThis.MangaPagePanel?.isOpen()||false,count:document.querySelectorAll('[data-manga-translator-panel]').length,items:globalThis.MangaPagePanel?.root?.querySelectorAll('.item').length||0,selected:globalThis.MangaPagePanel?.root?.querySelectorAll('.item input:checked').length||0};
    if(source==='bounds'){const bounds=MangaPagePanel.root.querySelector(args[0]).getBoundingClientRect();return {x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};}
   },args:[source,args]}),{tabId,source:func,args});
   return result.result;
  };
  const wait=async(tabId,check)=>{for(let attempt=0;attempt<60;attempt++){const value=await execute(tabId,'state');if(check(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Panel state timeout: '+JSON.stringify(await execute(tabId,'state')));};
  const open=tabId=>worker.evaluate(async tabId=>__testOpenPanel(await chrome.tabs.get(tabId)),tabId);
  const click=async(page,tabId,selector)=>{const bounds=await execute(tabId,'bounds',[selector]);await page.mouse.click(bounds.x,bounds.y);};
  await open(firstId);await wait(firstId,state=>state.open&&state.items===2);
  assert.equal(await first.evaluate(()=>document.querySelector('[data-manga-translator-panel]').shadowRoot),null);
  assert.equal(await first.evaluate(()=>document.querySelectorAll('.item').length),0);
  const width=await first.locator('[data-manga-translator-panel]').evaluate(node=>node.getBoundingClientRect().width);
  await click(first,firstId,'.page-resize');await first.keyboard.press('ArrowLeft');
  assert.equal(await first.locator('[data-manga-translator-panel]').evaluate(node=>node.getBoundingClientRect().width),width+20);
  await click(first,firstId,'.item input');
  assert.equal((await execute(firstId,'state')).selected,1);
  for(let round=0;round<20;round++){await second.bringToFront();assert.equal((await execute(secondId,'state')).open,false);await first.bringToFront();}
  assert.deepEqual(await execute(firstId,'state'),{open:true,count:1,items:2,selected:1});
  await click(first,firstId,'button[aria-label="패널 닫기"]');await wait(firstId,state=>!state.open);
  for(let round=0;round<5;round++){await second.bringToFront();await first.bringToFront();}
  assert.equal((await execute(firstId,'state')).open,false);
  await open(firstId);assert.equal((await execute(firstId,'state')).selected,1);
  await second.bringToFront();await open(secondId);await wait(secondId,state=>state.open&&state.items===2);
  await click(second,secondId,'button[aria-label="패널 닫기"]');await first.bringToFront();assert.equal((await execute(firstId,'state')).open,true);
  await first.reload();await wait(firstId,state=>state.open&&state.items===2);
  await first.evaluate(()=>{const cover=document.createElement('div');cover.id='capture-test';cover.style.cssText='position:fixed;inset:0;background:rgb(17,34,51);z-index:2147483646';document.documentElement.append(cover);});
  const captureBounds=await first.locator('#capture-test').boundingBox();
  const captureClip={x:captureBounds.x,y:captureBounds.y,width:Math.floor(captureBounds.width),height:Math.floor(captureBounds.height)};
  const coveredOpen=await first.screenshot({clip:captureClip});
  await open(firstId);await wait(firstId,state=>!state.open);
  assert.deepEqual(await first.locator('#capture-test').boundingBox(),captureBounds,'panel changed the capture viewport');
  const coveredClosed=await first.screenshot({clip:captureClip});
  if(!coveredClosed.equals(coveredOpen)){
   const artifacts=process.env.MANGA_TEST_ARTIFACTS||fs.mkdtempSync(path.join(os.tmpdir(),'manga-panel-capture-'));
   fs.mkdirSync(artifacts,{recursive:true});fs.writeFileSync(path.join(artifacts,'open.png'),coveredOpen);fs.writeFileSync(path.join(artifacts,'closed.png'),coveredClosed);
   fs.writeFileSync(path.join(artifacts,'geometry.json'),JSON.stringify(await first.evaluate(()=>({innerWidth,innerHeight,clientWidth:document.documentElement.clientWidth,cover:document.getElementById('capture-test').getBoundingClientRect().toJSON(),color:getComputedStyle(document.getElementById('capture-test')).backgroundColor})),null,2));
   assert.fail('capture layer differs: '+artifacts);
  }
  await first.evaluate(()=>document.getElementById('capture-test').remove());
  await first.reload();await new Promise(resolve=>setTimeout(resolve,400));assert.equal((await execute(firstId,'state')).open,false);
  await Promise.all([open(firstId),open(firstId)]);assert.equal((await execute(firstId,'state')).open,false);
  await open(firstId);await first.goto('about:blank');await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal((await worker.evaluate(()=>chrome.storage.session.get('pagePanelTabs'))).pagePanelTabs.includes(firstId),false);
  console.log(JSON.stringify({ok:true,browser:context.browser().version(),sharedPagePanel:true,userAgent:await worker.evaluate(()=>navigator.userAgent),rapidTabRoundTrips:20,closedTabRoundTrips:5,selectionPreserved:true,unopenedTabStaysClosed:true,independentTabs:true,documentReload:true,closedReload:true,captureLayerUnchanged:true,shadowIsolation:true,rapidToolbarToggle:true,restrictedNavigation:true}));
 }finally{await context?.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
