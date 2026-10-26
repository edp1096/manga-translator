const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.resolve(__dirname,'../../talk/web/node_modules/playwright'));
(async()=>{const b=await chromium.launch({headless:true});try{
 const p=await b.newPage();await p.route('https://reader.test/**',r=>r.fulfill({body:'<img id="source" alt="Page 22" width="400" height="600">',contentType:'text/html'}));await p.goto('https://reader.test/');
 await p.evaluate(()=>{
  const image=color=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="${color}"/></svg>`);
  source.src=image('white');window.submissions=0;window.assets=[];window.pending=false;window.listeners=[];
  window.chrome={runtime:{onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:async m=>{
   if(m.type==='settings')return {ok:true,value:{selector:''}};
   if(m.type==='submit')return {ok:true,value:{id:'job-'+(++submissions)}};
   if(m.type==='status')return {ok:true,value:m.id==='job-3'?{status:'error',error:'test failure'}:pending?{status:'queued'}:{status:'done',result:{width:400,height:600,regions:[{id:1,bbox:[20,20,60,60],mode:'tooltip',translation:'?',text:'?'},{id:2,bbox:[80,20,140,60],mode:'original',translation:'숨긴 번역',text:'hidden'}],displayVersion:2}}};
   if(m.type==='asset'){assets.push(m.id+'/'+m.name);return {ok:true,value:image(m.id==='job-1'?'red':m.id==='job-2'?'blue':'green')}};
   throw Error(m.type);
  }}};
  window.call=m=>new Promise(resolve=>listeners[0]({...m,type:'control'},null,resolve));
 });
 await p.addScriptTag({path:path.resolve(__dirname,'../extension/render.js')});await p.addScriptTag({path:path.resolve(__dirname,'../extension/content.js')});
 const key=(await p.evaluate(()=>call({action:'scan'}))).items[0].key;
 assert.equal((await p.evaluate(key=>call({action:'export',key}),key)).kind,'original','untranslated export must use original');
 async function idle(){for(let i=0;i<80;i++){const s=await p.evaluate(()=>call({action:'status'}));if(!s.running)return s;await p.waitForTimeout(100);}throw Error('Timed out');}
 async function run(){await p.evaluate(key=>call({action:'run',keys:[key]}),key);return idle();}
 assert.match((await run()).message,/1장 완료/);
 assert.equal(await p.locator('[data-tip]').count(),2);
 assert.deepEqual(await p.locator('[data-tip]').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).cursor)),['help','help']);
 assert.match((await run()).message,/1장 완료/);assert.equal(await p.evaluate(()=>submissions),2);
 assert.deepEqual((await p.evaluate(()=>assets)).slice(-2).sort(),['job-2/cleaned.png','job-2/original.png']);
 await p.evaluate(key=>new Promise(resolve=>listeners[0]({type:'applyEdited',key,result:{width:400,height:600,regions:[]}},null,resolve)),key);
 assert.equal((await p.evaluate(key=>call({action:'export',key}),key)).kind,'original','empty dialogue export must use original');
 await p.evaluate(key=>new Promise(resolve=>listeners[0]({type:'applyEdited',key,result:{width:400,height:600,regions:[{id:'manual-1',manual:true,bbox:[20,20,160,80],box:[20,20,160,80],text:'',translation:'LATEST',fontSize:24,mode:'replace'}]}},null,resolve)),key);
 const before=await p.locator('canvas').evaluate(c=>c.toDataURL());
 const exported=await p.evaluate(key=>call({action:'export',key}),key);assert.equal(exported.kind,'translated');assert.equal(exported.data,before,'export missed latest applied edit');
 const fail=await run();assert.match(fail.message,/1장 실패/);assert.equal(fail.items[0].done,true);assert.equal(await p.locator('canvas').evaluate(c=>c.toDataURL()),before);
 assert.equal((await p.evaluate(key=>call({action:'export',key}),key)).kind,'original','failed latest attempt must export original');
 assert.match((await run()).message,/1장 완료/);assert.equal(await p.evaluate(()=>submissions),4);
 await p.evaluate(()=>{pending=true});await p.evaluate(key=>call({action:'run',keys:[key]}),key);await p.waitForTimeout(100);await p.evaluate(()=>call({action:'stop'}));await idle();assert.equal(await p.evaluate(()=>submissions),5);
 await p.evaluate(()=>{pending=false});assert.match((await run()).message,/1장 완료/);assert.equal(await p.evaluate(()=>submissions),5);
 await p.evaluate(key=>{window.__mangaPausedBatch={keys:[key],remaining:[]}},key);assert.match((await run()).message,/1장 완료/);assert.equal(await p.evaluate(()=>submissions),6);
 await p.evaluate(()=>call({action:'run',keys:[]}));assert.match((await idle()).message,/선택하세요/);assert.equal(await p.evaluate(()=>submissions),6);
 console.log('PASS: completed selection resubmits, new assets replace cache, failures retain old result, stopped job resumes, empty selection explains; export retains originals for untranslated/empty/failed and latest applied edits for success');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
