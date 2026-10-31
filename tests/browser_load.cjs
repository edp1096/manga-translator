const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.resolve(__dirname,'../../talk/web/node_modules/playwright'));
const root=path.resolve(__dirname,'../extension');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:800,height:700}});
  const asset='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="white"/></svg>');
  await page.route('https://reader.test/**',route=>route.fulfill({body:'<html><body></body></html>',contentType:'text/html'}));await page.goto('https://reader.test/');
  await page.setContent('<style>img{display:block;width:400px;height:600px}body{margin:0}</style><div id="reader"></div><div style="height:1500px"></div>');
  await page.evaluate(asset=>{
   window.asset=asset;window.listeners=[];
   window.chrome={runtime:{sendMessage:async m=>({ok:true,value:m.type==='settings'?{selector:''}:asset}),onMessage:{addListener:fn=>listeners.push(fn)}}};
   window.call=msg=>new Promise(resolve=>listeners[0]({...msg,type:'control'},null,resolve));
   for(let n=1;n<=2;n++){const img=new Image();img.src=asset+'#'+n;img.alt='Page '+n;reader.append(img);}
   window.addEventListener('scroll',()=>{if(scrollY>500&&!window.added){window.added=true;reader.firstChild.replaceWith(reader.firstChild.cloneNode());const img=new Image();img.src=asset+'#3';img.alt='Page 3';reader.append(img);}});
  },asset);
  await page.evaluate(()=>{window.delayedImages=reader.innerHTML;reader.innerHTML='';});
  await page.addScriptTag({path:path.join(root,'render.js')});await page.addScriptTag({path:path.join(root,'content.js')});
  assert.equal((await page.evaluate(()=>call({action:'scan'}))).items.length,0);
  await page.evaluate(()=>{reader.innerHTML=delayedImages;});
  const before=await page.evaluate(()=>call({action:'status'}));assert.equal(before.items.length,2);
  const key=before.items[0].key;
  await page.evaluate(key=>new Promise(resolve=>listeners[0]({type:'applyEdited',key,result:{width:400,height:600,regions:[],displayVersion:2}},null,resolve)),key);
  assert.equal((await page.evaluate(()=>call({action:'status'}))).items[0].done,true);
  const first=await page.evaluate(()=>call({action:'preload'}));assert.equal(first.running,true);assert.equal(first.items.length,2);
  for(let i=0;i<100;i++){if(!(await page.evaluate(()=>call({action:'status'}))).running)break;await page.waitForTimeout(150);}
  const after=await page.evaluate(()=>call({action:'status'}));assert.equal(after.items.length,3);assert.equal(after.items[0].key,key);assert.equal(after.items[0].done,true);assert(await page.evaluate(()=>scrollY>500),'refresh jumped back to its starting position');
  console.log('PASS: immediate list, lazy-image append, recreated DOM preserves result/key, refresh keeps its final position');
  await page.evaluate(()=>{const image=new Image();image.src=asset+'#0';image.alt='Page 0';reader.prepend(image);});
  await page.evaluate(()=>call({action:'preload'}));for(let attempt=0;attempt<100;attempt++){if(!(await page.evaluate(()=>call({action:'status'}))).running)break;await page.waitForTimeout(150);}
  const reordered=await page.evaluate(()=>call({action:'status'}));assert.deepEqual(reordered.items.map(entry=>entry.title),['Page 0','Page 1','Page 2','Page 3']);assert.equal(reordered.items[1].key,key);assert.equal(reordered.items[1].done,true);
  console.log('PASS: delayed earlier image restores document order while preserving existing results and keys');
  const panel=await browser.newPage();
  await panel.addInitScript(()=>{window.state={message:'loaded',running:false,items:[{key:'a',index:0,state:'완료',done:true,preview:'https://example.test/a',title:'A',width:400,height:600},{key:'b',index:1,state:'대기',preview:'https://example.test/b',title:'B',width:400,height:600}]};window.chrome={tabs:{query:async()=>[{id:1,url:'https://example.test'}],onActivated:{addListener:()=>{}}},runtime:{openOptionsPage:async()=>{},sendMessage:async m=>({ok:true,value:m.type==='thumbnail'?'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7':window.state})}};});
  await panel.goto('file://'+path.join(root,'panel.html'));await panel.waitForSelector('.item');
  assert.equal(await panel.locator('#scan').count(),0);assert.equal(await panel.locator('#preload').textContent(),'새로고침');
  await panel.locator('.item input').first().uncheck();
  await panel.locator('.item img').first().click();assert.equal(await panel.locator('.item input').first().isChecked(),true);
  await panel.locator('.item span').first().click();assert.equal(await panel.locator('.item input').first().isChecked(),false);
  await panel.locator('.item').first().getByText('이동',{exact:true}).click();assert.equal(await panel.locator('.item input').first().isChecked(),false);
  await panel.locator('.item').first().getByText('편집',{exact:true}).click();assert.equal(await panel.locator('.item input').first().isChecked(),false);
  console.log('PASS: thumbnail/status toggle selection; move/edit do not toggle');
  await panel.evaluate(()=>{state.items.push({key:'c',index:2,state:'대기',preview:'https://example.test/c'});display(state);});
  assert.equal(await panel.locator('.item input').nth(0).isChecked(),false);assert.equal(await panel.locator('.item input').nth(1).isChecked(),true);assert.equal(await panel.locator('.item input').nth(2).isChecked(),true);
  assert(await panel.locator('#all input').evaluate(e=>e.indeterminate));
  await panel.locator('#all input').check();await panel.locator('#all input').uncheck();
  await panel.evaluate(()=>{state.items.push({key:'d',index:3,state:'대기',preview:'https://example.test/d'});display(state);});
  assert.equal(await panel.locator('.item input:checked').count(),0);
  console.log('PASS: single load control, selection preserved, select-none respected for newly discovered images');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
