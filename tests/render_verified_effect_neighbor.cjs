const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.MANGA_PLAYWRIGHT||'playwright');
(async()=>{const browser=await chromium.launch({channel:process.env.MANGA_BROWSER_CHANNEL||'chromium',headless:true});try{
 const page=await browser.newPage();for(const name of ['polygon.js','render.js'])await page.addScriptTag({path:path.resolve(__dirname,'../extension',name)});
 const report=await page.evaluate(f=>{
  const check=(v,m)=>{if(!v)throw Error(m)}, cases=[
   ['valid',()=>{},'restore'],
   ['missing verification',s=>delete s.textVerification],
   ['stale verification',s=>s.textVerification.sources[0][0]++],
   ['multiple sources',s=>s.textVerification.sources.push([...s.bbox])],
   ['manual source',s=>s.manual=true],
   ['truncated source',s=>s.ocrTruncated=true],
   ['panel candidate',s=>s.panelCandidate=true],
   ['stale source',(s)=>s.text+='x'],
   ['missing neighbor proof',(s,m)=>delete m.segmentedNeighborProtection],
   ['stale proof',(s,m)=>m.segmentedNeighborProtection.regions[0].sourceVerification.role='DIALOGUE'],
   ['stale neighbor',(s,m,r)=>r.regions.find(x=>x.id===4).text+='x'],
   ['manual neighbor',(s,m,r)=>r.regions.find(x=>x.id===4).manual=true],
   ['duplicate proof',(s,m)=>m.segmentedNeighborProtection.regions.push(structuredClone(m.segmentedNeighborProtection.regions[0]))],
   ['invalid mask',(s,m)=>m.segmentedNeighborProtection.regions[0].geometry.runs=[-1,5]],
  ];
  for(const[name,mutate,mode='tooltip']of cases){const a=structuredClone(f),s=a.result.regions.find(r=>r.id===10),m=a.restoration.regions.find(r=>r.id===10);mutate(s,m,a.result);const before=JSON.stringify(a.result),shown=MangaRender.presentation(a.result,'white',a.geometry,'restore',a.restoration);check(shown.regions.find(r=>r.id===10).mode===mode,name);check(JSON.stringify(a.result)===before,'mutated source '+name);check(shown.regions.find(r=>r.id===3).mode==='tooltip','unsafe OCR admitted');for(const e of a.result.regions.filter(r=>r.type==='effect'))check(shown.regions.find(r=>r.id===e.id).mode==='tooltip','effect changed');}
  return{cases:cases.length};
 },require('./fixtures/verified-effect-neighbor.json'));assert.equal(report.cases,14);console.log(JSON.stringify(report));
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
