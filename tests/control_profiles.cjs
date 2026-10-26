const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{
 const state=process.env.MANGA_STATE_FIXTURE?JSON.parse(fs.readFileSync(process.env.MANGA_STATE_FIXTURE)):await fetch('http://127.0.0.1:8794/api/state').then(r=>r.json());if(!process.env.MANGA_STATE_FIXTURE)assert(state.root.includes('regression-app-038'));
 const web=path.join(__dirname,'../control/internal/assets/bundle/web'),evidence=process.env.MANGA_EVIDENCE||path.join(__dirname,'../docs/control-0.3.10');fs.mkdirSync(evidence,{recursive:true});
 state.busy=false;state.phase='idle';state.error='';state.hardware.gpus=[{id:'test-nvidia',name:'NVIDIA test GPU',vendor:'10de',memoryKind:'dedicated',memoryTotal:12*1024**3,memoryUsed:0,memoryFree:12*1024**3,cudaIndex:0,vulkanIndex:0}];
 const base={...state.settings,layout:'koharu-768',ocr:'hayai-int8',model:'gemma',llmExecution:'cpu',layoutExecution:'cpu',ocrExecution:'cpu',threadsAuto:true};
 state.profiles=[{id:'cpu',name:'CPU · 저메모리',note:'CPU',available:true,settings:{...base,profile:'cpu'}},{id:'gpu-mixed',name:'CPU/GPU 병행 · 저용량',note:'OCR CPU / 번역 GPU',available:true,settings:{...base,profile:'gpu-mixed',llmExecution:'vulkan'}},{id:'gpu-balanced',name:'GPU · Gemma E2B',note:'GPU',available:true,settings:{...base,profile:'gpu-balanced',ocr:'hayai-onnx-fp32-kv',llmExecution:'vulkan',layoutExecution:'cuda',ocrExecution:'cuda'}}];
 const calls=[];function selected(){for(const m of state.models)m.selected=state.settings[m.group==='translation'?'model':m.group]===m.id;}
 const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');let body='';for await(const b of req)body+=b;const value=body?JSON.parse(body):{};calls.push([req.method,req.url,value]);
   if(req.url==='/api/state'){selected();res.end(JSON.stringify(state));return;}
   if(req.url==='/api/settings')state.settings=value;
   if(req.url==='/api/models/select'){const model=state.models.find(m=>m.id===value.id);state.settings[model.group==='translation'?'model':model.group]=model.id;}
   res.end('{"ok":true}');return;
  }
  const file=path.join(web,req.url==='/'?'index.html':req.url.split('?')[0]);if(!file.startsWith(web)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('navigation').getByRole('button',{name:'설치 관리'}).click();
  const profile=name=>page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
  await profile('GPU · Gemma E2B').getByRole('button',{name:'프리셋 적용'}).click();
  const int8=page.locator('article.model-card').filter({has:page.getByRole('heading',{name:/Hayai.*INT8/})});await int8.getByRole('button',{name:'GPU OCR 미지원'}).waitFor();assert(await int8.getByRole('button',{name:'GPU OCR 미지원'}).isDisabled());assert(await int8.getByText(/CPU 전용 · GPU OCR 미지원/).isVisible());
  assert(!await int8.getByRole('button',{name:/다운로드|파일 확인/}).isDisabled(),'installation should remain independent from selection');
  const b4=page.locator('article.model-card').filter({has:page.getByRole('heading',{name:'Baberu · INT4 / INT8',exact:true})});
  const bf=page.locator('article.model-card').filter({has:page.getByRole('heading',{name:'Baberu · FP16 / INT8',exact:true})});
  assert(!await b4.getByRole('button',{name:'이 모델 선택',exact:true}).isDisabled());assert(!await bf.getByRole('button',{name:'이 모델 선택',exact:true}).isDisabled());
  await b4.getByRole('button',{name:'이 모델 선택',exact:true}).click();await b4.getByRole('button',{name:'선택 해제',exact:true}).waitFor();assert.equal(state.settings.ocr,'baberu-int4');assert.equal(state.settings.ocrExecution,'cuda');
  const ocrOrder=await page.locator('article.model-card h3').allTextContents();assert(ocrOrder.indexOf('Baberu · INT4 / INT8')<ocrOrder.indexOf('Hayai v2 · Dynamic INT8'));assert(ocrOrder.indexOf('Hayai v2 · Dynamic INT8')<ocrOrder.indexOf('Baberu · FP16 / INT8'));
  await page.screenshot({path:path.join(evidence,'profiles-gpu-desktop.png'),fullPage:true});
  state.settings.ocr='hayai-onnx-fp32-kv';state.settings.ocrExecution='directml';await page.reload();await page.getByRole('navigation').getByRole('button',{name:'설치 관리'}).click();await b4.getByRole('button',{name:'GPU OCR 미지원'}).waitFor();assert(await b4.getByRole('button',{name:'GPU OCR 미지원'}).isDisabled());assert(await b4.getByText(/DirectML 미지원/).isVisible());assert(!await b4.getByRole('button',{name:/다운로드|파일 확인/}).isDisabled());
  await profile('CPU/GPU 병행 · 저용량').getByRole('button',{name:'프리셋 적용'}).click();await int8.getByRole('button',{name:'선택 해제',exact:true}).waitFor();assert(!await int8.getByRole('button',{name:'선택 해제',exact:true}).isDisabled());assert.equal(state.settings.llmExecution,'vulkan');assert.equal(state.settings.ocrExecution,'cpu');
  assert(!calls.some(c=>c[0]==='POST'&&/download|setup/.test(c[1])),'selecting a preset started a download');
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const labels=page.locator('.threads-label');assert.equal(await labels.count(),5);for(const label of await labels.all()){const title=await label.locator('span').boundingBox(),select=await label.locator('select').boundingBox();assert(title&&select&&select.y>=title.y+title.height,'setting label and select share a line');}assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'settings overflow');await page.locator('.settings-card').screenshot({path:path.join(evidence,`settings-${width}.png`)});}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidence,'profiles-mixed-mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile horizontal overflow');assert.deepEqual(errors,[]);
  const report={ok:true,fixture:'GPU hardware simulated; production UI bundle served unchanged',cpuOnlyOCRDisabledInGPUProfile:true,mixedProfileKeepsLiteRT:true,downloadsRemainExplicit:true,baberuCudaSelectable:true,baberuDirectMLDisabled:true,modelOrderLightToHeavy:true,settingsLabelsAboveSelectors:true,mobileOverflow:false,consoleErrors:errors};fs.writeFileSync(path.join(evidence,'profiles-browser.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
