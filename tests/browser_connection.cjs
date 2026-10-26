const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const playwright=process.env.PLAYWRIGHT_MODULE||process.env.MANGA_PLAYWRIGHT||require.resolve('playwright');
(async()=>{
 const emptyEvent={addListener(){}};const chrome={runtime:{onMessage:emptyEvent,onMessageExternal:emptyEvent},tabs:{onActivated:emptyEvent,onUpdated:emptyEvent,query:async()=>[]},sidePanel:{setPanelBehavior(){}},storage:{local:{get:async()=>({})}}};
 const context=vm.createContext({chrome,URL,AbortSignal,setTimeout,clearTimeout,importScripts(){},fetch:async()=>{throw Error('missing key must not make an API request')}});
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../extension/background.js'),'utf8'),context);
 await assert.rejects(vm.runInContext("api('/api/ping')",context),e=>/확장 연결하기/.test(e.message)&&!/토큰을 입력/.test(e.message));
 const {chromium}=require(playwright),b=await chromium.launch({headless:true});try{
  const p=await b.newPage();await p.addInitScript(()=>{window.saved={server:'http://127.0.0.1:8793',token:'existing-private-key',target:'Korean',selector:'',captureFallback:true};window.chrome={runtime:{sendMessage:async()=>({ok:true,value:{...saved}})},storage:{local:{set:async value=>Object.assign(saved,value)}}};});
  await p.route('https://options.test/**',route=>{const file=route.request().url().endsWith('options.js')?'options.js':route.request().url().endsWith('ui.css')?'ui.css':'options.html';route.fulfill({body:fs.readFileSync(path.resolve(__dirname,'../extension',file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});});
  await p.goto('https://options.test/');await p.waitForFunction(()=>document.querySelector('#server').value==='http://127.0.0.1:8793');await p.locator('#token').evaluate(e=>e.value='');await p.getByRole('button',{name:'저장',exact:true}).click();await p.waitForFunction(()=>document.querySelector('output').textContent.includes('저장했습니다'));assert.equal(await p.evaluate(()=>saved.token),'existing-private-key');
 }finally{await b.close()}
 console.log('PASS: missing pairing guides the connection button; blank local token field preserves the stored key');
})().catch(e=>{console.error(e);process.exit(1)});
