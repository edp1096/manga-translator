const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT);
(async()=>{const browser=await chromium.launch({headless:true});try{
 const p=await browser.newPage();const root=path.resolve(__dirname,'../extension');
 await p.route('https://editor.test/**',r=>{const file=new URL(r.request().url()).pathname.slice(1)||'editor.html';r.fulfill({body:fs.readFileSync(path.join(root,file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});});
 await p.addInitScript(()=>{const c=document.createElement('canvas');c.width=400;c.height=600;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,400,600);const png=c.toDataURL();window.applied=null;window.chrome={storage:{local:{get:async()=>({'edit:test':{result:{width:400,height:600,regions:[]}}})}},runtime:{sendMessage:async m=>{if(m.type==='apply')window.applied=structuredClone(m.result);return {ok:true,value:m.type==='asset'?png:true};}}};});
 await p.goto('https://editor.test/editor.html?job=test');await p.waitForFunction(()=>document.querySelector('#status').textContent==='0개 영역');
 assert.equal(await p.locator('#delete').isDisabled(),true);await p.locator('#add').click();await p.locator('#translation').fill('추가 글상자');await p.locator('#apply').click();await p.waitForFunction(()=>applied?.regions.length===1);
 assert.equal(await p.evaluate(()=>applied.regions[0].translation),'추가 글상자');assert.equal(await p.evaluate(()=>applied.regions[0].manual),true);
 await p.locator('#translation').press('Delete');assert.equal(await p.locator('#regions option').count(),1,'typing delete removed region');
 await p.locator('#delete').click();await p.locator('#apply').click();await p.waitForFunction(()=>applied?.regions.length===0);assert.equal(await p.locator('#font').isDisabled(),true);
 await p.addScriptTag({path:path.join(root,'zip.js')});
 const bytes=await p.evaluate(async()=>Array.from(new Uint8Array(await MangaZip.create([{name:'0001.png',data:new Uint8Array([0,1,2,255])},{name:'0002-error.txt',data:new TextEncoder().encode('원본 접근 실패')}]).arrayBuffer())));
 fs.writeFileSync('/tmp/manga-extension-zip-test.zip',Buffer.from(bytes));
 console.log('PASS: add/apply/delete/empty editor and text Delete key; ZIP generated for Python interoperability check');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
