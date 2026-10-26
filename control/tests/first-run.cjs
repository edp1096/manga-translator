const fs=require('fs'),assert=require('assert');
// Run against a fresh controller root. This test explicitly downloads the E4B/INT8 combination.
const testRoot=process.env.MANGA_TEST_ROOT,output=process.env.MANGA_TEST_OUTPUT;
assert(testRoot&&output,'Set MANGA_TEST_ROOT and MANGA_TEST_OUTPUT');fs.mkdirSync(output,{recursive:true});const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const b=await chromium.launch({headless:true}),p=await b.newPage({viewport:{width:1440,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const state=async()=>await(await p.request.get('http://127.0.0.1:8794/api/state')).json();
 const wait=async predicate=>{for(let i=0;i<900;i++){let s=await state();assert(!s.error,s.error);if(predicate(s))return s;await p.waitForTimeout(500)}throw Error('timeout')};
 const card=name=>p.locator('.model-card').filter({has:p.getByRole('heading',{name,exact:true})});
 const report={};await p.goto('http://127.0.0.1:8794');await p.getByRole('button',{name:'모델 선택·다운로드',exact:true}).click();
 await p.getByRole('heading',{name:'모델 선택과 설치'}).waitFor();await p.waitForTimeout(3000);
 let s=await state();assert(s.phase==='idle'&&!s.settings.model&&!s.settings.ocr&&!s.settings.layout);assert(!fs.existsSync(testRoot+'/data/downloads'));report.freshNoDownload=true;
 await card('Hayai v2 · Dynamic INT8').getByRole('button',{name:'이 모델 선택',exact:true}).click();await p.waitForTimeout(1500);assert(!fs.existsSync(testRoot+'/data/downloads'));report.selectionNoDownload=true;
 await p.screenshot({path:output+'/model-choices.png',fullPage:true});await p.setViewportSize({width:390,height:844});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile overflow');await p.screenshot({path:output+'/model-choices-mobile.png',fullPage:true});await p.setViewportSize({width:1440,height:1000});
 await card('Hayai v2 · Dynamic INT8').getByRole('button',{name:'다운로드·이어받기',exact:true}).click();s=await wait(s=>!s.busy&&s.models.find(x=>x.id==='hayai-int8').installed);assert(!s.settings.model&&!s.settings.layout);assert(!s.models.find(x=>x.id==='gemma').present&&!s.models.find(x=>x.id==='gemma-e4b').present&&!s.models.find(x=>x.id==='koharu-768').present);report.individualOCR=true;console.log('Individual OCR download PASS');
 await card('Koharu 768 · 전체 마스크').getByRole('button',{name:'이 모델 선택',exact:true}).click();await card('Gemma 4 E4B · Q4_0').getByRole('button',{name:'이 모델 선택',exact:true}).click();await p.getByRole('button',{name:'선택한 조합 다운로드·복구',exact:true}).click();
 await wait(s=>s.progress.current==='gemma-e4b'&&s.progress.bytes>64*1024*1024);await p.getByRole('button',{name:'일시 정지',exact:true}).click();s=await wait(s=>!s.busy&&s.phase==='paused');report.pausedBytes=s.progress.bytes;assert(!s.models.find(x=>x.id==='gemma').present);console.log('E4B paused',report.pausedBytes);
 await card('Gemma 4 E4B · Q4_0').getByRole('button',{name:'다운로드·이어받기',exact:true}).click();s=await wait(s=>!s.busy&&s.ready);report.ready=true;report.models=s.models.map(({id,installed,selected})=>({id,installed,selected}));assert(!s.models.find(x=>x.id==='gemma').present);console.log('E4B resumed, selected combination ready');
 await p.getByRole('button',{name:'개요',exact:true}).click();await p.getByRole('button',{name:'API 시작',exact:true}).first().click();s=await wait(s=>s.phase==='running'&&s.services.every(x=>x.ready));report.services=s.services;report.errors=errors;assert(errors.length===0);fs.writeFileSync(output+'/model-choice.json',JSON.stringify(report,null,2));await p.screenshot({path:output+'/ready-e4b.png',fullPage:true});console.log('PASS',JSON.stringify(report));await b.close();
})().catch(e=>{console.error(e);process.exit(1)})
