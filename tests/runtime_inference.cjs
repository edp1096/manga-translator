const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.argv[2],input=process.argv[3],report=process.argv[4];
if(!root||!input||!report)throw Error('Usage: node tests/runtime_inference.cjs APP_ROOT IMAGE REPORT_JSON');
const settings=JSON.parse(process.env.MANGA_TEST_SETTINGS||'{}');
const control='http://127.0.0.1:8794';
async function request(route,body){const response=await fetch(control+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Manga-Control':'1',Origin:control},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const value=await response.json();if(!response.ok)throw Error(value.error||JSON.stringify(value));return value;}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test,limit=300000){const end=Date.now()+limit;let previous='';while(Date.now()<end){const state=await request('state');if(state.error)throw Error(state.error);const stage=state.phase+':'+(state.progress?.name||'');if(stage!==previous){console.log(stage);previous=stage;}if(test(state))return state;await pause(500);}throw Error('state timeout');}
(async()=>{
 const logPath=path.join(root,'data/llm.log'),logOffset=fs.existsSync(logPath)?fs.statSync(logPath).size:0,testStarted=Date.now();
 const initial=await request('state');assert.equal(initial.root,path.resolve(root),'refuse to operate on another app instance');
 await request('settings',{...initial.settings,layout:'koharu-768',ocr:'hayai-int8',model:'gemma',autoStart:false,threadsAuto:true,threads:initial.hardware.cpu.recommendedThreads,llmExecution:'cpu',layoutExecution:'cpu',ocrExecution:'cpu',...settings});
 await request('setup',{});const ready=await until(s=>!s.busy&&s.ready);await request('start',{});const running=await until(s=>s.phase==='running',240000);
 const token=fs.readFileSync(path.join(root,'data/native_api/access-token'),'utf8').trim();const headers={Authorization:'Bearer '+token};const form=new FormData();form.set('image',new Blob([fs.readFileSync(input)],{type:'image/png'}),'page.png');form.set('target','Korean');
 let response=await fetch('http://127.0.0.1:8793/api/jobs',{method:'POST',headers,body:form,signal:AbortSignal.timeout(30000)});assert(response.ok,await response.clone().text());const {id}=await response.json();const start=Date.now();let job;
 while(Date.now()-start<480000){response=await fetch('http://127.0.0.1:8793/api/jobs/'+id,{headers,signal:AbortSignal.timeout(20000)});assert(response.ok);job=await response.json();if(job.status==='error')throw Error(job.error);if(job.status==='done')break;await pause(500);}
 assert.equal(job.status,'done');assert(job.result.regions.length>0);assert(job.result.regions.some(r=>/[가-힣]/.test(r.translation)));
 if(settings.ocr?.startsWith('baberu-')){assert.equal(job.result.runtime.ocrBackend,settings.ocr);assert.equal(job.result.runtime.ocrDecoderExecution,'cpu');assert.equal(job.result.runtime.ocrEncoderExecution,settings.ocrExecution||'cpu');}
 const llmLog=fs.readFileSync(logPath).subarray(logOffset).toString('utf8');const offload=llmLog.match(/offloaded\s+[1-9]\d*\/\d+\s+layers to GPU/g)||[];if(settings.llmExecution==='vulkan')assert(offload.length>0,'no actual GPU layer offload in LLM log');
 const providerCounts={};for(const file of fs.readdirSync(path.join(root,'data/cache')).filter(n=>/^(ort-profile|baberu-)/.test(n)&&n.endsWith('.json')&&fs.statSync(path.join(root,'data/cache',n)).mtimeMs>=testStarted-1000)){for(const event of JSON.parse(fs.readFileSync(path.join(root,'data/cache',file),'utf8'))){const p=event.args?.provider;if(p)providerCounts[p]=(providerCounts[p]||0)+1;}}
 if(settings.ocrExecution==='cuda'||settings.layoutExecution==='cuda')assert(providerCounts.CUDAExecutionProvider>0,'no CUDA kernel events in ORT profiling');
 const output={onnxProviderEvents:providerCounts,version:running.version,settings:running.settings,hardware:running.hardware,elapsedSeconds:(Date.now()-start)/1000,regions:job.result.regions.length,timings:job.result.timings,runtime:job.result.runtime,maxRssMiB:job.result.maxRssMiB,llmGPUOffload:offload};fs.mkdirSync(path.dirname(report),{recursive:true});fs.writeFileSync(report,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
 await request('stop',{});await until(s=>!s.busy&&!s.services.some(z=>z.pid));
})().catch(async error=>{console.error(error);try{if((await request('state')).root===path.resolve(root))await request('stop',{});}catch{}process.exitCode=1;});
