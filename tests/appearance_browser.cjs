const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {chromium} = require(process.env.MANGA_PLAYWRIGHT || 'playwright');
const project = path.resolve(__dirname, '..');
const evidence = path.join(project,'research','appearance');
fs.mkdirSync(evidence,{recursive:true});
const bundle = path.join(project, 'control/internal/assets/bundle');
const job = '11111111-1111-4111-8111-111111111111';
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180"><rect width="300" height="180" fill="white"/><circle cx="260" cy="40" r="20" fill="#653393"/></svg>';
const result = {width:300,height:180,target:'Korean',regions:[{id:1,type:'text',mode:'replace',text:'こんにちは',translation:'안녕하세요',bbox:[30,35,210,135],box:[30,35,210,135],fontSize:32,color:'#112244'}]};
const login = fs.readFileSync(path.join(project,'control/internal/control/network.go'),'utf8').match(/const controlLogin = `([^`]+)`/)[1];
const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://test');
  function send(type,body,status=200){res.writeHead(status,{'Content-Type':type});res.end(body);}
  if(url.pathname==='/reader')return send('text/html','<style>:root{color-scheme:only light;background:rgb(244,238,211)}</style><img src="/page.svg" width="300" height="180">');
  if(url.pathname==='/page.svg'||url.pathname.startsWith('/api/library/assets/'))return send('image/svg+xml',image);
  if(url.pathname==='/api/library/editor/'+job)return send('application/json',JSON.stringify({result,baseResult:result}));
  if(url.pathname==='/api/state')return send('application/json',JSON.stringify({
    version:'test',platform:'windows-amd64',supported:true,phase:'idle',ready:false,
    settings:{threadsAuto:true},system:{cpus:4,diskFree:50*1024**3,memoryTotal:8*1024**3,memoryAvailable:4*1024**3},
    hardware:{cpu:{recommendedThreads:2},gpus:[]},progress:{},models:[],runtimes:[],components:[],services:[],profiles:[]
  }));
  if(url.pathname==='/api/update/state')return send('application/json','{"update":{"status":"idle"}}');
  if(url.pathname==='/login')return send('text/html; charset=utf-8',login);
  if(url.pathname.startsWith('/api/'))return send('application/json','{}',404);
  const file=path.join(bundle,'web',url.pathname==='/'?'index.html':url.pathname);
  if(!fs.existsSync(file))return send('text/plain','missing',404);
  send(file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8',fs.readFileSync(file));
});
const dark='rgb(33, 41, 47)',light='rgb(255, 255, 255)';
async function background(page,selector,color){
  await page.waitForFunction(([selector,color])=>getComputedStyle(document.querySelector(selector)).backgroundColor===color,[selector,color],{timeout:5000});
}
const themeButton = page => page.getByRole('button',{name:/^화면 테마/});
async function main(){
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const mangaServer=http.createServer(server.listeners('request')[0]);
  await new Promise(done=>mangaServer.listen(0,'127.0.0.1',done));
  const url='http://127.0.0.1:'+server.address().port;
  const scratch=fs.mkdtempSync(path.join(evidence,'edge-'));
  let context;
  try{
    const ext=path.join(scratch,'extension');
    fs.cpSync(path.join(bundle,'extension'),ext,{recursive:true});
    // Expose the same handler the browser toolbar invokes to automation.
    const scope=path.join(ext,'panel_scope.js');
    fs.writeFileSync(scope,fs.readFileSync(scope,'utf8').replace('chrome.action.onClicked.addListener(tab=>{','chrome.action.onClicked.addListener(globalThis.testToolbarClick=tab=>{'));
    context=await chromium.launchPersistentContext(path.join(scratch,'profile'),{channel:process.env.MANGA_BROWSER_CHANNEL||'msedge',headless:true,viewport:{width:1280,height:900},colorScheme:'light',ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
    const cdp=await context.browser().newBrowserCDPSession();
    const {id}=await cdp.send('Extensions.loadUnpacked',{path:ext});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(url=>chrome.storage.local.set({managementServer:url,server:url}),url);
    const page=async u=>{const p=await context.newPage();await p.goto(u);return p;};
    const manager=await page(url),signin=await page(url+'/login');
    await background(manager,'.sidebar',light);
    await manager.setViewportSize({width:360,height:720});
    const pickerBounds=await themeButton(manager).boundingBox();
    assert(pickerBounds.width>0 && pickerBounds.x>=0 && pickerBounds.x+pickerBounds.width<=360);
    await manager.setViewportSize({width:1280,height:900});
    assert.match(await themeButton(manager).getAttribute('title'),/시스템 설정/);
    await themeButton(manager).click();
    await background(manager,'.sidebar',dark);await background(signin,'form',dark);
    await manager.getByRole('button',{name:'앱 업데이트 설명'}).click();
    await background(manager,'.info-popover:popover-open',dark);
    await manager.screenshot({path:path.join(evidence,'manager.png')});
    await signin.reload();assert.match(await themeButton(signin).getAttribute('title'),/· 어둡게/);
    await themeButton(signin).press('Enter');
    await background(manager,'.sidebar',light);
    assert.match(await themeButton(manager).getAttribute('title'),/· 밝게/);
    await themeButton(signin).press('Space');
    await background(manager,'.sidebar',light);await manager.emulateMedia({colorScheme:'dark'});await background(manager,'.sidebar',dark);
    console.log('PASS manager, popover, remote sign-in, persistence, system and cross-window changes');
    const base='chrome-extension://'+id+'/';
    const options=await page(base+'options.html'),editor=await page(base+'editor.html?job='+job),names=await page(base+'names.html'),connect=await page(base+'connect.html'),panel=await page(base+'panel.html');
    const reader=await page('http://127.0.0.1:'+mangaServer.address().port+'/reader');
    const tab=await worker.evaluate(async u=>(await chrome.tabs.query({})).find(t=>t.url===u).id,reader.url());
    await worker.evaluate(async id=>testToolbarClick(await chrome.tabs.get(id)),tab);
    const panelBg=()=>worker.evaluate(async id=>(await chrome.scripting.executeScript({target:{tabId:id},func:()=>getComputedStyle(MangaPagePanel.root.querySelector('#panel-header')).backgroundColor}))[0].result,tab);
    assert.equal(await panelBg(),light);
    await editor.waitForFunction(()=>document.querySelector('#status').textContent==='1개 영역',null,{timeout:10000});
    async function exportPng(){
      const pending=editor.waitForEvent('download');
      await editor.click('#png');const file=await pending;
      const bytes=fs.readFileSync(await file.path());assert.equal(bytes.readUInt32BE(16),300);assert.equal(bytes.readUInt32BE(20),180);
      return crypto.createHash('sha256').update(bytes).digest('hex');
    }
    const original=await exportPng();
    await themeButton(options).click();
    for(const [tab,selector] of [[options,'main'],[editor,'aside'],[names,'.toolbar'],[connect,'main'],[panel,'#panel-header']])await background(tab,selector,dark);
    assert.equal(await panelBg(),dark);assert.equal(await reader.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(244, 238, 211)');
    const colors=await editor.locator('aside').evaluate(node=>{
      const style=getComputedStyle(node);
      return [style.color,style.backgroundColor];
    });
    function luminance(rgb){
      const linear=rgb.match(/\d+/g).slice(0,3).map(value=>{
        const n=Number(value)/255;
        return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;
      });
      return linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722;
    }
    assert((luminance(colors[0])+0.05)/(luminance(colors[1])+0.05)>=4.5);
    assert.equal(await exportPng(),original);
    await editor.screenshot({path:path.join(evidence,'editor.png')});
    await reader.screenshot({path:path.join(evidence,'reader.png')});
    const language=options.getByLabel('번역 언어');
    await language.selectOption('English');
    const dialogueFont=options.locator('#font-dialogue');
    await dialogueFont.selectOption('default');
    assert.equal(await language.inputValue(),'English');
    await options.getByRole('button',{name:'저장',exact:true}).click();
    await options.waitForFunction(()=>document.querySelector('output').textContent.includes('저장했습니다'));
    await options.reload();await background(options,'main',dark);
    await options.waitForFunction(()=>document.getElementById('font-dialogue').value==='default');
    await options.screenshot({path:path.join(evidence,'options.png')});
    assert.equal(await language.inputValue(),'English');
    await themeButton(options).press('Enter');await background(editor,'aside',light);
    await editor.emulateMedia({colorScheme:'dark'});await background(editor,'aside',light);
    await themeButton(options).press('Space');await background(editor,'aside',dark);
    await editor.emulateMedia({colorScheme:'light'});await background(editor,'aside',light);
    await reader.emulateMedia({colorScheme:'dark'});await reader.waitForFunction(()=>document.querySelector('[data-manga-translator-panel]').style.colorScheme==='dark');
    assert.equal(await panelBg(),dark);
    console.log('PASS extension options/editor/dictionary/connection/standalone and embedded panel. Identical exported PNG SHA-256 '+original);
  }finally{
    await context?.close();server.close();mangaServer.close();fs.rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;server.close();});
