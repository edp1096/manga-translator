const assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 async function setup(options={}){
  const page=await browser.newPage();await page.route('https://pipeline.test/**',r=>r.fulfill({contentType:'text/html',body:'<div id="manga"></div>'}));await page.goto('https://pipeline.test/');
  await page.evaluate(options=>{
   const c=document.createElement('canvas');c.width=400;c.height=600;c.getContext('2d').fillRect(0,0,400,600);const original=c.toDataURL();
   for(let i=0;i<3;i++){const img=document.createElement('img');img.src=original+'#'+i;img.alt='Page '+(i+1);img.width=400;img.height=600;document.querySelector('#manga').append(img);}
   const runs=[];for(let y=11;y<25;y++)runs.push(y*40+6,23);
   const result={width:400,height:600,regions:[{id:1,type:'text',mode:'tooltip',bbox:[80,130,230,230],box:[80,130,230,230],text:'Balloon',translation:'말풍선입니다.',fontSize:32},{id:2,type:'text',mode:'tooltip',bbox:[10,400,100,470],box:[10,400,100,470],text:'Thought',translation:'생각입니다.',fontSize:32}]};
   window.fixture={events:[],listeners:[],changes:[],submits:0,hold:false,concurrent:0,maximum:0,failOnce:false,busyOnce:false,failPaint:false,mode:'white',outside:'restore',...options};
   const f=fixture,wait=ms=>new Promise(r=>setTimeout(r,ms));window.call=m=>new Promise(r=>f.listeners[0]({type:'control',...m},null,r));
   window.chrome={storage:{onChanged:{addListener:fn=>f.changes.push(fn)}},runtime:{onMessage:{addListener:fn=>f.listeners.push(fn)},sendMessage:async m=>{
    let value;if(m.type==='settings')value={selector:'#manga img',displayMode:f.mode,outsideTextMode:f.outside,lightweightDisplay:!!f.light};
    else if(m.type==='restore')value=[];
    else if(m.type==='remember'){f.events.push('save:'+m.id);value=true;}
    else if(m.type==='submit'){value={id:'job-'+(++f.submits)};f.events.push('submit:'+value.id);}
    else if(m.type==='status'){f.events.push('translated:'+m.id);value={status:'done',result:{...structuredClone(result),testJob:m.id}};}
    else if(m.type==='asset'){f.events.push('asset:'+m.id+':'+m.name);value=original;}
    else if(m.type==='bubbles'||m.type==='restoration'){
     f.events.push(m.type+':'+m.id);f.concurrent++;f.maximum=Math.max(f.maximum,f.concurrent);
     if(m.type==='restoration'&&m.id==='job-1'){while(f.hold)await wait(10);if(f.failOnce){f.failOnce=false;f.concurrent--;return{ok:false,error:'서버 500: test restoration failure'}}if(f.busyOnce){f.busyOnce=false;f.concurrent--;return{ok:false,error:'서버 409: busy'}}}
     await wait(25);f.concurrent--;
     value=m.type==='bubbles'?{version:3,width:400,height:600,bubbles:[{width:40,height:60,runs,bbox:[48,98,302,262],confidence:.96}]}:{version:1,width:400,height:600,asset:'restored-v1.png',regions:[{id:2,sourceText:'Thought',sourceBox:[10,400,100,470],bounds:[10,400,100,470],runs:[0,6300]}]};
    }else if(m.type==='outsideTextMode'){f.outside=m.mode;value=m.mode;f.changes.forEach(fn=>fn({outsideTextMode:{newValue:m.mode}},'local'));}
    else throw Error('Unexpected '+m.type);
    return{ok:true,value};
   }}};
  },options);
  await page.addScriptTag({path:path.resolve(__dirname,'../extension/render.js')});await page.evaluate(()=>{const draw=MangaRender.render;MangaRender.render=async(...args)=>{if(fixture.failPaint){fixture.failPaint=false;throw Error('Test render failure')}const result=await draw(...args);fixture.events.push('paint:'+args[1].testJob);return result;};});await page.addScriptTag({path:path.resolve(__dirname,'../extension/content.js')});
  const state=await page.evaluate(()=>call({action:'scan'})),keys=state.items.map(i=>i.key);return{page,keys};
 }
 const start=({page,keys})=>page.evaluate(keys=>call({action:'run',keys}),keys);
 const wait=async(page,predicate)=>{for(let i=0;i<300;i++){const s=await page.evaluate(()=>call({action:'status'}));if(predicate(s))return s;await page.waitForTimeout(30)}throw Error('State timeout '+JSON.stringify(await page.evaluate(()=>call({action:'status'}))))};
 const idle=p=>wait(p,s=>!s.running&&!s.displayBusy);
 function order(events,count=3){for(let n=1;n<count;n++){const finish=events.indexOf('paint:job-'+n),next=events.indexOf('submit:job-'+(n+1));assert(finish>=0&&next>finish,'Next page submitted before previous display: '+events.join(', '));}}
 let checks=0;
 for(const options of [{},{outside:'white'},{outside:'tooltip',mode:'auto'},{outside:'restore',mode:'white',light:true}]){
  const t=await setup({...options,hold:options.outside===undefined});await start(t);
  if(t.page&&options.outside===undefined){await t.page.waitForFunction(()=>fixture.events.includes('restoration:job-1'));const s=await t.page.evaluate(()=>call({action:'status'}));assert(s.running&&s.displayBusy);assert.equal(s.items[0].state,'이미지 복원');assert.match(s.message,/0\/3 완료/);assert.equal(await t.page.evaluate(()=>fixture.submits),1);await t.page.evaluate(()=>fixture.hold=false);}
  const s=await idle(t.page);assert.match(s.message,/3장 완료 · 0장 실패/);assert(s.items.every(i=>i.state==='완료'));order(await t.page.evaluate(()=>fixture.events));assert.equal(await t.page.evaluate(()=>fixture.maximum),options.mode==='auto'||options.light?0:1);await t.page.close();checks++;
 }
 // Stop while inpainting, then continue from the completed translation.
 {const t=await setup({hold:true});await start(t);await t.page.waitForFunction(()=>fixture.events.includes('restoration:job-1'));await t.page.evaluate(()=>call({action:'stop'}));await t.page.evaluate(()=>fixture.hold=false);const stopped=await idle(t.page);assert.match(stopped.message,/중지됨 · 0장 완료/);assert.equal(await t.page.evaluate(()=>fixture.submits),1);assert.equal(await t.page.evaluate(()=>fixture.events.includes('asset:job-1:restored-v1.png')),false);await start(t);assert.match((await idle(t.page)).message,/3장 완료/);assert.equal(await t.page.evaluate(()=>fixture.submits),3);order(await t.page.evaluate(()=>fixture.events));await t.page.close();checks++;}
 // Failed inpainting or canvas rendering pauses this page and all later ones.
 for(const error of ['failOnce','failPaint']){const t=await setup({[error]:true});await start(t);const paused=await wait(t.page,s=>s.displayPaused&&!s.running&&!s.displayBusy);assert.match(paused.message,/표시 적용 대기 · 0장 완료/);assert(paused.items[0].done&&!paused.items[0].error);assert.equal(await t.page.evaluate(()=>fixture.submits),1);await t.page.evaluate(()=>call({action:'displayRetry'}));assert.match((await idle(t.page)).message,/3장 완료/);assert.equal(await t.page.evaluate(()=>fixture.submits),3);order(await t.page.evaluate(()=>fixture.events));await t.page.close();checks++;}
 {const t=await setup({busyOnce:true});await start(t);await wait(t.page,s=>s.items[0].state==='번역 완료 · 서버 대기');assert.equal(await t.page.evaluate(()=>fixture.submits),1);assert.match((await idle(t.page)).message,/3장 완료/);order(await t.page.evaluate(()=>fixture.events));await t.page.close();checks++;}
 // A stale restoration reply cannot override a new display selection.
 for(const failOnce of [false,true]){const t=await setup({hold:true,failOnce});await start(t);await t.page.waitForFunction(()=>fixture.events.includes('restoration:job-1'));await t.page.evaluate(()=>call({action:'outsideTextMode',mode:'tooltip'}));await t.page.evaluate(()=>fixture.hold=false);assert.match((await idle(t.page)).message,/3장 완료/);assert.equal(await t.page.evaluate(()=>fixture.events.includes('asset:job-1:restored-v1.png')),false);order(await t.page.evaluate(()=>fixture.events));await t.page.close();checks++;}
 // Choosing a usable mode after an error resumes without retranslation.
 {const t=await setup({failOnce:true});await start(t);await wait(t.page,s=>s.displayPaused&&!s.running);await t.page.evaluate(()=>call({action:'outsideTextMode',mode:'tooltip'}));assert.match((await idle(t.page)).message,/3장 완료/);assert.equal(await t.page.evaluate(()=>fixture.submits),3);order(await t.page.evaluate(()=>fixture.events));await t.page.close();checks++;}
 console.log(JSON.stringify({ok:true,browser:browser.version(),checks,pageOrder:true,completionAfterDisplay:true,stopResumeWithoutRetranslation:true,displayRetryWithoutRetranslation:true,busyRetry:true,staleModeIgnored:true,failedModeRecovery:true}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
