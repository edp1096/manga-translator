const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const {chromium}=require(process.env.MANGA_PLAYWRIGHT);
(async()=>{const b=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:process.env.MANGA_HEADED!=='1'});try{const p=await b.newPage(),root=path.resolve(__dirname,'../extension');
 await p.route('https://panel.test/**',r=>{const f=new URL(r.request().url()).pathname.slice(1)||'panel.html';r.fulfill({body:fs.readFileSync(path.join(root,f)),contentType:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html'});});
 await p.addInitScript(()=>{window.exports=[];window.run=false;window.chrome={tabs:{get:async()=>({id:1,url:'https://manga.test/'}),query:async()=>[{id:1,url:'https://manga.test/'}],onActivated:{addListener(){}}},runtime:{openOptionsPage(){},sendMessage:async m=>{
 if(m.action==='status'&&window.holdStatus)await new Promise(resolve=>window.releaseStatus=resolve);
 if(m.type==='thumbnail')return {ok:true,value:'data:image/png;base64,AAEC'};
 if(m.action==='export'){exports.push(m.key);if(m.key==='4')return {ok:false,error:'원본 접근 실패'};return {ok:true,value:{data:'data:image/png;base64,AAEC',kind:'original',state:'원본'}};}
 return {ok:true,value:{pageURL:'https://manga.test/',running:run,message:'ready',items:['완료','실패','글자 없음','미번역','미번역'].map((state,index)=>({key:String(index),index,state,preview:'',done:index===0}))}};
 }}};});
 await p.goto('https://panel.test/panel.html?tab=1');await p.waitForFunction(()=>document.querySelectorAll('.item').length===5);await p.evaluate(()=>{holdStatus=true;});await p.locator('#all input').uncheck();assert.equal(await p.locator('.item input:checked').count(),0);assert.equal(await p.locator('#zip').textContent(),'선택 저장 (0)');await p.locator('#all input').check();assert.equal(await p.locator('.item input:checked').count(),5);await p.evaluate(()=>{holdStatus=false;window.releaseStatus?.();});await p.locator('.item input').nth(0).uncheck();
 assert.equal(await p.locator('#all input').evaluate(x=>x.indeterminate),true);
 await p.evaluate(()=>{window.zipFiles=null;MangaZip.create=files=>{zipFiles=files.map(f=>({name:f.name,text:f.name.endsWith('.json')?new TextDecoder().decode(f.data):null}));return new Blob(['test']);};});
 await p.locator('#zip').click();await p.waitForFunction(()=>zipFiles!==null);assert.deepEqual(await p.evaluate(()=>exports),['1','2','3','4']);assert.deepEqual(await p.evaluate(()=>zipFiles.map(f=>f.name)),['0002.png','0003.png','0004.png','0005-error.txt','manifest.json']);
 const manifest=JSON.parse(await p.evaluate(()=>zipFiles.at(-1).text));assert.equal(manifest.length,4);assert.equal(manifest[3].error,'원본 접근 실패');
 await p.evaluate(()=>{run=true;});await p.waitForFunction(()=>document.querySelector('#zip').disabled);console.log('PASS: checked images only, all statuses retained, list order, unavailable original error entry, ZIP disabled during work');
 }finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
