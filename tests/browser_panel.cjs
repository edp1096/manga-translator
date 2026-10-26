const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.resolve(__dirname,'../../talk/web/node_modules/playwright'));
(async()=>{const b=await chromium.launch({headless:true});try{
 const p=await b.newPage();await p.route('https://panel.test/**',r=>r.fulfill({body:'<div id="page"></div><div id="status"></div><button id="zip"></button><button id="preload"></button><button id="run"></button><button id="stop"></button><button id="toggle"></button><button id="settings"></button><label id="all"><input type="checkbox" checked></label><div id="items"></div>',contentType:'text/html'}));await p.goto('https://panel.test/');
 await p.evaluate(()=>{window.activeTab={id:1,url:'chrome://extensions'};window.calls=[];window.chrome={tabs:{query:async()=>[activeTab],get:async()=>{throw Error('No tab')},onActivated:{addListener:f=>window.activate=f}},runtime:{openOptionsPage:async()=>{},sendMessage:async m=>{calls.push(m);if(!Number.isInteger(m.tabId))throw Error('Invalid tab ID');return {ok:true,value:{pageURL:activeTab.url,message:'connected',running:false,items:[]}}}}};});
 await p.addScriptTag({path:path.resolve(__dirname,'../extension/panel.js')});await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('새로고침'));
 assert.equal(await p.evaluate(()=>calls.length),0);
 await p.evaluate(()=>{activeTab={id:42,url:'https://klz9.com/rairairai-chapter-42.5.html'}});await p.locator('#preload').click();await p.waitForFunction(()=>calls.some(m=>m.action==='preload'));
 assert.deepEqual(await p.evaluate(()=>calls.map(m=>m.tabId)),[42,42]);
 await p.evaluate(()=>{activeTab={id:43,url:'https://klz9.com/tokkyo-yaburi-no-joou-benrishi-ootori-mirai-chapter-1.html'};activate()});await p.waitForFunction(()=>calls.some(m=>m.tabId===43));
 assert.equal(await p.evaluate(()=>calls.some(m=>!Number.isInteger(m.tabId))),false);
 console.log('PASS: failed initial connection recovers on refresh; default panel follows selected manga tab; no undefined tab IDs');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
